"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { PlanTier, UserRole } from "@prisma/client";
import { withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";
import { PLAN_KEYS, planScans, planLabel, type PlanKey } from "@/lib/plans";

type Result = { ok: boolean; message: string };

const schema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Slug: lowercase letters, numbers, hyphens.")
    .min(2, "Slug too short.")
    .max(40),
  name: z.string().trim().min(2, "Name too short.").max(80),
  memberEmail: z.string().trim().toLowerCase().email("Enter a valid email."),
  memberPassword: z.string().min(10, "Member password must be at least 10 characters."),
  plan: z.enum(["solo", "team", "enterprise"]),
});

// -------------------------------------------------------------
// Operator: create a client tenant + its first member login.
// (LiteLLM key provisioning stays a separate step.)
// -------------------------------------------------------------
export async function createTenant(_prev: Result | null, formData: FormData): Promise<Result> {
  await requireOperator();
  const parsed = schema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    memberEmail: formData.get("memberEmail"),
    memberPassword: formData.get("memberPassword"),
    plan: formData.get("plan") ?? "solo",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { slug, name, memberEmail, memberPassword, plan } = parsed.data;
  // Hash outside the transaction (bcrypt is slow — don't hold the tx open).
  const passwordHash = await bcrypt.hash(memberPassword, 12);

  try {
    await withOperator(async (db) => {
      if (await db.tenant.findUnique({ where: { slug } })) throw new Error(`Slug '${slug}' is already taken.`);
      if (await db.user.findUnique({ where: { email: memberEmail } })) throw new Error(`Email '${memberEmail}' is already in use.`);
      const tenant = await db.tenant.create({
        data: {
          slug,
          name,
          budget: {
            create: {
              plan: plan as PlanTier,
              monthlyCreditsIncluded: planScans(plan),
              monthlyHardCeilingUsdCents: 50000,
              currentPeriodStart: new Date(),
            },
          },
        },
      });
      await db.user.create({
        data: { email: memberEmail, name: memberEmail.split("@")[0], role: UserRole.member, tenantId: tenant.id, passwordHash },
      });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create tenant." };
  }
  revalidatePath("/operator/tenants");
  revalidatePath("/operator");
  return { ok: true, message: `Tenant '${slug}' created with member ${memberEmail}. Provision its LiteLLM key next.` };
}

// -------------------------------------------------------------
// Operator: plan & quota management for an existing tenant.
// -------------------------------------------------------------
function revalTenant(tenantId: string) {
  revalidatePath(`/operator/tenants/${tenantId}`);
  revalidatePath("/operator/tenants");
  revalidatePath("/operator/usage");
}

// Change a tenant's plan — also sets the scan quota to the plan's default.
export async function operatorSetTenantPlan(
  tenantId: string,
  plan: string
): Promise<Result> {
  await requireOperator();
  if (!PLAN_KEYS.includes(plan as PlanKey)) return { ok: false, message: "Invalid plan." };
  try {
    await withOperator((db) =>
      db.tenantBudget.upsert({
        where: { tenantId },
        update: { plan: plan as PlanTier, monthlyCreditsIncluded: planScans(plan) },
        create: {
          tenantId,
          plan: plan as PlanTier,
          monthlyCreditsIncluded: planScans(plan),
          monthlyHardCeilingUsdCents: 50000,
          currentPeriodStart: new Date(),
        },
      })
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change plan." };
  }
  revalTenant(tenantId);
  return { ok: true, message: `Plan set to ${planLabel(plan)} — ${planScans(plan)} scans/period.` };
}

// Override the scan quota (custom / one-off top-up) without changing the plan.
export async function operatorSetScanLimit(
  tenantId: string,
  scans: number
): Promise<Result> {
  await requireOperator();
  const n = Math.max(0, Math.min(100000, Math.floor(Number(scans) || 0)));
  try {
    await withOperator((db) =>
      db.tenantBudget.update({ where: { tenantId }, data: { monthlyCreditsIncluded: n } })
    );
  } catch {
    return { ok: false, message: "No budget on this tenant yet — set a plan first." };
  }
  revalTenant(tenantId);
  return { ok: true, message: `Scan limit set to ${n}/period.` };
}

// Reset the SCAN quota (fresh allotment, new 30-day scan window starting now).
// Deliberately does NOT touch currentPeriodStart, so cost/spend tracking is
// preserved.
export async function operatorResetTenantPeriod(tenantId: string): Promise<Result> {
  await requireOperator();
  try {
    await withOperator((db) =>
      db.tenantBudget.update({
        where: { tenantId },
        data: { scanPeriodStart: new Date(), creditsUsedThisPeriod: 0 },
      })
    );
  } catch {
    return { ok: false, message: "No budget on this tenant yet — set a plan first." };
  }
  revalTenant(tenantId);
  return { ok: true, message: "Scan quota reset — usage back to 0 (cost tracking kept)." };
}
