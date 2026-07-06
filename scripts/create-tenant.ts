#!/usr/bin/env tsx
// =============================================================
// create-tenant.ts — onboard a client tenant + first member login in prod.
// After this, provision their LiteLLM key (scripts/provision-tenant-key.ts) and
// have them verify a scope target before any scan.
//
//   DATABASE_URL=<owner> npx tsx scripts/create-tenant.ts <slug> <name> <memberEmail> <memberPassword> [plan]
//     plan = solo (default) | team | enterprise
// =============================================================
import { PrismaClient, PlanTier, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CREDITS: Record<string, number> = { solo: 10, team: 50, enterprise: 200 };

async function main() {
  const [, , slug, name, email, password, planArg] = process.argv;
  if (!slug || !name || !email || !password) {
    console.error("usage: create-tenant.ts <slug> <name> <memberEmail> <memberPassword> [plan]");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("refusing: member password must be at least 10 characters.");
    process.exit(1);
  }
  const plan = (planArg ?? "solo") as PlanTier;
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: { name },
    create: {
      slug,
      name,
      budget: {
        create: {
          plan,
          monthlyCreditsIncluded: CREDITS[plan] ?? 10,
          monthlyHardCeilingUsdCents: 50000,
          currentPeriodStart: new Date(),
        },
      },
    },
  });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, tenantId: tenant.id, role: UserRole.member },
    create: { email, name: email.split("@")[0], role: UserRole.member, tenantId: tenant.id, passwordHash },
  });
  console.log(`✓ tenant '${tenant.slug}' + member ${email} ready (plan: ${plan})`);
  console.log(`  next: provision-tenant-key.ts ${slug}  →  client verifies scope  →  approve + run`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
