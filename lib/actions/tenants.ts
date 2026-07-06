"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { PlanTier, UserRole } from "@prisma/client";
import { withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";

type Result = { ok: boolean; message: string };

const CREDITS: Record<string, number> = { solo: 10, team: 50, enterprise: 200 };

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
              monthlyCreditsIncluded: CREDITS[plan] ?? 10,
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
