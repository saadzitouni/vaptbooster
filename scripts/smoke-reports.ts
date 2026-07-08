#!/usr/bin/env tsx
// =============================================================
// smoke-reports.ts — data-layer integration test for the Report feature.
//
// Exercises the real withTenant()/withOperator() security wrappers (as the
// low-privilege app role, so RLS is genuinely enforced) against the dev DB:
//   create → snapshot findings → update → cross-tenant isolation →
//   operator cross-tenant read → delete.
//
//   npx tsx scripts/smoke-reports.ts
// =============================================================
import { readFileSync } from "fs";
import { join } from "path";

// Load .env before importing lib/db (PrismaClient reads env at construction).
try {
  const envText = readFileSync(join(process.cwd(), ".env"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch {
  /* env may already be set */
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  // Imported here (not top-level) so tsx's CJS transform is happy and so
  // PrismaClient constructs only after .env is loaded above.
  const { withTenant, withOperator, prisma } = await import("../lib/db");
  const { normalizeFindings } = await import("../lib/report");

  console.log("== Report data-layer smoke test ==\n");

  const tenants = await withOperator((db) =>
    db.tenant.findMany({ orderBy: { createdAt: "asc" }, take: 3 })
  );
  check("has at least one tenant", tenants.length >= 1, `(found ${tenants.length})`);
  if (tenants.length === 0) throw new Error("No tenants to test against.");

  const A = tenants[0];
  const B = tenants[1]; // may be undefined
  console.log(`  tenant A = ${A.name} (${A.id})`);
  if (B) console.log(`  tenant B = ${B.name} (${B.id})`);

  // A scan in A that produced findings (for the snapshot path).
  const scanWithFindings = await withTenant(A.id, async (db) => {
    const scans = await db.scan.findMany({
      include: { _count: { select: { findings: true } } },
      orderBy: { requestedAt: "desc" },
    });
    return scans.find((s) => s._count.findings > 0) ?? null;
  });
  console.log(
    scanWithFindings
      ? `  scan with findings = ${scanWithFindings.targetValue} (${scanWithFindings.id})\n`
      : "  (no scan with findings — snapshot path will use a synthetic finding)\n"
  );

  let reportId = "";
  try {
    // ---- CREATE ----
    console.log("CREATE");
    const created = await withTenant(A.id, (db) =>
      db.report.create({
        data: {
          tenantId: A.id,
          createdByRole: "tenant",
          title: "Smoke Test Report",
          clientName: A.name,
        },
        select: { id: true, title: true, status: true, findings: true },
      })
    );
    reportId = created.id;
    check("report created", !!created.id);
    check("default status is draft", created.status === "draft", `(got ${created.status})`);
    check("findings default to []", normalizeFindings(created.findings).length === 0);

    // ---- SNAPSHOT FINDINGS ----
    console.log("SNAPSHOT FINDINGS");
    const snapshot = await withTenant(A.id, async (db) => {
      let rows: { id: string; title: string; severity: string; cwe: string | null; location: string | null; summary: string | null; remediation: string | null }[] = [];
      if (scanWithFindings) {
        rows = (await db.finding.findMany({
          where: { scanId: scanWithFindings.id },
        })) as typeof rows;
      }
      const findings = rows.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        cwe: f.cwe ?? "",
        location: f.location ?? "",
        description: f.summary ?? "",
        remediation: f.remediation ?? "",
      }));
      // Always include one synthetic finding so the assertion is meaningful.
      findings.push({
        id: "synthetic-1",
        title: "Missing X-Frame-Options on all routes",
        severity: "medium",
        cwe: "CWE-1021",
        location: "All routes",
        description: "Clickjacking protection header absent.",
        remediation: "Set X-Frame-Options: DENY (or CSP frame-ancestors).",
      });
      await db.report.update({
        where: { id: reportId },
        data: { findings: findings as unknown as object, scanId: scanWithFindings?.id ?? null },
      });
      return findings.length;
    });
    check("findings snapshotted", snapshot >= 1, `(count=${snapshot})`);

    // ---- READ BACK ----
    console.log("READ BACK (tenant A)");
    const readA = await withTenant(A.id, (db) =>
      db.report.findFirst({ where: { id: reportId } })
    );
    check("report readable by owning tenant", !!readA);
    check(
      "findings round-trip intact",
      normalizeFindings(readA?.findings).length === snapshot,
      `(got ${normalizeFindings(readA?.findings).length})`
    );
    check(
      "synthetic finding severity preserved",
      normalizeFindings(readA?.findings).some((f) => f.id === "synthetic-1" && f.severity === "medium")
    );

    // ---- UPDATE ----
    console.log("UPDATE");
    await withTenant(A.id, (db) =>
      db.report.update({
        where: { id: reportId },
        data: { title: "Smoke Test Report (edited)", confidential: false, status: "final" },
      })
    );
    const edited = await withTenant(A.id, (db) =>
      db.report.findFirst({ where: { id: reportId } })
    );
    check("title updated", edited?.title === "Smoke Test Report (edited)");
    check("confidential toggled", edited?.confidential === false);
    check("status → final", edited?.status === "final");
    check("updatedAt advanced", !!edited && edited.updatedAt >= edited.generatedAt);

    // ---- RLS ISOLATION ----
    console.log("RLS ISOLATION");
    if (B) {
      const leak = await withTenant(B.id, (db) =>
        db.report.findFirst({ where: { id: reportId } })
      );
      check("tenant B CANNOT see tenant A's report (RLS)", leak === null, leak ? "(LEAK!)" : "");
      const countB = await withTenant(B.id, (db) => db.report.count());
      const aReportVisibleToB = await withTenant(B.id, (db) =>
        db.report.findMany({ where: { tenantId: A.id } })
      );
      check("tenant B report list excludes A's rows", aReportVisibleToB.length === 0, `(B sees ${countB} of own)`);
    } else {
      console.log("  – skipped (only one tenant present)");
    }

    // ---- OPERATOR CROSS-TENANT READ ----
    console.log("OPERATOR READ");
    const opRead = await withOperator((db) =>
      db.report.findUnique({ where: { id: reportId }, include: { tenant: { select: { name: true } } } })
    );
    check("operator can read across tenants", !!opRead);
    check("operator sees tenant name", opRead?.tenant?.name === A.name);

    const opList = await withOperator((db) => db.report.findMany());
    check("operator list includes the report", opList.some((r) => r.id === reportId));
  } finally {
    // ---- DELETE (cleanup) ----
    if (reportId) {
      console.log("DELETE (cleanup)");
      await withTenant(A.id, (db) => db.report.delete({ where: { id: reportId } }));
      const gone = await withTenant(A.id, (db) =>
        db.report.findFirst({ where: { id: reportId } })
      );
      check("report deleted", gone === null);
    }
  }

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
