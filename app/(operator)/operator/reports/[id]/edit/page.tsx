import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOperator } from "@/lib/session";
import { getOperatorReport, getOperatorImportableScans } from "@/lib/queries";
import { ReportEditor } from "@/components/reports/ReportEditor";

export const dynamic = "force-dynamic";

export default async function OperatorEditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOperator();
  const { id } = await params;
  const report = await getOperatorReport(id);
  if (!report) notFound();
  const scans = await getOperatorImportableScans(report.tenantId);

  return (
    <>
      <div className="mb-6">
        <Link
          href="/operator/reports"
          className="text-2xs text-fg-mute font-mono hover:text-fg"
        >
          ← all reports
        </Link>
      </div>
      <ReportEditor
        report={report}
        importableScans={scans}
        printHref={`/report/${id}/print`}
      />
    </>
  );
}
