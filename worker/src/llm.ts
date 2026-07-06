// =============================================================
// LLM client — talks to self-hosted LiteLLM proxy
//
// Every call carries tenant_id + scan_id + operation as metadata.
// LiteLLM logs these into its spend ledger; we also write our own
// usage_records row so the operator dashboard has fast lookups.
//
// IMPORTANT: never call providers (Anthropic/OpenAI) directly from
// anywhere in this codebase. Always go through LiteLLM. The whole
// cost tracking, budget enforcement, and provider routing layer
// only works if every call funnels through this client.
// =============================================================

import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";

// Per-token pricing (USD) mirroring infra/litellm/config.yaml — used only as
// a fallback to estimate cost when LiteLLM doesn't return response_cost, so the
// in-worker per-scan ceiling still functions on the real path.
const PRICING: Record<string, { in: number; out: number }> = {
  "vaptbooster-fast": { in: 0.000001, out: 0.000005 },
  "vaptbooster-default": { in: 0.000003, out: 0.000015 },
  "vaptbooster-deep": { in: 0.000005, out: 0.000025 },
};

export type LLMCallContext = {
  tenantId: string;
  tenantVirtualKey: string; // per-tenant LiteLLM key
  scanId?: string;
  operation: "recon" | "fuzz" | "exploit" | "validate" | "report" | "chat";
};

export type LLMCallResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsdCents: number;
  latencyMs: number;
  providerRequestId?: string;
};

/**
 * Make an LLM call through LiteLLM. Always writes a usage_record.
 * Throws BudgetExceededError if the tenant has run out of budget —
 * the caller (scan worker) catches it and pauses the scan.
 */
export async function llmCall(
  ctx: LLMCallContext,
  args: {
    model: "vaptbooster-default" | "vaptbooster-fast" | "vaptbooster-deep";
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    maxTokens?: number;
    temperature?: number;
  },
  db: PrismaClient
): Promise<LLMCallResult> {
  // Simulate mode — run the full scan loop (progress, findings, usage
  // records, cost/ceiling enforcement) without a live LiteLLM/provider.
  // Real provider wiring lands in Phase 4.
  if (process.env.SIMULATE_LLM === "true") {
    return simulateCall(ctx, args, db);
  }

  const client = new OpenAI({
    apiKey: ctx.tenantVirtualKey,
    baseURL: LITELLM_URL,
    defaultHeaders: {
      // LiteLLM picks these up and attaches them to its spend log
      "x-litellm-metadata": JSON.stringify({
        tenant_id: ctx.tenantId,
        scan_id: ctx.scanId,
        operation: ctx.operation,
      }),
    },
  });

  const t0 = Date.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens ?? 4096,
      temperature: args.temperature ?? 0.2,
    });
  } catch (err) {
    // LiteLLM returns 429 when budget exceeded
    const e = err as { status?: number; message?: string };
    if (e.status === 429 && /budget/i.test(e.message ?? "")) {
      throw new BudgetExceededError(ctx.tenantId);
    }
    throw err;
  }
  const latencyMs = Date.now() - t0;

  const usage = response.usage;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  // LiteLLM exposes cached tokens here when caching is configured:
  const cachedTokens = (usage as { cached_tokens?: number })?.cached_tokens ?? 0;

  // LiteLLM returns the computed cost on usage.response_cost when enabled.
  // If it's missing, estimate from tokens + our pricing table so the per-scan
  // cost ceiling still functions (a silent 0 would let cost run away).
  let costUsdCents = extractCostCents(response);
  if (costUsdCents === 0 && (promptTokens > 0 || completionTokens > 0)) {
    const p = PRICING[args.model] ?? PRICING["vaptbooster-default"];
    costUsdCents = Math.round(
      (promptTokens * p.in + completionTokens * p.out) * 100
    );
    logger.warn(
      { model: args.model, tenantId: ctx.tenantId, scanId: ctx.scanId, costUsdCents },
      "litellm_response_cost_missing_estimated_from_tokens"
    );
  }

  // Persist the usage record. Use $executeRawUnsafe so we don't
  // trip up on RLS — this is internal bookkeeping, system context.
  await db.usageRecord.create({
    data: {
      tenantId: ctx.tenantId,
      scanId: ctx.scanId,
      operation: ctx.operation,
      model: args.model,
      promptTokens,
      completionTokens,
      cachedTokens,
      costUsdCents,
      providerLatencyMs: latencyMs,
      providerRequestId: response.id,
    },
  });

  logger.info(
    {
      tenantId: ctx.tenantId,
      scanId: ctx.scanId,
      operation: ctx.operation,
      model: args.model,
      promptTokens,
      completionTokens,
      costUsdCents,
      latencyMs,
    },
    "llm_call"
  );

  return {
    text: response.choices[0]?.message?.content ?? "",
    promptTokens,
    completionTokens,
    cachedTokens,
    costUsdCents,
    latencyMs,
    providerRequestId: response.id,
  };
}

/**
 * Simulated LLM call — no network. Produces plausible token counts and
 * cost, writes a real usage_record, and returns simulated text so the
 * scan loop behaves end-to-end.
 */
async function simulateCall(
  ctx: LLMCallContext,
  args: { model: string; messages: { role: string; content: string }[] },
  db: PrismaClient
): Promise<LLMCallResult> {
  const promptTokens = 6000 + Math.floor(Math.random() * 4000);
  const completionTokens = 800 + Math.floor(Math.random() * 1200);
  const cachedTokens = Math.floor(promptTokens * 0.2);
  const perKCompletion =
    args.model === "vaptbooster-deep" ? 6 : args.model === "vaptbooster-fast" ? 0.5 : 2;
  const costUsdCents = Math.max(
    1,
    Math.round((completionTokens / 1000) * perKCompletion + (promptTokens / 1000) * 0.3)
  );
  const latencyMs = 400 + Math.floor(Math.random() * 1500);
  const providerRequestId = `sim_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  await db.usageRecord.create({
    data: {
      tenantId: ctx.tenantId,
      scanId: ctx.scanId,
      operation: ctx.operation,
      model: args.model,
      promptTokens,
      completionTokens,
      cachedTokens,
      costUsdCents,
      providerLatencyMs: latencyMs,
      providerRequestId,
    },
  });

  logger.info(
    { tenantId: ctx.tenantId, scanId: ctx.scanId, operation: ctx.operation, model: args.model, costUsdCents, simulated: true },
    "llm_call_simulated"
  );

  const last = args.messages[args.messages.length - 1]?.content ?? "";
  return {
    text: `[simulated:${ctx.operation}] ${last.slice(0, 120)}`,
    promptTokens,
    completionTokens,
    cachedTokens,
    costUsdCents,
    latencyMs,
    providerRequestId,
  };
}

export class BudgetExceededError extends Error {
  constructor(public tenantId: string) {
    super(`Tenant ${tenantId} has exceeded its LiteLLM budget`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Extract cost-in-cents from a LiteLLM response. LiteLLM sets
 * the field on response.usage when configured; fall back to 0
 * (the proxy still tracks cost internally either way).
 */
function extractCostCents(
  response: OpenAI.Chat.Completions.ChatCompletion
): number {
  // LiteLLM extends the usage object with response_cost (USD).
  const usage = response.usage as
    | (OpenAI.Completions.CompletionUsage & { response_cost?: number })
    | undefined;
  if (usage?.response_cost != null) {
    return Math.round(usage.response_cost * 100);
  }
  return 0;
}
