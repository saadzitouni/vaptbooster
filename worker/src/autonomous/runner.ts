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
// Usage:
//   DATABASE_URL=<owner> LITELLM_BASE_URL=… \
//   npx tsx src/autonomous/runner.ts <tenantSlug> <targetUrl> \
//     [--budget=10] [--model=vaptbooster-default] [--target-ip=IP] [--network=NET] [--max-turns=80]
// =============================================================
import { execFile } from "child_process";
import { promisify } from "util";
import { lookup } from "dns/promises";
import { readFileSync, existsSync } from "fs";
import OpenAI from "openai";
import { PrismaClient, ScanStatus, Severity, FindingStatus } from "@prisma/client";

const exec = promisify(execFile);
const prisma = new PrismaClient();

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
async function loadSkillsFromDb(): Promise<string> {
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

function loadVirtualKey(tenantId: string): string | null {
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

async function main() {
  const slug = process.argv[2];
  const targetUrl = process.argv[3];
  if (!slug || !targetUrl) {
    console.error("usage: runner.ts <tenantSlug> <targetUrl> [--budget=10] [--model=…] [--target-ip=IP] [--network=NET]");
    process.exit(1);
  }
  const budgetUsd = parseFloat(arg("budget", "10")!);
  const budgetCents = Math.round(budgetUsd * 100);
  const model = arg("model", "vaptbooster-default")!;
  const maxTurns = parseInt(arg("max-turns", "80")!, 10);
  const network = arg("network");
  const targetIpArg = arg("target-ip");
  const host = new URL(targetUrl).hostname;

  // --- Authorization gate: the target must be a VERIFIED scope target ---
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);
  const target = await prisma.scopeTarget.findFirst({ where: { tenantId: tenant.id, value: targetUrl } });
  if (!target) throw new Error(`'${targetUrl}' is not in ${slug}'s scope — add + verify it first.`);
  if (!target.verifiedAt) throw new Error(`'${targetUrl}' is NOT verified — authorization required before active testing.`);
  const operator = await prisma.user.findFirst({ where: { role: "operator" } });
  const virtualKey = loadVirtualKey(tenant.id);
  if (!virtualKey) throw new Error("no LiteLLM virtual key for tenant — provision one first.");

  // --- Resolve target IPv4s for the egress allowlist (the box pins the target
  //     over IPv4; IPv6 is blocked outright in the sandbox). ---
  const ips = targetIpArg
    ? [targetIpArg]
    : (await lookup(host, { all: true })).filter((a) => a.family === 4).map((a) => a.address);
  if (!ips.length) throw new Error(`could not resolve an IPv4 for ${host}`);

  // --- Create the scan record ---
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
      notes: "Autonomous agent run",
      currentStep: "launching sandbox",
      progress: 5,
    },
  });
  console.log(`scan ${scan.id} · watch http://localhost:3000/scans/${scan.id}`);

  const events: { ts: string; actor: string; level: string; msg: string }[] = [];
  const log = async (actor: string, level: string, msg: string) => {
    events.push({ ts: new Date().toISOString(), actor, level, msg });
    await prisma.$executeRawUnsafe('UPDATE scans SET "agentLog" = $1::jsonb WHERE id = $2', JSON.stringify(events), scan.id);
  };

  // --- Launch the egress-locked sandbox ---
  const runArgs = ["run", "-d", "--rm", "--cap-add=NET_ADMIN"];
  if (network) runArgs.push("--network", network);
  for (const ip of ips) runArgs.push("--add-host", `${host}:${ip}`);
  runArgs.push("-e", `ALLOWED_IPS=${ips.join(" ")}`, IMAGE);
  const launched = await docker(runArgs, 60000);
  const cid = launched.out.trim();
  if (!cid || launched.code !== 0) {
    await prisma.scan.update({ where: { id: scan.id }, data: { status: ScanStatus.failed, currentStep: `sandbox launch failed: ${launched.err.slice(0, 120)}` } });
    throw new Error(`sandbox launch failed: ${launched.err}`);
  }
  await log("system", "info", `autonomous agent · sandbox ${cid.slice(0, 12)} · egress-locked → ${ips.join(", ")}`);
  await log("system", "info", `target ${targetUrl} · model ${model} · budget $${budgetUsd.toFixed(2)}`);

  const findings: { severity: string; title: string }[] = [];
  let spentCents = 0;
  let terminal: ScanStatus = ScanStatus.completed;
  let failMsg: string | null = null;

  try {
    const client = new OpenAI({ apiKey: virtualKey, baseURL: LITELLM_URL, defaultHeaders: { "x-litellm-metadata": JSON.stringify({ tenant_id: tenant.id, scan_id: scan.id, operation: "autonomous" }) } });
    const skillsText = await loadSkillsFromDb(); // operator-editable methodology from the DB
    await log("system", "info", `loaded ${skillsText.split("## Skill:").length - 1} skill(s) from the catalog`);
    const system = `You are VAPTBOOSTER's autonomous penetration-testing agent. You operate a shell INSIDE an egress-locked sandbox that can reach ONLY the authorized target: ${targetUrl}. Tools available in the box: curl, python3 (with requests), jq, openssl, standard unix tools.

Conduct a thorough, professional, AUTHORIZED penetration test of the target and report every confirmed vulnerability.

RULES:
- Only ${host} is in scope. The sandbox blocks every other host at the network layer.
- NON-DESTRUCTIVE: detection payloads only. Never transfer money, delete/modify real data, change real users' credentials, spam, or DoS. Creating ONE throwaway test account to authenticate is allowed.
- Report a finding ONLY with concrete evidence (reflected payload, DB error text, two different IDOR records, a protected endpoint served without a token, etc.).
- Call report_finding the MOMENT you confirm each issue — do NOT batch them until the end. Report as you go.
- You have a fixed budget of ~$${budgetUsd.toFixed(2)}. Spend it efficiently; when the surface is covered or budget is low, call finish.

Use bash to run commands, report_finding for confirmed issues, finish to end.

=== SKILLS (your playbooks — authored by the operator) ===
${skillsText}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: `Target: ${targetUrl}. Begin the authorized penetration test.` },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      if (spentCents >= budgetCents) {
        await log("system", "warn", `budget reached ($${(spentCents / 100).toFixed(2)}) — stopping`);
        break;
      }
      if (turn > 0) await new Promise((r) => setTimeout(r, 1500)); // space out calls (rate limits)
      trimContext(messages); // keep tokens/min bounded on long engagements
      const resp = await chatWithRetry(
        client,
        { model, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 2000, temperature: 0.3 },
        async (secs) => log("system", "info", `rate-limited — backing off ${secs}s`)
      );
      spentCents += costCents(resp.usage, model);
      await prisma.usageRecord.create({ data: { tenantId: tenant.id, scanId: scan.id, operation: "autonomous", model, promptTokens: resp.usage?.prompt_tokens ?? 0, completionTokens: resp.usage?.completion_tokens ?? 0, cachedTokens: 0, costUsdCents: costCents(resp.usage, model), providerRequestId: resp.id } });
      await prisma.scan.update({ where: { id: scan.id }, data: { spentUsdCents: spentCents, progress: Math.min(10 + turn * 2, 95), currentStep: `agent turn ${turn + 1}` } });

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
          await prisma.finding.create({ data: { tenantId: tenant.id, scanId: scan.id, title: String(a.title ?? "Finding"), summary: String(a.summary ?? ""), severity: sev as Severity, status: FindingStatus.open, cwe: (a.cwe as string) ?? null, location: String(a.location ?? target.value), remediation: (a.remediation as string) ?? null } });
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
      if (finished) break;
    }
  } catch (e) {
    // A provider/credit/tool error must not leave the scan stuck "running".
    terminal = ScanStatus.failed;
    failMsg = e instanceof Error ? e.message : String(e);
    const brief = /credit|402|budget/i.test(failMsg) ? "LLM provider out of credit" : failMsg.slice(0, 140);
    await log("system", "crit", `agent halted: ${brief}`);
  } finally {
    await docker(["rm", "-f", cid], 30000);
    await log("system", "info", `sandbox ${cid.slice(0, 12)} destroyed (ephemeral)`);
  }

  await prisma.scan.update({ where: { id: scan.id }, data: { status: terminal, completedAt: new Date(), progress: 100, currentStep: failMsg ? failMsg.slice(0, 120) : null, spentUsdCents: spentCents, creditsConsumed: 1 } });
  console.log(`\n=== ${terminal} · $${(spentCents / 100).toFixed(4)} · ${findings.length} findings ===`);
  for (const f of findings) console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
