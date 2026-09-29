"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/session";
import { OPENROUTER_DEPLOYMENTS, litellm, listOpenRouterKeys, type KeyTag } from "@/lib/openrouter-keys";

type Result = { ok: boolean; message: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Operator: validate an OpenRouter key and register it in the gateway as the
// preferred (order 1) deployment for every model alias. See lib/openrouter-keys.ts.
export async function addOpenRouterKey(label: string, apiKey: string): Promise<Result> {
  const user = await requireOperator();
  const key = apiKey.trim();
  const name = label.trim().slice(0, 60) || "OpenRouter key";
  if (!/^sk-or-[A-Za-z0-9_-]{10,}$/.test(key)) {
    return { ok: false, message: "That doesn't look like an OpenRouter key (expected sk-or-v1-…)." };
  }

  // Reject bad keys up front instead of letting scans discover it mid-run.
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: "OpenRouter rejected this key (invalid or revoked)." };
    if (!res.ok) return { ok: false, message: `OpenRouter key check returned ${res.status}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach OpenRouter to verify the key: ${errMsg(e)}` };
  }

  const keyId = randomBytes(6).toString("hex");
  const tag: KeyTag = {
    vb_openrouter_key: keyId,
    vb_label: name,
    vb_last4: key.slice(-4),
    vb_created_by: user.email ?? user.id ?? "operator",
    vb_created_at: new Date().toISOString(),
  };

  const created: string[] = [];
  try {
    for (const d of OPENROUTER_DEPLOYMENTS) {
      const id = `orkey-${keyId}-${d.alias}`;
      await litellm("/model/new", {
        method: "POST",
        body: {
          model_name: d.alias,
          litellm_params: { ...d.params, api_key: key, order: 1 },
          model_info: { id, ...tag },
        },
      });
      created.push(id);
    }
  } catch (e) {
    // All-or-nothing: don't leave a key registered for only some aliases.
    await Promise.allSettled(created.map((id) => litellm("/model/delete", { method: "POST", body: { id } })));
    return { ok: false, message: errMsg(e) };
  }

  revalidatePath("/operator/llm-keys");
  return { ok: true, message: `Added "${name}" (…${tag.vb_last4}). New LLM calls use it right away.` };
}

// Operator: remove every gateway deployment registered for this key.
export async function deleteOpenRouterKey(keyId: string): Promise<Result> {
  await requireOperator();
  let row;
  try {
    row = (await listOpenRouterKeys()).find((k) => k.id === keyId);
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
  if (!row) return { ok: false, message: "Key not found — it may already be deleted." };

  const results = await Promise.allSettled(
    row.deploymentIds.map((id) => litellm("/model/delete", { method: "POST", body: { id } }))
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  revalidatePath("/operator/llm-keys");
  if (failed) return { ok: false, message: `${failed} of ${results.length} deployments failed to delete — try again.` };
  return {
    ok: true,
    message: `Deleted "${row.label}" (…${row.last4}). Also revoke it at openrouter.ai if it's no longer needed.`,
  };
}
