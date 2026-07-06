#!/usr/bin/env tsx
// =============================================================
// run-scan.ts — operator CLI to drive a scan end-to-end.
//
// Stands in for the (not-yet-built) operator approval queue UI:
//   1. resolve the tenant + verified scope target
//   2. create the scan, approved by the operator
//   3. enqueue it for the worker
//
// Runs as the DB owner (bypasses RLS) — like the worker/seed.
//
// Usage:
//   DATABASE_URL=<owner-url> npx tsx scripts/run-scan.ts <tenantSlug> <targetValue> [--authorize]
//
// The --authorize flag marks the target VERIFIED first. Only pass it
// when you hold WRITTEN authorization to test that target — verification
// is the product's authorization gate; nothing scans an unverified target.
// =============================================================
import { PrismaClient, type ScopeType } from "@prisma/client";
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

const [, , slug, targetValue, ...flags] = process.argv;
const authorize = flags.includes("--authorize");
const active = flags.includes("--active");
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

if (!slug || !targetValue) {
  console.error("usage: run-scan.ts <tenantSlug> <targetValue> [--authorize] [--active]");
  process.exit(1);
}

const prisma = new PrismaClient();

function inferType(v: string): ScopeType {
  if (v.startsWith("http://") || v.startsWith("https://")) return "url";
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(v)) return "ip";
  return "domain";
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);

  const operator = await prisma.user.findFirst({ where: { role: "operator" } });
  if (!operator) throw new Error("no operator user found (seed one first)");

  let target = await prisma.scopeTarget.findFirst({
    where: { tenantId: tenant.id, value: targetValue },
  });

  if (!target) {
    if (!authorize)
      throw new Error(
        `'${targetValue}' is not in ${slug}'s scope. Re-run with --authorize to add + authorize it — ONLY if you hold written authorization to test it.`
      );
    target = await prisma.scopeTarget.create({
      data: { tenantId: tenant.id, type: inferType(targetValue), value: targetValue },
    });
  }

  if (!target.verifiedAt) {
    if (!authorize)
      throw new Error(
        `'${targetValue}' is NOT authorized (unverified). Re-run with --authorize to confirm you hold written authorization to test it.`
      );
    target = await prisma.scopeTarget.update({
      where: { id: target.id },
      data: { verifiedAt: new Date(), verifyMethod: "manual" },
    });
    console.log(`  ✓ authorized: ${target.value} (verified · manual)`);
  }

  const scan = await prisma.scan.create({
    data: {
      tenantId: tenant.id,
      targetId: target.id,
      targetValue: target.value,
      status: "queued",
      requesterId: operator.id,
      approverId: operator.id,
      approvedAt: new Date(),
      notes: "Operator CLI run (run-scan.ts)",
    },
  });

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("scans", { connection: connection as unknown as ConnectionOptions });
  await queue.add(
    "scan",
    { scanId: scan.id, tenantId: tenant.id, active },
    { jobId: scan.id, removeOnComplete: 200, removeOnFail: 200 }
  );
  await queue.close();
  connection.disconnect();

  console.log(`  ✓ scan queued: ${scan.id}`);
  console.log(`    tenant : ${tenant.slug}`);
  console.log(`    target : ${target.value}`);
  console.log(`    mode   : ${active ? "ACTIVE (Stage 3 — sends detection payloads)" : "read-only (Stages 1–2)"}`);
  console.log(`    watch  : http://localhost:3000/scans/${scan.id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
