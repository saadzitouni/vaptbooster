#!/usr/bin/env tsx
// =============================================================
// verify-target.ts — operator: mark a scope target VERIFIED (authorization).
//
// Verification IS the authorization gate — a scan only runs against a verified
// target. Use this ONLY when you hold WRITTEN authorization to test the target
// (signed engagement / Rules of Engagement).
//
//   DATABASE_URL=<owner> npx tsx scripts/verify-target.ts <tenantSlug> <targetValue> [--create]
//
//   --create   add the target to the tenant's scope if it isn't there yet
// =============================================================
import { PrismaClient, type ScopeType } from "@prisma/client";

const prisma = new PrismaClient();
const [, , slug, value, ...flags] = process.argv;
const create = flags.includes("--create");

if (!slug || !value) {
  console.error("usage: verify-target.ts <tenantSlug> <targetValue> [--create]");
  process.exit(1);
}

function inferType(v: string): ScopeType {
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(v)) return "ip";
  return "domain";
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);

  let target = await prisma.scopeTarget.findFirst({ where: { tenantId: tenant.id, value } });
  if (!target) {
    if (!create) throw new Error(`'${value}' is not in ${slug}'s scope. Re-run with --create to add + verify it.`);
    target = await prisma.scopeTarget.create({ data: { tenantId: tenant.id, type: inferType(value), value } });
  }

  const updated = await prisma.scopeTarget.update({
    where: { id: target.id },
    data: { verifiedAt: new Date(), verifyMethod: "manual" },
  });
  console.log(`✓ verified: ${updated.value} (${updated.type}) for tenant '${slug}' — method: manual`);
  console.log("  It can now be scanned. ⚠ Only do this when you hold written authorization to test it.");
}

main()
  .catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
