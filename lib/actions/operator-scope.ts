"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ScopeType } from "@prisma/client";
import { withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";

type Result = { ok: boolean; message: string };

const TYPES = ["url", "domain", "ip", "repo"] as const;

function normalize(type: ScopeType, raw: string): string {
  let v = raw.trim();
  if (type === "url" && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (type === "domain" || type === "ip") v = v.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return type === "repo" ? v : v.toLowerCase();
}

function revalidate(tenantId: string) {
  revalidatePath(`/operator/tenants/${tenantId}`);
  revalidatePath("/operator/tenants");
}

// Operator verifies a target = asserting authorization to test it. Cross-tenant
// via withOperator; only ever run this with written authorization in hand.
export async function operatorVerifyTarget(targetId: string, tenantId: string): Promise<Result> {
  await requireOperator();
  await withOperator((db) =>
    db.scopeTarget.update({ where: { id: targetId }, data: { verifiedAt: new Date(), verifyMethod: "manual" } })
  );
  revalidate(tenantId);
  return { ok: true, message: "Verified (manual)." };
}

export async function operatorUnverifyTarget(targetId: string, tenantId: string): Promise<Result> {
  await requireOperator();
  await withOperator((db) => db.scopeTarget.update({ where: { id: targetId }, data: { verifiedAt: null } }));
  revalidate(tenantId);
  return { ok: true, message: "Un-verified." };
}

const addSchema = z.object({
  tenantId: z.string().min(1),
  type: z.enum(TYPES),
  value: z.string().trim().min(3, "Enter a target value.").max(255),
});

export async function operatorAddScopeTarget(_prev: Result | null, formData: FormData): Promise<Result> {
  await requireOperator();
  const parsed = addSchema.safeParse({
    tenantId: formData.get("tenantId"),
    type: formData.get("type"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid target." };
  const { tenantId } = parsed.data;
  const type = parsed.data.type as ScopeType;
  const value = normalize(type, parsed.data.value);
  const verify = formData.get("verify") === "on";
  try {
    await withOperator(async (db) => {
      if (await db.scopeTarget.findFirst({ where: { tenantId, value } })) throw new Error("That target is already in scope.");
      await db.scopeTarget.create({
        data: { tenantId, type, value, ...(verify ? { verifiedAt: new Date(), verifyMethod: "manual" } : {}) },
      });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add target." };
  }
  revalidate(tenantId);
  return { ok: true, message: `Added ${value}${verify ? " (verified)" : " — unverified"}.` };
}

export async function operatorRemoveScopeTarget(targetId: string, tenantId: string): Promise<Result> {
  await requireOperator();
  try {
    await withOperator(async (db) => {
      const count = await db.scan.count({ where: { targetId } });
      if (count > 0) throw new Error("Target has scans — can't remove (history preserved).");
      await db.scopeTarget.delete({ where: { id: targetId } });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove target." };
  }
  revalidate(tenantId);
  return { ok: true, message: "Removed." };
}
