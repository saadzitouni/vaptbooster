#!/usr/bin/env tsx
// =============================================================
// create-operator.ts — create (or reset) an operator login in prod.
// Operators are cross-tenant admins (approve scans, see every tenant).
//
// Run against the OWNER db connection:
//   DATABASE_URL=<owner> OPERATOR_EMAIL=you@co.com OPERATOR_PASSWORD='<strong>' \
//     npx tsx scripts/create-operator.ts
// =============================================================
import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OPERATOR_EMAIL ?? process.argv[2];
  const password = process.env.OPERATOR_PASSWORD ?? process.argv[3];
  if (!email || !password) {
    console.error("usage: OPERATOR_EMAIL=… OPERATOR_PASSWORD=… npx tsx scripts/create-operator.ts");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("refusing: operator password must be at least 12 characters.");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.operator, tenantId: null },
    create: { email, name: email.split("@")[0], role: UserRole.operator, passwordHash, tenantId: null },
  });
  console.log(`✓ operator ready: ${user.email}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
