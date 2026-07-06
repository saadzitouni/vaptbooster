"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ScopeType } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { requireTenantId } from "@/lib/session";
import { expectedTxtRecord, hostFromValue, checkDnsTxt } from "@/lib/scope-verify";

const TYPES = ["url", "domain", "ip", "repo"] as const;

const addSchema = z.object({
  type: z.enum(TYPES),
  value: z.string().trim().min(3, "Enter a target value.").max(255, "Too long."),
});

type Result = { ok: boolean; message: string };

// Normalize the raw input into a canonical stored value per type.
function normalize(type: ScopeType, raw: string): string {
  let v = raw.trim();
  if (type === "url" && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (type === "domain" || type === "ip") {
    v = v.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
  return type === "repo" ? v : v.toLowerCase();
}

// Reject obviously-malformed values before they hit the DB / a scan.
function validateValue(type: ScopeType, value: string): string | null {
  if (type === "url" || type === "repo") {
    try {
      new URL(value);
      return null;
    } catch {
      return "Enter a valid URL.";
    }
  }
  if (type === "domain") {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value)
      ? null
      : "Enter a valid domain (e.g. example.com).";
  }
  if (type === "ip") {
    return /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)
      ? null
      : "Enter a valid IP or CIDR (e.g. 203.0.113.10 or 203.0.113.0/24).";
  }
  return null;
}

// -------------------------------------------------------------
// Tenant: add a target to scope (→ unverified). It cannot be scanned
// until ownership is verified — that verification IS the authorization.
// -------------------------------------------------------------
export async function addScopeTarget(_prev: Result | null, formData: FormData): Promise<Result> {
  const tenantId = await requireTenantId();
  const parsed = addSchema.safeParse({
    type: formData.get("type"),
    value: formData.get("value"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid target." };
  }
  const type = parsed.data.type as ScopeType;
  const value = normalize(type, parsed.data.value);
  const verr = validateValue(type, value);
  if (verr) return { ok: false, message: verr };

  try {
    await withTenant(tenantId, async (db) => {
      const existing = await db.scopeTarget.findFirst({ where: { value } });
      if (existing) throw new Error("That target is already in your scope.");
      // RLS WITH CHECK ties this row to the current tenant — it can't be
      // inserted under another tenant even if tenantId were forged.
      await db.scopeTarget.create({ data: { tenantId, type, value } });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add target." };
  }
  revalidatePath("/scope");
  revalidatePath("/scans/new");
  return { ok: true, message: `Added ${value}. Verify ownership to make it scannable.` };
}

// -------------------------------------------------------------
// Tenant: verify ownership via DNS TXT. The DNS lookup runs OUTSIDE the
// DB transaction so we never hold a connection open across network I/O.
// -------------------------------------------------------------
export async function verifyScopeTarget(targetId: string): Promise<Result> {
  const tenantId = await requireTenantId();

  const target = await withTenant(tenantId, (db) =>
    db.scopeTarget.findFirst({ where: { id: targetId } })
  );
  if (!target) return { ok: false, message: "Target not found in your scope." };
  if (target.verifiedAt) return { ok: true, message: "Already verified." };
  if (target.type !== "url" && target.type !== "domain") {
    return {
      ok: false,
      message: "Self-serve DNS verification supports domain and URL targets. Ask your operator to verify this type.",
    };
  }

  const host = hostFromValue(target.value);
  if (!host) return { ok: false, message: "Could not derive a hostname from this target." };

  const ok = await checkDnsTxt(host, expectedTxtRecord(targetId));
  if (!ok) {
    return {
      ok: false,
      message: `No matching TXT record found on ${host}. DNS changes can take a few minutes to propagate — try again shortly.`,
    };
  }

  await withTenant(tenantId, (db) =>
    db.scopeTarget.update({
      where: { id: targetId },
      data: { verifiedAt: new Date(), verifyMethod: "dns-txt" },
    })
  );
  revalidatePath("/scope");
  revalidatePath("/scans/new");
  return { ok: true, message: "Ownership verified — this target is now scannable." };
}

// -------------------------------------------------------------
// Tenant: remove a target (blocked if scans reference it — history stays intact).
// -------------------------------------------------------------
export async function removeScopeTarget(targetId: string): Promise<Result> {
  const tenantId = await requireTenantId();
  try {
    await withTenant(tenantId, async (db) => {
      const scanCount = await db.scan.count({ where: { targetId } });
      if (scanCount > 0) {
        throw new Error("This target has scans and can't be removed (history is preserved).");
      }
      await db.scopeTarget.delete({ where: { id: targetId } });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove target." };
  }
  revalidatePath("/scope");
  revalidatePath("/scans/new");
  return { ok: true, message: "Target removed." };
}
