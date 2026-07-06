// =============================================================
// Recon agent — Stage 1 (read-only reconnaissance).
//
// Real mode: Claude (via LiteLLM, per-tenant virtual key) plans which recon
// tool to call next in a tool-use loop, and each LLM turn writes a
// usage_record so cost/budget tracking stays intact.
// Simulate mode: a deterministic plan drives the SAME real executor, so recon
// actually runs (real HTTP/DNS) without needing a provider key.
// =============================================================

import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { ReconExecutor } from "./tools.js";
import type { ScopeTargetLite } from "./scope.js";
import { logger } from "../logger.js";

const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
const MAX_TURNS = 20;

const RECON_SYSTEM = `You are the reconnaissance planner for VAPTBOOSTER, an authorized web pentest agent.
Your ONLY task is passive, READ-ONLY reconnaissance: map the attack surface of the in-scope target.
Tools: resolve_dns, fetch_url (GET only), enumerate_subdomains (CT logs). The executor REFUSES any
out-of-scope host, so stay on the target. Do NOT attempt exploitation, writes, or destructive actions.
Approach: resolve the host, fetch the target, follow in-scope links to enumerate endpoints, fingerprint
the tech. Each fetch costs budget — be efficient. When the surface is reasonably mapped (or budget is
low), call recon_complete with a short summary.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "resolve_dns", description: "Resolve a hostname to IP addresses.", parameters: { type: "object", properties: { host: { type: "string" } }, required: ["host"] } } },
  { type: "function", function: { name: "fetch_url", description: "HTTP GET an in-scope URL. Returns status, tech fingerprint, and discovered in-scope links.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "enumerate_subdomains", description: "Passively enumerate subdomains of a domain via Certificate Transparency logs.", parameters: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } } },
  { type: "function", function: { name: "recon_complete", description: "Finish reconnaissance.", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
];

export type ReconDeps = {
  tenantId: string;
  scanId: string;
  virtualKey: string;
  model: string;
  db: PrismaClient;
  costCeilingCents: number;
  onProgress?: (pct: number, step: string) => Promise<void> | void;
  onEvent?: (e: AgentEvent) => Promise<void> | void;
};

// A single line in the live agent transcript shown on the scan page.
export type AgentEvent = {
  actor: "system" | "claude" | "tool";
  level: "info" | "ok" | "warn" | "crit";
  msg: string;
};

export type ReconOutcome = {
  results: ReconExecutor["results"];
  summary: string;
  spentCents: number;
};

// Per-token pricing (USD) mirrored from infra/litellm/config.yaml. Used only
// as a fallback when LiteLLM doesn't surface response_cost in the JSON body
// (it returns the exact cost in the x-litellm-response-cost header instead).
const PRICING: Record<string, { in: number; out: number }> = {
  "vaptbooster-fast": { in: 0.000001, out: 0.000005 }, // Haiku 4.5  $1/$5
  "vaptbooster-default": { in: 0.000003, out: 0.000015 }, // Sonnet 4.6 $3/$15
  "vaptbooster-deep": { in: 0.000005, out: 0.000025 }, // Opus 4.8   $5/$25
};

function extractCostCents(
  resp: OpenAI.Chat.Completions.ChatCompletion,
  model: string
): number {
  const usage = resp.usage as (OpenAI.CompletionUsage & { response_cost?: number }) | undefined;
  // Prefer LiteLLM's exact cost when present…
  if (usage?.response_cost != null) return Math.round(usage.response_cost * 100);
  // …otherwise estimate from tokens so our per-scan spend + ceiling stay live.
  // (LiteLLM still enforces the real per-tenant budget server-side regardless.)
  const price = PRICING[model];
  if (!price || !usage) return 0;
  const dollars =
    (usage.prompt_tokens ?? 0) * price.in + (usage.completion_tokens ?? 0) * price.out;
  return Math.round(dollars * 100);
}

// Human-readable rendering of a tool call + its result for the live transcript.
function fmtArgs(name: string, args: Record<string, unknown>): string {
  if (name === "fetch_url") return String(args.url ?? "");
  if (name === "resolve_dns") return String(args.host ?? "");
  if (name === "enumerate_subdomains") return String(args.domain ?? "");
  return "";
}
function fmtResult(name: string, r: unknown): { msg: string; level: AgentEvent["level"] } {
  const o = (r ?? {}) as Record<string, unknown>;
  if (o.error) return { msg: String(o.error), level: o.error === "out_of_scope" ? "warn" : "warn" };
  if (name === "fetch_url") {
    const tech = (o.tech as string[] | undefined) ?? [];
    const links = (o.links as string[] | undefined) ?? [];
    return { msg: `HTTP ${o.status} · ${tech.join(", ") || "no fingerprint"} · ${links.length} in-scope links`, level: "ok" };
  }
  if (name === "resolve_dns") {
    const ips = (o.ips as string[] | undefined) ?? [];
    return { msg: ips.join(", ") || "no A record", level: "ok" };
  }
  if (name === "enumerate_subdomains") return { msg: `${o.count ?? 0} subdomains (CT logs)`, level: "ok" };
  return { msg: "ok", level: "info" };
}

export async function runRecon(
  target: { type: string; value: string },
  scope: ScopeTargetLite[],
  deps: ReconDeps
): Promise<ReconOutcome> {
  const exec = new ReconExecutor(scope);
  const simulate = process.env.SIMULATE_LLM === "true";
  let spentCents = 0;
  let summary = "";

  const dispatch = async (name: string, args: Record<string, unknown>) => {
    if (name === "resolve_dns") return exec.resolveDns(String(args.host ?? ""));
    if (name === "fetch_url") return exec.fetchUrl(String(args.url ?? ""));
    if (name === "enumerate_subdomains") return exec.enumerateSubdomains(String(args.domain ?? ""));
    if (name === "recon_complete") {
      summary = String(args.summary ?? "");
      return { ok: true };
    }
    return { error: "unknown_tool" };
  };

  // ---- Simulate: deterministic plan over the real executor ----
  if (simulate) {
    await deps.onEvent?.({ actor: "system", level: "info", msg: "planner: deterministic (SIMULATE — no AI)" });
    const emit = async (name: string, arg: string, result: unknown) => {
      await deps.onEvent?.({ actor: "claude", level: "info", msg: `→ ${name}(${arg})` });
      const sum = fmtResult(name, result);
      await deps.onEvent?.({ actor: "tool", level: sum.level, msg: `${name}: ${sum.msg}` });
    };
    const host = exec.hostFor(target);
    await deps.onProgress?.(15, "recon: resolving DNS");
    if (host) await emit("resolve_dns", host, await exec.resolveDns(host));
    if (target.type === "domain") {
      await deps.onProgress?.(30, "recon: enumerating subdomains (CT logs)");
      await emit("enumerate_subdomains", target.value, await exec.enumerateSubdomains(target.value));
    }
    await deps.onProgress?.(45, "recon: fetching root");
    const root = await exec.fetchUrl(exec.rootUrlFor(target));
    await emit("fetch_url", exec.rootUrlFor(target), root);
    const links: string[] = (root as { links?: string[] }).links ?? [];
    await deps.onProgress?.(65, `recon: crawling ${Math.min(links.length, 8)} endpoints`);
    for (const link of links.slice(0, 8)) await emit("fetch_url", link, await exec.fetchUrl(link));
    await deps.onProgress?.(90, "recon: summarizing");
    summary =
      `Recon (deterministic planner): ${exec.results.endpoints.size} endpoints, ` +
      `${exec.results.tech.size} tech signals, ${exec.results.subdomains.size} subdomains, ` +
      `${exec.results.blocked} out-of-scope attempts refused.`;
    return { results: exec.results, summary, spentCents };
  }

  // ---- Real: Claude tool-use loop via LiteLLM ----
  const client = new OpenAI({
    apiKey: deps.virtualKey,
    baseURL: LITELLM_URL,
    defaultHeaders: {
      "x-litellm-metadata": JSON.stringify({ tenant_id: deps.tenantId, scan_id: deps.scanId, operation: "recon" }),
    },
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: RECON_SYSTEM },
    { role: "user", content: `Target in scope: ${target.value} (type: ${target.type}). Begin reconnaissance.` },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.chat.completions.create({
      model: deps.model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 1500,
      temperature: 0.2,
    });

    const u = resp.usage;
    const cost = extractCostCents(resp, deps.model);
    spentCents += cost;
    await deps.db.usageRecord.create({
      data: {
        tenantId: deps.tenantId,
        scanId: deps.scanId,
        operation: "recon",
        model: deps.model,
        promptTokens: u?.prompt_tokens ?? 0,
        completionTokens: u?.completion_tokens ?? 0,
        cachedTokens: 0,
        costUsdCents: cost,
        providerRequestId: resp.id,
      },
    });

    if (spentCents > deps.costCeilingCents) {
      summary = summary || "Recon halted: per-scan cost ceiling reached.";
      break;
    }

    const msg = resp.choices[0]?.message;
    if (!msg) break;
    messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    // Claude's own reasoning (when the model narrates before acting) → transcript.
    if (typeof msg.content === "string" && msg.content.trim()) {
      await deps.onEvent?.({ actor: "claude", level: "info", msg: msg.content.trim().slice(0, 400) });
    }

    if (!msg.tool_calls?.length) break; // planner produced no action → done

    let done = false;
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* malformed args */
      }
      const name = tc.function.name;
      // The AI's decision …
      await deps.onEvent?.({ actor: "claude", level: "info", msg: `→ ${name}(${fmtArgs(name, args)})` });
      const result = await dispatch(name, args);
      // … and what the executor did with it.
      if (name === "recon_complete") {
        await deps.onEvent?.({ actor: "claude", level: "ok", msg: "✓ reconnaissance complete" });
        done = true;
      } else {
        const sum = fmtResult(name, result);
        await deps.onEvent?.({ actor: "tool", level: sum.level, msg: `${name}: ${sum.msg}` });
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }

    await deps.onProgress?.(
      Math.min(20 + turn * 4, 90),
      `recon: turn ${turn + 1} · ${exec.results.endpoints.size} endpoints`
    );
    if (done) break;
  }

  logger.info(
    { scanId: deps.scanId, endpoints: exec.results.endpoints.size, blocked: exec.results.blocked, spentCents },
    "recon_finished"
  );
  return {
    results: exec.results,
    summary: summary || `Recon: ${exec.results.endpoints.size} endpoints mapped.`,
    spentCents,
  };
}
