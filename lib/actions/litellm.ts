"use server";

import { revalidatePath } from "next/cache";
import { withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";

const LITELLM_URL = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
const MASTER_KEY = process.env.LITELLM_MASTER_KEY;

type Result = { ok: boolean; message: string };

// Operator: mint a per-tenant LiteLLM virtual key (budget + cost metering) and
// store it on the tenant. The worker + runner read it from the DB.
export async function provisionTenantKey(tenantId: string): Promise<Result> {
  await requireOperator();
  if (!MASTER_KEY) {
    return { ok: false, message: "LITELLM_MASTER_KEY is not set in the web environment — can't call the gateway." };
  }

  const tenant = await withOperator((db) =>
    db.tenant.findUnique({ where: { id: tenantId }, include: { budget: true } })
  );
  if (!tenant) return { ok: false, message: "Tenant not found." };
  if (tenant.litellmKeyId) return { ok: false, message: `Tenant already has a key (${tenant.litellmKeyId}).` };

  const budgetUsd = (tenant.budget?.monthlyHardCeilingUsdCents ?? 50_000) / 100;

  let data: { key?: string; key_name?: string };
  try {
    const res = await fetch(`${LITELLM_URL}/key/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MASTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key_alias: `tenant-${tenant.slug}`,
        max_budget: budgetUsd,
        budget_duration: "30d",
        models: ["vaptbooster-default", "vaptbooster-fast", "vaptbooster-deep"],
        metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
        // The agentic loop re-sends a growing transcript every turn, so a low
        // TPM throttle stalls scans (LiteLLM 429s the key). max_budget is the
        // real cost guard; keep the throughput throttle generous.
        tpm_limit: 4_000_000,
        rpm_limit: 1_000,
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `LiteLLM /key/generate returned ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }
    data = (await res.json()) as { key?: string; key_name?: string };
  } catch (e) {
    return { ok: false, message: `Could not reach LiteLLM at ${LITELLM_URL}: ${e instanceof Error ? e.message : String(e)}` };
  }

  const rawKey = data.key;
  const keyId = data.key_name ?? rawKey;
  if (!rawKey) return { ok: false, message: "LiteLLM did not return a key." };

  // Persist on the tenant (operator context bypasses RLS). Raw SQL so we don't
  // need the generated client to know the litellmKey column.
  await withOperator((db) =>
    db.$executeRawUnsafe('UPDATE tenants SET "litellmKeyId" = $1, "litellmKey" = $2 WHERE id = $3', keyId, rawKey, tenantId)
  );

  revalidatePath(`/operator/tenants/${tenantId}`);
  revalidatePath("/operator/tenants");
  return { ok: true, message: `Key provisioned — $${budgetUsd.toFixed(0)}/mo budget. Scans can now run for this tenant.` };
}
