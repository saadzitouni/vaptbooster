"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { withTenant, withOperator, type TxClient } from "@/lib/db";
import {
  LOGO_MAX_BYTES,
  normalizeFindings,
  type ReportFinding,
  type ReportSeverity,
} from "@/lib/report";

// -------------------------------------------------------------
// Actor resolution — reports are authored by tenant members OR operators.
// -------------------------------------------------------------
type Actor =
  | { role: "operator"; userId: string; tenantId: null }
  | { role: "tenant"; userId: string; tenantId: string };

async function requireActor(): Promise<Actor> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "operator") {
    return { role: "operator", userId: session.user.id, tenantId: null };
  }
  if (!session.user.tenantId) redirect("/login");
  return {
    role: "tenant",
    userId: session.user.id,
    tenantId: session.user.tenantId,
  };
}

// Run a DB op in the actor's security context (RLS for tenants, bypass for
// operators). `tenantId` is the report's tenant (used only for tenant actors).
function runAs<T>(
  actor: Actor,
  tenantId: string,
  fn: (db: TxClient) => Promise<T>
): Promise<T> {
  return actor.role === "operator" ? withOperator(fn) : withTenant(tenantId, fn);
}

const editPath = (actor: Actor, id: string) =>
  actor.role === "operator" ? `/operator/reports/${id}/edit` : `/reports/${id}/edit`;
const listPath = (actor: Actor) =>
  actor.role === "operator" ? "/operator/reports" : "/reports";

// -------------------------------------------------------------
// Finding snapshot — map a live Finding row into an embeddable ReportFinding.
// -------------------------------------------------------------
type FindingRow = {
  id: string;
  title: string;
  severity: string;
  cwe: string | null;
  location: string | null;
  summary: string | null;
  remediation: string | null;
};

function toReportFinding(f: FindingRow): ReportFinding {
  return {
    id: f.id,
    title: f.title,
    severity: f.severity as ReportSeverity,
    cwe: f.cwe ?? "",
    location: f.location ?? "",
    description: f.summary ?? "",
    remediation: f.remediation ?? "",
  };
}

// -------------------------------------------------------------
// Create — tenant: own tenant; operator: must name the target tenant.
// Optionally snapshots a scan's findings into the new report.
// Redirects to the editor.
// -------------------------------------------------------------
const createSchema = z.object({
  tenantId: z.string().optional(),
  scanId: z.string().optional(),
  title: z.string().trim().max(300).optional(),
});

export async function createReport(input: {
  tenantId?: string;
  scanId?: string;
  title?: string;
}) {
  const actor = await requireActor();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid report request.");
  const { scanId, title } = parsed.data;

  // Resolve the target tenant.
  const tenantId =
    actor.role === "operator" ? parsed.data.tenantId ?? "" : actor.tenantId;
  if (!tenantId) throw new Error("Choose a client (tenant) for this report.");

  let newId = "";
  await runAs(actor, tenantId, async (db) => {
    // For operators, confirm the tenant exists (RLS won't guard them).
    if (actor.role === "operator") {
      const t = await db.tenant.findUnique({ where: { id: tenantId } });
      if (!t) throw new Error("Tenant not found.");
    }
    const tenant = await db.tenant.findFirst({ where: { id: tenantId } });

    // Optional findings snapshot.
    let findings: ReportFinding[] = [];
    if (scanId) {
      const scan = await db.scan.findFirst({ where: { id: scanId, tenantId } });
      if (!scan) throw new Error("Scan not found for this client.");
      const rows = (await db.finding.findMany({
        where: { scanId },
        orderBy: [{ severity: "asc" }, { discoveredAt: "desc" }],
      })) as FindingRow[];
      findings = rows.map(toReportFinding);
    }

    const report = await db.report.create({
      data: {
        tenantId,
        scanId: scanId ?? null,
        createdById: actor.userId,
        createdByRole: actor.role,
        title: title || "Security Assessment Report",
        clientName: tenant?.name ?? "",
        clientTagline: tenant?.industry ?? null,
        findings: findings as unknown as object,
      },
      select: { id: true },
    });
    newId = report.id;
  });

  revalidatePath(listPath(actor));
  redirect(editPath(actor, newId));
}

// -------------------------------------------------------------
// Update — persist the full editable surface. Returns inline feedback.
// -------------------------------------------------------------
// Findings are coerced (normalizeFindings) rather than strict-validated, so a
// stray/undefined field on an older or imported finding can never fail the save
// with an opaque "Invalid input". Optional/defaulted fields below are likewise
// tolerant of undefined for the same reason.
const FIELD_CAP = 20000;
const clampFinding = (f: ReportFinding): ReportFinding => ({
  ...f,
  id: f.id.slice(0, 64),
  title: f.title.slice(0, 300),
  cwe: f.cwe.slice(0, 40),
  location: f.location.slice(0, 500),
  description: f.description.slice(0, FIELD_CAP),
  remediation: f.remediation.slice(0, FIELD_CAP),
});

const updateSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(300),
  clientName: z.string().max(200).optional().default(""),
  clientTagline: z.string().max(200).nullable().optional(),
  engagementRef: z.string().max(200).nullable().optional(),
  preparedBy: z.string().max(200).optional().default(""),
  logoDataUrl: z
    .string()
    .max(900_000)
    .nullable()
    .optional()
    .refine(
      (v) => !v || v.startsWith("data:image/"),
      "Logo must be an image data URL."
    ),
  executiveSummary: z.string().max(50000).nullable().optional(),
  scopeText: z.string().max(50000).nullable().optional(),
  methodology: z.string().max(50000).nullable().optional(),
  findings: z.array(z.unknown()).max(500).optional().default([]),
  confidential: z.boolean().optional().default(true),
});

export async function updateReport(
  id: string,
  data: z.input<typeof updateSchema>
): Promise<{ ok: boolean; message: string }> {
  const actor = await requireActor();
  const parsed = updateSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Name the offending field — "Invalid input" alone is useless to diagnose.
    const where = issue?.path.length ? issue.path.join(".") : "form";
    return {
      ok: false,
      message: issue ? `${where}: ${issue.message}` : "Invalid report data.",
    };
  }
  const d = parsed.data;
  // Coerce findings to valid ReportFindings (never rejects) + cap field lengths.
  const findings = normalizeFindings(d.findings).slice(0, 500).map(clampFinding);

  // Hard cap on logo bytes (base64 → bytes ≈ len * 3/4).
  if (d.logoDataUrl) {
    const approxBytes = Math.floor((d.logoDataUrl.length * 3) / 4);
    if (approxBytes > LOGO_MAX_BYTES) {
      return { ok: false, message: "Logo is too large (max 512 KB)." };
    }
  }

  try {
    // Find the tenant first (tenant actors are RLS-scoped; operators aren't,
    // so we read the row to learn its tenant and edit in that context).
    const tenantId = actor.role === "tenant" ? actor.tenantId : "";
    await runAs(actor, tenantId, async (db) => {
      const existing = await db.report.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new Error("Report not found.");
      await db.report.update({
        where: { id },
        data: {
          title: d.title,
          clientName: d.clientName,
          clientTagline: d.clientTagline ?? null,
          engagementRef: d.engagementRef ?? null,
          preparedBy: d.preparedBy,
          logoDataUrl: d.logoDataUrl ?? null,
          executiveSummary: d.executiveSummary ?? null,
          scopeText: d.scopeText ?? null,
          methodology: d.methodology ?? null,
          findings: findings as unknown as object,
          confidential: d.confidential,
        },
      });
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not save report.",
    };
  }

  revalidatePath(editPath(actor, id));
  revalidatePath(listPath(actor));
  revalidatePath(`/report/${id}/print`);
  return { ok: true, message: "Saved." };
}

// -------------------------------------------------------------
// Import findings from a scan — returns them so the client can merge into
// its local (possibly unsaved) editor state, then Save.
// -------------------------------------------------------------
export async function importScanFindings(
  reportId: string,
  scanId: string
): Promise<{ ok: boolean; message: string; findings: ReportFinding[] }> {
  const actor = await requireActor();
  try {
    const tenantId = actor.role === "tenant" ? actor.tenantId : "";
    const findings = await runAs(actor, tenantId, async (db) => {
      const report = await db.report.findFirst({
        where: { id: reportId },
        select: { tenantId: true },
      });
      if (!report) throw new Error("Report not found.");
      const scan = await db.scan.findFirst({
        where: { id: scanId, tenantId: report.tenantId },
        select: { id: true },
      });
      if (!scan) throw new Error("Scan not found for this client.");
      const rows = (await db.finding.findMany({
        where: { scanId },
        orderBy: [{ severity: "asc" }, { discoveredAt: "desc" }],
      })) as FindingRow[];
      return rows.map(toReportFinding);
    });
    return {
      ok: true,
      message: `Imported ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
      findings,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not import findings.",
      findings: [],
    };
  }
}

// -------------------------------------------------------------
// Status toggle (draft ⇆ final)
// -------------------------------------------------------------
export async function setReportStatus(
  id: string,
  status: "draft" | "final"
): Promise<{ ok: boolean; message: string }> {
  const actor = await requireActor();
  if (status !== "draft" && status !== "final") {
    return { ok: false, message: "Invalid status." };
  }
  try {
    const tenantId = actor.role === "tenant" ? actor.tenantId : "";
    await runAs(actor, tenantId, async (db) => {
      const existing = await db.report.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new Error("Report not found.");
      await db.report.update({ where: { id }, data: { status } });
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not update status.",
    };
  }
  revalidatePath(editPath(actor, id));
  revalidatePath(listPath(actor));
  return { ok: true, message: status === "final" ? "Marked final." : "Reopened as draft." };
}

// -------------------------------------------------------------
// Delete
// -------------------------------------------------------------
export async function deleteReport(id: string) {
  const actor = await requireActor();
  const tenantId = actor.role === "tenant" ? actor.tenantId : "";
  await runAs(actor, tenantId, async (db) => {
    const existing = await db.report.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new Error("Report not found.");
    await db.report.delete({ where: { id } });
  });
  revalidatePath(listPath(actor));
  redirect(listPath(actor));
}
