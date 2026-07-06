"use server";

import { revalidatePath } from "next/cache";
import type { FindingStatus } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { requireTenantId } from "@/lib/session";

const STATUSES = ["open", "triaged", "fixed", "wontfix", "duplicate"] as const;

export async function updateFindingStatus(findingId: string, status: string) {
  const tenantId = await requireTenantId();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Invalid finding status.");
  }
  await withTenant(tenantId, async (db) => {
    // RLS scopes this to the tenant — a foreign findingId affects 0 rows.
    // Stamp fixedAt when moving INTO "fixed"; leave the historical timestamp
    // untouched on other transitions rather than nulling it.
    await db.finding.update({
      where: { id: findingId },
      data: {
        status: status as FindingStatus,
        ...(status === "fixed" ? { fixedAt: new Date() } : {}),
      },
    });
  });
  revalidatePath("/findings");
  revalidatePath("/dashboard");
}
