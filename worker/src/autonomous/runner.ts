// =============================================================
// Autonomous agent runner.
//
// The pivot from a hand-coded pipeline to a real agent: Claude drives a shell
// INSIDE an egress-locked sandbox (curl/python/jq), deciding its own steps from
// a system prompt + skill packs. The human provides only the sandbox + an
// authorized, verified scope target + a budget. No per-stage code.
//
// Containment: the sandbox's egress is locked to ONLY the target IPs (iptables).
// The brain runs here (free LLM access) and executes each command via
// `docker exec`, so nothing the agent does can reach an out-of-scope host.
//
// Two entry points:
//   • CLI (this file run directly): resolves scope, creates its own scan row.
//       DATABASE_URL=<owner> LITELLM_BASE_URL=… \
//       npx tsx src/autonomous/runner.ts <tenantSlug> <targetUrl> [--budget=10] …
//   • runAutonomousScan(): called by the scan worker on an EXISTING scan row
//       (worker already did the scope/verify/key gate). Same engine.
// =============================================================
import { execFile } from "child_process";
import { promisify } from "util";
import { lookup } from "dns/promises";
import { readFileSync, existsSync } from "fs";
import OpenAI from "openai";
import { PrismaClient, ScanStatus, Severity, FindingStatus } from "@prisma/client";

const exec = promisify(execFile);

const IMAGE = process.env.SANDBOX_IMAGE ?? "vaptbooster-agent-sandbox:latest";
const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";

const PRICING: Record<string, { in: number; out: number }> = {
  "vaptbooster-fast": { in: 0.000001, out: 0.000005 },
  "vaptbooster-default": { in: 0.000003, out: 0.000015 },
  "vaptbooster-deep": { in: 0.000005, out: 0.000025 },
};

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}

// The bridge: the agent's methodology comes from the operator-editable skill
// catalog in the DB (enabled strategic + tactical skills, current published
// version). Edit a skill in /operator/skills → the next scan uses it. No deploy.
async function loadSkillsFromDb(prisma: PrismaClient): Promise<string> {
  const skills = await prisma.skill.findMany({
    where: { enabled: true, altitude: { in: ["strategic", "tactical"] } },
    include: { currentVersion: true },
    orderBy: { altitude: "desc" }, // strategic (methodology) first
  });
  const parts: string[] = [];
  for (const s of skills) {
    const v = s.currentVersion;
    if (!v || !v.systemPrompt?.trim()) continue;
    parts.push(
      `## Skill: ${v.name} [${s.key}] — ${s.altitude} (v${v.versionNumber})\n` +
        `${v.description}\n\nWhen to use: ${v.triggers}\n\n${v.systemPrompt}`
    );
  }
  return parts.length ? parts.join("\n\n---\n\n") : "(no enabled skills in the catalog)";
}

async function loadVirtualKey(prisma: PrismaClient, tenantId: string): Promise<string | null> {
  // Preferred: provisioned via the operator UI, stored on the tenant.
  try {
    const rows = await prisma.$queryRawUnsafe<{ litellmKey: string | null }[]>(
      'SELECT "litellmKey" FROM tenants WHERE id = $1',
      tenantId
    );
    if (rows[0]?.litellmKey) return rows[0].litellmKey;
  } catch {
    /* column may be absent — fall through to the file */
  }
  // Fallback: the .secrets bridge file.
  const file = process.env.LITELLM_KEYS_FILE ?? "../.secrets/litellm-keys.json";
  try {
    if (existsSync(file)) {
      const bridge = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      return bridge[tenantId] ?? null;
    }
  } catch {
    /* */
  }
  return null;
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command inside the egress-locked sandbox (curl, python3, jq, etc). Returns stdout, stderr, exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run." },
          timeout_seconds: { type: "number", description: "Max seconds (default 60, max 180)." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_finding",
      description: "Record a CONFIRMED vulnerability with concrete evidence.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          cwe: { type: "string" },
          location: { type: "string", description: "URL / endpoint / parameter." },
          summary: { type: "string", description: "What it is + the evidence (request/response snippet)." },
          remediation: { type: "string" },
        },
        required: ["title", "severity", "location", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "End the engagement when the surface is covered or budget is low.",
      parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    },
  },
];

function costCents(u: OpenAI.CompletionUsage | undefined, model: string): number {
  const p = PRICING[model];
  if (!u || !p) return 0;
  return Math.round(((u.prompt_tokens ?? 0) * p.in + (u.completion_tokens ?? 0) * p.out) * 100);
}

