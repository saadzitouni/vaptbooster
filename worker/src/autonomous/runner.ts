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
// catalog in the DB. Edit a skill in /operator/skills → the next scan uses it.
//
// Loading is on-demand: the STRATEGIC methodology is injected in
// full (it's the always-on operating procedure), while TACTICAL playbooks are
// advertised only as a lean one-line catalog. The agent pulls a full tactical
// body into context via the load_skill tool right before it tests that class —
// keeping the per-turn prompt small while letting the playbooks be deep.

async function loadStrategicSkills(prisma: PrismaClient): Promise<string> {
  const skills = await prisma.skill.findMany({
    where: { enabled: true, altitude: "strategic" },
    include: { currentVersion: true },
  });
  const parts: string[] = [];
  for (const s of skills) {
    const v = s.currentVersion;
    if (!v?.systemPrompt?.trim()) continue;
    parts.push(`## ${v.name} [${s.key}]\n${v.description}\n\n${v.systemPrompt}`);
  }
  return parts.length ? parts.join("\n\n---\n\n") : "(no strategic methodology skill enabled)";
}

async function loadTacticalCatalog(
  prisma: PrismaClient
): Promise<{ index: string; count: number }> {
  const skills = await prisma.skill.findMany({
    where: { enabled: true, altitude: "tactical" },
    include: { currentVersion: true },
    orderBy: { category: "asc" },
  });
  const lines: string[] = [];
  for (const s of skills) {
    const v = s.currentVersion;
    if (!v?.systemPrompt?.trim()) continue;
    lines.push(`- ${s.key} — ${v.name}: ${v.description}`);
  }
  return { index: lines.join("\n") || "(none)", count: lines.length };
}

