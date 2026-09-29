// Platform OpenRouter keys, managed from Operator → LLM keys.
//
// The LiteLLM gateway is the only store: adding a key registers one extra
// deployment per model alias via /model/new (config.yaml has
// store_model_in_db: true), tagged in model_info so we can list and delete
// them later. They get `order: 1`; the OPENROUTER_API_KEY deployments in
// config.yaml are `order: 2`, so UI keys are tried first and the env key is
// the fallback. The raw key never touches the app DB — LiteLLM encrypts it
// at rest and /model/info returns it masked.

export const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
export const MASTER_KEY = process.env.LITELLM_MASTER_KEY;

// Mirrors model_list in infra/litellm/config.yaml — keep pricing in sync.
export const OPENROUTER_DEPLOYMENTS = [
  {
    alias: "vaptbooster-default",
    params: {
      model: "openrouter/anthropic/claude-sonnet-4.6",
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_creation_input_token_cost: 0.00000375,
      cache_read_input_token_cost: 0.0000003,
    },
  },
  {
    alias: "vaptbooster-fast",
    params: {
      model: "openrouter/anthropic/claude-haiku-4.5",
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000005,
      cache_creation_input_token_cost: 0.00000125,
      cache_read_input_token_cost: 0.0000001,
    },
  },
  {
    alias: "vaptbooster-deep",
    params: {
      model: "openrouter/anthropic/claude-opus-4.8",
      input_cost_per_token: 0.000005,
      output_cost_per_token: 0.000025,
      cache_creation_input_token_cost: 0.00000625,
      cache_read_input_token_cost: 0.0000005,
    },
  },
] as const;

// model_info tag fields (LiteLLM passes custom model_info through verbatim).
export type KeyTag = {
  vb_openrouter_key: string; // our key id — groups the per-alias deployments
  vb_label: string;
  vb_last4: string;
  vb_created_by: string;
  vb_created_at: string;
};

type ModelInfoEntry = {
  model_name: string;
  model_info?: Partial<KeyTag> & { id?: string };
};

export type OpenRouterKeyRow = {
  id: string;
  label: string;
  last4: string;
  createdBy: string;
  createdAt: string;
  aliases: string[]; // which model aliases are currently registered for it
  deploymentIds: string[];
};

export async function litellm(path: string, init?: { method?: string; body?: unknown }) {
  if (!MASTER_KEY) throw new Error("LITELLM_MASTER_KEY is not set in the web environment — can't call the gateway.");
  const res = await fetch(`${LITELLM_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${MASTER_KEY}`, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`LiteLLM ${path} returned ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

// With --num_workers > 1, each LiteLLM worker only picks up /model/new and
// /model/delete on its periodic DB sync (~10-15s measured), so /model/info
// reads flap and a deleted key can still be routed to briefly. Both compose
// files run 1 worker; this wait is a cheap guard before the page re-renders.
export async function waitForGateway(keyId: string, expected: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let streak = 0;
  while (Date.now() < deadline && streak < 4) {
    const rows = await listOpenRouterKeys().catch(() => null);
    const n = rows?.find((k) => k.id === keyId)?.deploymentIds.length ?? 0;
    streak = rows && n === expected ? streak + 1 : 0;
    if (streak < 4) await new Promise((r) => setTimeout(r, 300));
  }
}

/** All UI-managed OpenRouter keys currently registered in the gateway. */
export async function listOpenRouterKeys(): Promise<OpenRouterKeyRow[]> {
  const data = (await litellm("/model/info")) as { data?: ModelInfoEntry[] };
  const byKey = new Map<string, OpenRouterKeyRow>();
  for (const m of data.data ?? []) {
    const info = m.model_info;
    if (!info?.vb_openrouter_key || !info.id) continue;
    let row = byKey.get(info.vb_openrouter_key);
    if (!row) {
      row = {
        id: info.vb_openrouter_key,
        label: info.vb_label ?? "",
        last4: info.vb_last4 ?? "",
        createdBy: info.vb_created_by ?? "",
        createdAt: info.vb_created_at ?? "",
        aliases: [],
        deploymentIds: [],
      };
      byKey.set(row.id, row);
    }
    row.aliases.push(m.model_name);
    row.deploymentIds.push(info.id);
  }
  return [...byKey.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