// Keep the context from ballooning (huge tool outputs spike tokens/min and hit
// rate limits). Shrink the bulky output of OLD tool calls while preserving the
// system prompt, the task, the recent turns, and all of the agent's reasoning.
function trimContext(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const KEEP_RECENT = 14;
  const end = messages.length - KEEP_RECENT;
  for (let i = 2; i < end; i++) {
    const m = messages[i];
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > 220) {
      m.content = m.content.slice(0, 200) + " …[older output trimmed]";
    }
  }
}

// The agent fires rapid LLM calls; providers rate-limit (429) or hiccup (5xx).
// Back off and retry instead of aborting the whole engagement.
async function chatWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  onRetry: (secs: number) => Promise<void>
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let delay = 6000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      const msg = e instanceof Error ? e.message : "";
      const retryable = status === 429 || status >= 500 || /rate.?limit|overloaded|timeout/i.test(msg);
      if (!retryable || attempt >= 6) throw e;
      await onRetry(Math.round(delay / 1000));
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

async function docker(args: string[], timeoutMs = 30000): Promise<{ out: string; err: string; code: number }> {
  try {
    const { stdout, stderr } = await exec("docker", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return { out: stdout, err: stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return { out: err.stdout ?? "", err: (err.stderr ?? "") + (err.killed ? "\n[timed out]" : ""), code: err.code ?? 1 };
  }
}

// =============================================================
// The engine — runs the agent against an EXISTING scan row. Used by both the
// CLI (below) and the scan worker. Updates progress/spend/agentLog/findings and
// sets the terminal scan status. Never throws — returns a result the caller
// uses for notifications/credits.
// =============================================================
export type AutonomousResult = {
  status: "completed" | "failed";
  spentCents: number;
  findings: { severity: string; title: string }[];
  totalFindings: number;
  error?: string;
};

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function runAutonomousScan(opts: {
  prisma: PrismaClient;
  scanId: string;
  tenantId: string;
  targetUrl: string;
  fallbackLocation: string; // finding location if the agent omits one
  virtualKey: string;
  budgetCents: number;
  model?: string;
  maxTurns?: number;
  targetIp?: string;
  network?: string;
  resume?: boolean; // continue a prior run from its saved checkpoint
}): Promise<AutonomousResult> {
  const { prisma, scanId, tenantId, targetUrl, virtualKey } = opts;
  const model = opts.model ?? "vaptbooster-default";
  const maxTurns = opts.maxTurns ?? 80;
  const budgetCents = opts.budgetCents;
  const host = new URL(targetUrl).hostname;

  // Resume: reload the prior conversation, event log, and spend so we continue
  // from the checkpoint instead of restarting (which would re-burn the client's
  // tokens). Falls back to a fresh start if there's no checkpoint.
  let resumedMessages: Msg[] | null = null;
  let startTurn = 0;
  let priorEvents: { ts: string; actor: string; level: string; msg: string }[] = [];
  let priorSpentCents = 0;
  if (opts.resume) {
    // Raw SQL (not the typed client): the worker's generated client predates
    // these columns, matching how agentLog is already read/written here.
    try {
      const rows = await prisma.$queryRawUnsafe<
        { agentState: unknown; agentLog: unknown; spentUsdCents: number }[]
      >('SELECT "agentState", "agentLog", "spentUsdCents" FROM scans WHERE id = $1', scanId);
      const row = rows[0];
      const st = row?.agentState as { messages?: unknown; turn?: number } | null;
      if (st && Array.isArray(st.messages) && st.messages.length) {
        resumedMessages = st.messages as Msg[];
        startTurn = typeof st.turn === "number" ? st.turn : 0;
        priorEvents = (row?.agentLog as typeof priorEvents) ?? [];
        priorSpentCents = Number(row?.spentUsdCents ?? 0);
      }
    } catch {
      /* no checkpoint → fresh start */
    }
  }

  const events: { ts: string; actor: string; level: string; msg: string }[] =
    priorEvents.length ? [...priorEvents] : [];
  const log = async (actor: string, level: string, msg: string) => {
    events.push({ ts: new Date().toISOString(), actor, level, msg });
    await prisma
      .$executeRawUnsafe('UPDATE scans SET "agentLog" = $1::jsonb WHERE id = $2', JSON.stringify(events), scanId)
      .catch(() => {});
  };

  const findings: { severity: string; title: string }[] = [];
  let spentCents = priorSpentCents;

  // Resolve target IPv4s for the egress allowlist (IPv6 blocked in the sandbox).
  let ips: string[];
  try {
    ips = opts.targetIp
      ? [opts.targetIp]
      : (await lookup(host, { all: true })).filter((a) => a.family === 4).map((a) => a.address);
  } catch (e) {
    ips = [];
  }
  if (!ips.length) {
    const msg = `could not resolve an IPv4 for ${host}`;
    await log("system", "crit", `agent halted: ${msg}`);
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: ScanStatus.failed, completedAt: new Date(), currentStep: msg, progress: 100 },
    });
    return { status: "failed", spentCents: 0, findings: [], totalFindings: 0, error: msg };
  }

  // Launch the egress-locked sandbox.
  const runArgs = ["run", "-d", "--rm", "--cap-add=NET_ADMIN"];
  if (opts.network) runArgs.push("--network", opts.network);
  for (const ip of ips) runArgs.push("--add-host", `${host}:${ip}`);
  runArgs.push("-e", `ALLOWED_IPS=${ips.join(" ")}`, IMAGE);
  const launched = await docker(runArgs, 60000);
  const cid = launched.out.trim();
  if (!cid || launched.code !== 0) {
    const msg = `sandbox launch failed: ${launched.err.slice(0, 120)}`;
    await log("system", "crit", msg);
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: ScanStatus.failed, completedAt: new Date(), currentStep: msg, progress: 100 },
    });
    return { status: "failed", spentCents: 0, findings: [], totalFindings: 0, error: msg };
  }

  await log("system", "info", `autonomous agent · sandbox ${cid.slice(0, 12)} · egress-locked → ${ips.join(", ")}`);
  await log("system", "info", `target ${targetUrl} · model ${model} · budget $${(budgetCents / 100).toFixed(2)}`);

  let terminal: ScanStatus = ScanStatus.completed;
  let failMsg: string | null = null;

  try {
    const client = new OpenAI({
      apiKey: virtualKey,
      baseURL: LITELLM_URL,
      defaultHeaders: { "x-litellm-metadata": JSON.stringify({ tenant_id: tenantId, scan_id: scanId, operation: "autonomous" }) },
    });
    let messages: Msg[];
    if (resumedMessages) {
      // Continue the exact prior conversation — no re-recon, no re-billing.
      messages = resumedMessages;
      const prior = await prisma.finding.count({ where: { scanId } }).catch(() => 0);
      await log(
        "system",
        "info",
        `resuming from turn ${startTurn} · $${(priorSpentCents / 100).toFixed(2)} already spent · ${prior} prior finding(s)`
      );
    } else {
      const skillsText = await loadSkillsFromDb(prisma);
      await log("system", "info", `loaded ${skillsText.split("## Skill:").length - 1} skill(s) from the catalog`);

      const system = `You are VAPTBOOSTER's autonomous penetration-testing agent. You operate a shell INSIDE an egress-locked sandbox that can reach ONLY the authorized target: ${targetUrl}. The box carries a full command-line web-pentest arsenal (see TOOLING below).

Conduct a thorough, professional, AUTHORIZED penetration test of the target and report every confirmed vulnerability.

RULES:
- Only ${host} is in scope. The sandbox blocks every other host at the network layer.
- NON-DESTRUCTIVE: detection payloads only. Never transfer money, delete/modify real data, change real users' credentials, spam, or DoS. Creating ONE throwaway test account to authenticate is allowed.
- Report a finding ONLY with concrete evidence (reflected payload, DB error text, two different IDOR records, a protected endpoint served without a token, etc.).
- Call report_finding the MOMENT you confirm each issue — do NOT batch them until the end. Report as you go.
- You have a fixed budget of ~$${(budgetCents / 100).toFixed(2)}. Spend it efficiently; when the surface is covered or budget is low, call finish.

=== TOOLING (installed in the sandbox — prefer these over hand-rolling) ===
- Recon / fingerprint: nmap, whatweb, curl, python3 (requests)
- Content & parameter discovery: ffuf, gobuster, feroxbuster, dirb, wfuzz — wordlists in /usr/share/seclists and /usr/share/wordlists
- Templated scanning: nuclei (templates baked in) — e.g. nuclei -u <url> -tags cve,exposure,misconfiguration -silent
- Web server / misconfig: nikto, wapiti
- SQL injection: sqlmap (use --batch --level=1 --risk=1; confirm + enumerate schema only — never --dump user data in bulk)
- XSS: xsser (+ manual context-aware payloads) · Command injection: commix · CMS: wpscan (WordPress) · TLS/WAF: sslscan, wafw00f
CONSTRAINTS: the sandbox has NO internet except the target — anything that fetches remote data (nuclei -update, OOB/interactsh callbacks, subdomain enumeration, wpscan --api-token) will NOT work; everything needed is baked in. Keep ALL usage NON-DESTRUCTIVE: detection/enumeration only — no brute-force account lockouts, no data destruction, no DoS. Tools are fast but noisy; choose deliberately rather than scanning blindly.

Use bash to run commands, report_finding for confirmed issues, finish to end.

=== SKILLS (your playbooks — authored by the operator) ===
${skillsText}`;

      messages = [
        { role: "system", content: system },
        { role: "user", content: `Target: ${targetUrl}. Begin the authorized penetration test.` },
      ];
    }

    for (let turn = startTurn; turn < maxTurns; turn++) {
      if (spentCents >= budgetCents) {
        await log("system", "warn", `budget reached ($${(spentCents / 100).toFixed(2)}) — stopping`);
        break;
      }
      if (turn > 0) await new Promise((r) => setTimeout(r, 1500));
      trimContext(messages);
      const resp = await chatWithRetry(
        client,
        { model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 2000, temperature: 0.3 },
        async (secs) => log("system", "info", `rate-limited — backing off ${secs}s`)
      );
      spentCents += costCents(resp.usage, model);
      await prisma.usageRecord.create({
        data: {
          tenantId,
          scanId,
          operation: "autonomous",
          model,
          promptTokens: resp.usage?.prompt_tokens ?? 0,
          completionTokens: resp.usage?.completion_tokens ?? 0,
          cachedTokens: 0,
          costUsdCents: costCents(resp.usage, model),
          providerRequestId: resp.id,
        },
      }).catch(() => {});
      await prisma.scan.update({
        where: { id: scanId },
        data: { spentUsdCents: spentCents, progress: Math.min(10 + turn * 2, 95), currentStep: `agent turn ${turn + 1}` },
      });

      const msg = resp.choices[0]?.message;
      if (!msg) break;
      messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      if (typeof msg.content === "string" && msg.content.trim()) await log("claude", "info", msg.content.trim().slice(0, 500));
      if (!msg.tool_calls?.length) break;

      let finished = false;
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        let a: Record<string, unknown> = {};
        try { a = JSON.parse(tc.function.arguments || "{}"); } catch { /* */ }
        let result = "";

        if (tc.function.name === "bash") {
          const cmd = String(a.command ?? "");
          const t = Math.min(Number(a.timeout_seconds ?? 60), 180) * 1000;
          await log("claude", "info", `$ ${cmd.slice(0, 300)}`);
          const r = await docker(["exec", cid, "sh", "-c", cmd], t + 5000);
          const combined = (r.out + (r.err ? `\n[stderr] ${r.err}` : "")).slice(0, 4000);
          await log("tool", r.code === 0 ? "ok" : "warn", `exit ${r.code} · ${combined.split("\n")[0]?.slice(0, 160) ?? ""}`);
          result = `exit_code=${r.code}\n${combined || "(no output)"}`;
        } else if (tc.function.name === "report_finding") {
          const sev = String(a.severity ?? "info");
          await prisma.finding.create({
            data: {
              tenantId,
              scanId,
              title: String(a.title ?? "Finding"),
              summary: String(a.summary ?? ""),
              severity: sev as Severity,
              status: FindingStatus.open,
              cwe: (a.cwe as string) ?? null,
              location: String(a.location ?? opts.fallbackLocation),
              remediation: (a.remediation as string) ?? null,
            },
          }).catch(() => {});
          findings.push({ severity: sev, title: String(a.title ?? "Finding") });
          await log("system", sev === "critical" || sev === "high" ? "crit" : sev === "medium" ? "warn" : "info", `[${sev.toUpperCase()}] ${a.title}`);
          result = "recorded";
        } else if (tc.function.name === "finish") {
          await log("claude", "ok", `✓ engagement complete — ${a.summary ?? ""}`);
          finished = true;
          result = "ok";
        } else {
          result = "unknown_tool";
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 8000) });
      }
      // Checkpoint the conversation so a failed/paused scan can be resumed
      // from here instead of restarting (which re-burns the client's tokens).
      // Raw SQL — the worker's generated client predates this column.
      await prisma
        .$executeRawUnsafe(
          'UPDATE scans SET "agentState" = $1::jsonb WHERE id = $2',
          JSON.stringify({ messages, turn: turn + 1 }),
          scanId
        )
        .catch(() => {});
      if (finished) break;
    }
  } catch (e) {
    terminal = ScanStatus.failed;
    failMsg = e instanceof Error ? e.message : String(e);
    const brief = /credit|402|budget/i.test(failMsg) ? "LLM provider out of credit" : failMsg.slice(0, 140);
    await log("system", "crit", `agent halted: ${brief}`);
  } finally {
    await docker(["rm", "-f", cid], 30000);
    await log("system", "info", `sandbox ${cid.slice(0, 12)} destroyed (ephemeral)`);
  }

  const totalFindings = await prisma.finding
    .count({ where: { scanId } })
    .catch(() => findings.length);

  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: terminal,
      completedAt: new Date(),
      progress: 100,
      currentStep: failMsg ? failMsg.slice(0, 120) : null,
      spentUsdCents: spentCents,
      creditsConsumed: 1,
    },
  });

  return {
    status: terminal === ScanStatus.completed ? "completed" : "failed",
    spentCents,
    findings,
    totalFindings,
    error: failMsg ?? undefined,
  };
}