// Full body of specific skills — returned inline by the load_skill tool.
async function loadSkillBodies(prisma: PrismaClient, keys: string[]): Promise<string> {
  const uniq = [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))].slice(0, 5);
  if (!uniq.length) return "load_skill: provide at least one skill key from the catalog.";
  const skills = await prisma.skill.findMany({
    where: { key: { in: uniq }, enabled: true },
    include: { currentVersion: true },
  });
  const parts: string[] = [];
  for (const s of skills) {
    const v = s.currentVersion;
    if (!v?.systemPrompt?.trim()) continue;
    let body = `## Skill: ${v.name} [${s.key}]\n${v.description}\n\n${v.systemPrompt}`;
    const ps = v.payloadSets as unknown;
    if (ps && typeof ps === "object" && Object.keys(ps as object).length) {
      body += `\n\nPayload sets: ${JSON.stringify(ps).slice(0, 2500)}`;
    }
    parts.push(body);
  }
  const found = new Set(skills.map((s) => s.key));
  const missing = uniq.filter((k) => !found.has(k));
  let out = parts.join("\n\n---\n\n") || "load_skill: no enabled skills matched those keys.";
  if (missing.length) out += `\n\n(not found or disabled: ${missing.join(", ")})`;
  return out;
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
      name: "load_skill",
      description:
        "Pull the full playbook (techniques, payloads, bypass ladders, validation steps) for one or more tactical skills BY KEY, right before you test that vulnerability class. Returns the skill bodies inline. Work from the full playbook, not the one-line catalog summary.",
      parameters: {
        type: "object",
        properties: {
          keys: {
            type: "array",
            items: { type: "string" },
            description:
              'Skill keys from the TACTICAL PLAYBOOK CATALOG, e.g. ["sql_injection","access_control"]. Max 5.',
          },
        },
        required: ["keys"],
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

// Normalize a model-supplied severity to the DB enum. LLMs routinely return
// off-enum values ("Critical", "informational", "moderate", "High ") even with
// a tool-schema enum; without this the Prisma create throws and a CONFIRMED
// finding is silently lost. Unknown → medium so nothing is hidden.
function normSeverity(v: unknown): Severity {
  const s = String(v ?? "").toLowerCase().trim();
  if (s.startsWith("crit")) return "critical" as Severity;
  if (s.startsWith("high")) return "high" as Severity;
  if (s.startsWith("low") || s.startsWith("minor")) return "low" as Severity;
  if (s.startsWith("info")) return "info" as Severity;
  return "medium" as Severity;
}

// Retest input — one prior finding the agent must re-verify.
export type RetestTarget = {
  id: string;
  title: string;
  severity: string;
  location: string;
  summary: string;
};

// Incremental memory: compact brief of what earlier assessments of THIS target
// already discovered, so a fresh scan skips redundant recon and goes deeper.
// Returns null when there's no prior completed scan (→ true cold start).
async function buildPriorKnowledge(
  prisma: PrismaClient,
  tenantId: string,
  targetValue: string,
  currentScanId: string
): Promise<string | null> {
  const priorScans = await prisma.scan
    .findMany({
      where: {
        tenantId,
        targetValue,
        id: { not: currentScanId },
        status: ScanStatus.completed,
      },
      select: { id: true },
      orderBy: { completedAt: "desc" },
      take: 10,
    })
    .catch(() => [] as { id: string }[]);
  if (!priorScans.length) return null;

  const prior = await prisma.finding
    .findMany({
      where: { scanId: { in: priorScans.map((s) => s.id) } },
      select: { title: true, severity: true, status: true, location: true, summary: true },
      orderBy: { discoveredAt: "desc" },
      take: 300,
    })
    .catch(() => [] as { title: string; severity: string; status: string; location: string; summary: string }[]);
  if (!prior.length) return null;

  const endpoints = new Set<string>();
  const tech = new Set<string>();
  const vulns: { severity: string; title: string; status: string; location: string }[] = [];
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const f of prior) {
    if (f.location && f.location !== targetValue) endpoints.add(f.location);
    const sev = String(f.severity);
    if (sev === "info") {
      // Recon/fingerprint findings carry endpoint + tech lists in their summary.
      if (/fingerprint|technolog/i.test(f.title)) {
        f.summary.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20).forEach((t) => tech.add(t));
      } else {
        f.summary
          .split("\n")
          .map((s) => s.trim())
          .filter((l) => l.startsWith("/") || /^https?:\/\//.test(l))
          .slice(0, 60)
          .forEach((e) => endpoints.add(e));
      }
      continue;
    }
    vulns.push({ severity: sev, title: f.title, status: String(f.status), location: f.location });
  }

  const seen = new Set<string>();
  const dedupVulns = vulns
    .filter((v) => {
      const k = `${v.title}|${v.location}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
    .slice(0, 30);

  const epList = [...endpoints].slice(0, 50);
  const techList = [...tech].slice(0, 15);

  const parts: string[] = [
    `=== PRIOR KNOWLEDGE (from ${priorScans.length} earlier assessment(s) of this exact target) ===`,
    `You have assessed this target before. Use this to AVOID redundant recon and go DEEPER — but VERIFY, don't assume: the app may have changed. Re-confirm each prior finding still reproduces (a now-fixed one is a valid negative), then spend the rest of your budget on surface you have NOT covered before.`,
  ];
  if (techList.length) parts.push(`\nKnown tech / fingerprint:\n${techList.map((t) => `- ${t}`).join("\n")}`);
  if (epList.length)
    parts.push(`\nKnown endpoints / paths (start here, then expand):\n${epList.map((e) => `- ${e}`).join("\n")}`);
  if (dedupVulns.length)
    parts.push(
      `\nPreviously reported findings (re-verify each, then look beyond them):\n${dedupVulns
        .map((v) => `- [${v.severity.toUpperCase()}] ${v.title} @ ${v.location} (was: ${v.status})`)
        .join("\n")}`
    );
  return parts.join("\n");
}

// Retest mode — a scoped regression check. The agent verifies ONLY the listed
// prior findings (with handles [F1]..[Fn]) and re-reports the ones still present.
function buildRetestPrompt(
  targetUrl: string,
  host: string,
  budgetCents: number,
  methodology: string,
  targets: RetestTarget[]
): { system: string; user: string } {
  const list = targets
    .map(
      (f, i) =>
        `[F${i + 1}] (${f.severity}) ${f.title}\n    location: ${f.location}\n    original evidence: ${f.summary.slice(0, 500)}`
    )
    .join("\n\n");
  const system = `You are VAPTBOOSTER's autonomous penetration-testing agent running a REGRESSION RE-TEST (not a full assessment). You operate a shell INSIDE an egress-locked sandbox that can reach ONLY the authorized target: ${targetUrl}. The box carries a full command-line web-pentest arsenal (nmap, sqlmap, ffuf, nuclei, curl, python3, etc.).

Your ONLY job: for each previously-confirmed finding below, determine whether it is STILL exploitable or has been FIXED. Do NOT hunt for new vulnerabilities — stay strictly scoped to these items and be fast + efficient.

RULES:
- Only ${host} is in scope. The sandbox blocks every other host at the network layer.
- NON-DESTRUCTIVE detection only. One throwaway test account to authenticate is allowed.
- For EACH item you can STILL reproduce with concrete evidence, call report_finding and START its title with the handle in brackets, e.g. "[F2] SQL injection still exploitable on /login". Put the fresh evidence in the summary.
- If an item NO LONGER reproduces (properly fixed), do NOT report it — just record your reasoning.
- You have ~$${(budgetCents / 100).toFixed(2)} of budget. When every item has a verdict, call finish with a per-handle summary (e.g. "F1 fixed, F2 still present").
- Apply the methodology's validation discipline: confirm, don't guess. Use load_skill to pull a deep playbook for a class if you need it.

=== METHODOLOGY (validation discipline) ===
${methodology}`;
  const user = `Target: ${targetUrl}. Re-test these ${targets.length} previously-confirmed finding(s); report which are STILL present (with the [F#] handle prefix) and finish with a verdict for each:\n\n${list}`;
  return { system, user };
}

// Keep the context from ballooning (huge tool outputs spike tokens/min and hit
// rate limits). Shrink the bulky output of OLD tool calls while preserving the
// system prompt, the task, the recent turns, and all of the agent's reasoning.
function trimContext(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  // The agent re-sends the whole transcript every turn, and input tokens are
  // ~90% of scan cost. Shrink OLD tool outputs (command results + loaded skill
  // bodies) hard — the agent already acted on them; the full text is dead
  // weight that gets re-billed as input on every subsequent turn. Keep only a
  // short recent window at full size.
  const KEEP_RECENT = 6;
  const end = messages.length - KEEP_RECENT;
  for (let i = 2; i < end; i++) {
    const m = messages[i];
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > 180) {
      m.content = m.content.slice(0, 160) + " …[trimmed]";
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
  status: "completed" | "failed" | "cancelled";
  // True only when the agent explicitly called finish (not budget/turn cutoff,
  // cancel, or error). Retest reconciliation trusts a verdict only when this is
  // true — otherwise an un-reached finding must NOT be assumed fixed.
  finishedCleanly: boolean;
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
  kind?: string; // "assessment" (default) | "retest"
  retestTargets?: RetestTarget[]; // prior findings to re-verify (kind=retest)
  authBrief?: string; // AUTHENTICATED TESTING block (creds pre-formatted) to inject
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
    return { status: "failed", finishedCleanly: false, spentCents: 0, findings: [], totalFindings: 0, error: msg };
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
    return { status: "failed", finishedCleanly: false, spentCents: 0, findings: [], totalFindings: 0, error: msg };
  }

  await log("system", "info", `autonomous agent · sandbox ${cid.slice(0, 12)} · egress-locked → ${ips.join(", ")}`);
  await log("system", "info", `target ${targetUrl} · model ${model} · budget $${(budgetCents / 100).toFixed(2)}`);

  let terminal: ScanStatus = ScanStatus.completed;
  let failMsg: string | null = null;
  let agentFinished = false; // set only when the agent calls finish()

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
    } else if (opts.kind === "retest" && opts.retestTargets && opts.retestTargets.length) {
      // Scoped regression re-test — verify ONLY the listed prior findings.
      const methodology = await loadStrategicSkills(prisma);
      await log(
        "system",
        "info",
        `retest mode · re-verifying ${opts.retestTargets.length} prior finding(s)`
      );
      const rt = buildRetestPrompt(targetUrl, host, budgetCents, methodology, opts.retestTargets);
      if (opts.authBrief) {
        await log("system", "info", "authenticated retest · using the provided test account");
      }
      messages = [
        { role: "system", content: rt.system + (opts.authBrief ? `\n\n${opts.authBrief}` : "") },
        { role: "user", content: rt.user },
      ];
    } else {
      const methodology = await loadStrategicSkills(prisma);
      const catalog = await loadTacticalCatalog(prisma);
      await log(
        "system",
        "info",
        `methodology loaded · ${catalog.count} tactical playbook(s) available on demand (load_skill)`
      );

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

Use bash to run commands, load_skill to pull a tactical playbook before testing that class, report_finding for confirmed issues, finish to end.

=== METHODOLOGY (your operating procedure — always in effect) ===
${methodology}

=== TACTICAL PLAYBOOK CATALOG ===
Each entry below is a DEEP playbook (techniques, payloads, bypass ladders, validation, false positives). Before testing a vulnerability class, call load_skill with its key(s) to pull the full playbook into context — do NOT rely on the one-line summary alone. Cover every category in the methodology's checklist.
${catalog.index}`;

      // Incremental scan: prime with what earlier assessments of this target
      // already found, so the agent doesn't re-recon from zero.
      const prior = await buildPriorKnowledge(prisma, tenantId, opts.fallbackLocation, scanId);
      if (prior) {
        await log(
          "system",
          "info",
          "incremental scan · prior-knowledge brief loaded (reusing earlier recon + findings)"
        );
      }
      if (opts.authBrief) {
        await log(
          "system",
          "info",
          "authenticated scan · logging in with the provided test account"
        );
      }
      messages = [
        { role: "system", content: system + (opts.authBrief ? `\n\n${opts.authBrief}` : "") },
        {
          role: "user",
          content:
            `Target: ${targetUrl}. Begin the authorized penetration test.` +
            (prior ? `\n\n${prior}` : ""),
        },
      ];
    }

    for (let turn = startTurn; turn < maxTurns; turn++) {
      if (spentCents >= budgetCents) {
        await log("system", "warn", `budget reached ($${(spentCents / 100).toFixed(2)}) — stopping`);
        break;
      }
      // Cooperative cancel — the owner/operator can flip status to 'cancelled'
      // via cancelScan while we run. Stop cleanly here (before spending another
      // LLM call); the finally block tears down the sandbox.
      const cancelRow = await prisma
        .$queryRawUnsafe<{ status: string }[]>('SELECT status FROM scans WHERE id = $1', scanId)
        .catch(() => [] as { status: string }[]);
      if (cancelRow[0]?.status === "cancelled") {
        await log("system", "warn", "cancelled by user — stopping");
        terminal = ScanStatus.cancelled;
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
          const combined = (r.out + (r.err ? `\n[stderr] ${r.err}` : "")).slice(0, 2500);
          await log("tool", r.code === 0 ? "ok" : "warn", `exit ${r.code} · ${combined.split("\n")[0]?.slice(0, 160) ?? ""}`);
          result = `exit_code=${r.code}\n${combined || "(no output)"}`;
        } else if (tc.function.name === "load_skill") {
          const keys = Array.isArray(a.keys) ? (a.keys as unknown[]).map(String) : [];
          result = await loadSkillBodies(prisma, keys);
          await log("system", "info", `↓ loaded playbook(s): ${keys.slice(0, 5).join(", ") || "(none)"}`);
        } else if (tc.function.name === "report_finding") {
          const sev = normSeverity(a.severity);
          const title = String(a.title ?? "Finding");
          try {
            await prisma.finding.create({
              data: {
                tenantId,
                scanId,
                title,
                summary: String(a.summary ?? ""),
                severity: sev,
                status: FindingStatus.open,
                cwe: (a.cwe as string) ?? null,
                location: String(a.location ?? opts.fallbackLocation),
                remediation: (a.remediation as string) ?? null,
              },
            });
            findings.push({ severity: sev, title });
            await log("system", sev === "critical" || sev === "high" ? "crit" : sev === "medium" ? "warn" : "info", `[${sev.toUpperCase()}] ${title}`);
            result = "recorded";
          } catch (e) {
            // Surface the failure instead of silently dropping a confirmed finding.
            await log("system", "warn", `finding NOT saved (${String((e as Error)?.message ?? e).slice(0, 80)})`);
            result = "error: finding was NOT saved — retry report_finding with a valid severity (critical|high|medium|low|info)";
          }
        } else if (tc.function.name === "finish") {
          await log("claude", "ok", `✓ engagement complete — ${a.summary ?? ""}`);
          finished = true;
          agentFinished = true;
          result = "ok";
        } else {
          result = "unknown_tool";
        }
        // load_skill returns deep playbooks — give them more room than a normal
        // tool result (trimContext shrinks them once they age out anyway).
        const cap = tc.function.name === "load_skill" ? 20000 : 8000;
        messages.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, cap) });
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

  const finalData = {
    completedAt: new Date(),
    progress: 100,
    currentStep: failMsg ? failMsg.slice(0, 120) : null,
    spentUsdCents: spentCents,
    creditsConsumed: 1,
  };
  let effectiveTerminal = terminal;
  if (terminal === ScanStatus.cancelled) {
    await prisma.scan.update({ where: { id: scanId }, data: { status: terminal, ...finalData } });
  } else {
    // Never clobber a cancel that landed mid-turn (after the top-of-loop check
    // but before we got here). If 0 rows match, the scan was cancelled — honor
    // it so the worker doesn't charge a credit / send a "completed" alert.
    const res = await prisma.scan.updateMany({
      where: { id: scanId, status: { not: ScanStatus.cancelled } },
      data: { status: terminal, ...finalData },
    });
    if (res.count === 0) effectiveTerminal = ScanStatus.cancelled;
  }

  return {
    status:
      effectiveTerminal === ScanStatus.completed
        ? "completed"
        : effectiveTerminal === ScanStatus.cancelled
        ? "cancelled"
        : "failed",
    finishedCleanly: agentFinished && effectiveTerminal === ScanStatus.completed,
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
