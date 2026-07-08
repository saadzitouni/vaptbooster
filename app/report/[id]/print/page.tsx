import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getReportForPrint } from "@/lib/queries";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { PrintButton } from "@/components/reports/PrintButton";

// Shared print/preview surface for BOTH tenants and operators. Deliberately
// lives at /report/* (NOT /reports/*) so it can't collide with the grouped
// (tenant)/reports and (operator)/operator/reports routes — a top-level
// folder here inherits only the root layout, never a dashboard layout, so an
// operator viewing it is never bounced by the tenant layout's role guard.
export const dynamic = "force-dynamic";

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  const report = await getReportForPrint(
    {
      id: session.user.id,
      role: session.user.role,
      tenantId: session.user.tenantId ?? null,
    },
    id
  );
  if (!report) notFound();

  const backHref =
    session.user.role === "operator"
      ? `/operator/reports/${id}/edit`
      : `/reports/${id}/edit`;

  return (
    <div className="report-shell">
      <div
        className="no-print"
        style={{
          maxWidth: "210mm",
          margin: "0 auto 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href={backHref}
          className="font-mono text-2xs text-fg-mute hover:text-fg"
        >
          ← back to editor
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xs text-fg-mute hidden sm:inline">
            print destination → “Save as PDF”
          </span>
          <PrintButton />
        </div>
      </div>

      <div className="report-doc-frame">
        <ReportDocument report={report} />
      </div>
    </div>
  );
}