// =============================================================
// CLI entry — resolves scope, creates its own scan row, then runs the engine.
// =============================================================
async function main() {
  const prisma = new PrismaClient();
  const budgetUsd = parseFloat(arg("budget", "10")!);
  const model = arg("model", "vaptbooster-default")!;
  const maxTurns = parseInt(arg("max-turns", "80")!, 10);
  const network = arg("network");
  const targetIpArg = arg("target-ip");
  const resumeId = arg("resume"); // continue an existing scan from its checkpoint

  let scanId: string;
  let tenantId: string;
  let targetUrl: string;
  let fallbackLocation: string;

  if (resumeId) {
    // --- Resume: reuse the existing scan (already authorized when created) ---
    const scan = await prisma.scan.findUnique({
      where: { id: resumeId },
      include: { target: true },
    });
    if (!scan) throw new Error(`scan not found: ${resumeId}`);
    scanId = scan.id;
    tenantId = scan.tenantId;
    targetUrl = scan.target?.value ?? scan.targetValue;
    fallbackLocation = scan.targetValue;
    await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.running } });
    console.log(`resuming scan ${scanId} · watch http://localhost:3000/scans/${scanId}`);
  } else {
    const slug = process.argv[2];
    const targetArg = process.argv[3];
    if (!slug || !targetArg) {
      console.error("usage: runner.ts <tenantSlug> <targetUrl> [--budget=10] [--model=…] [--target-ip=IP] [--network=NET]");
      console.error("   or: runner.ts --resume=<scanId> [--budget=…]");
      process.exit(1);
    }
    // --- Authorization gate: the target must be a VERIFIED scope target ---
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`tenant not found: ${slug}`);
    const target = await prisma.scopeTarget.findFirst({ where: { tenantId: tenant.id, value: targetArg } });
    if (!target) throw new Error(`'${targetArg}' is not in ${slug}'s scope — add + verify it first.`);
    if (!target.verifiedAt) throw new Error(`'${targetArg}' is NOT verified — authorization required before active testing.`);
    const operator = await prisma.user.findFirst({ where: { role: "operator" } });
    const scan = await prisma.scan.create({
      data: {
        tenantId: tenant.id,
        targetId: target.id,
        targetValue: target.value,
        status: ScanStatus.running,
        requesterId: operator?.id,
        approverId: operator?.id,
        approvedAt: new Date(),
        startedAt: new Date(),
        notes: "Autonomous agent run (CLI)",
        currentStep: "launching sandbox",
        progress: 5,
      },
    });
    scanId = scan.id;
    tenantId = tenant.id;
    targetUrl = targetArg;
    fallbackLocation = target.value;
    console.log(`scan ${scan.id} · watch http://localhost:3000/scans/${scan.id}`);
  }

  const virtualKey = await loadVirtualKey(prisma, tenantId);
  if (!virtualKey) throw new Error("no LiteLLM virtual key for tenant — provision one first.");

  const result = await runAutonomousScan({
    prisma,
    scanId,
    tenantId,
    targetUrl,
    fallbackLocation,
    virtualKey,
    budgetCents: Math.round(budgetUsd * 100),
    model,
    maxTurns,
    targetIp: targetIpArg,
    network,
    resume: !!resumeId,
  });

  console.log(`\n=== ${result.status} · $${(result.spentCents / 100).toFixed(4)} · ${result.totalFindings} findings ===`);
  for (const f of result.findings) console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
  await prisma.$disconnect();
}

// Run the CLI only when this file is the process entrypoint (not when the
// worker imports runAutonomousScan from it).
const entry = process.argv[1] ?? "";
if (entry.endsWith("runner.ts") || entry.endsWith("runner.js")) {
  main().catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
