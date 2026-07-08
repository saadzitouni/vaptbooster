import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTenantId } from "@/lib/session";
import { getTenantReport, getTenantImportableScans } from "@/lib/queries";
import { ReportEditor } from "@/components/reports/ReportEditor";

export const dynamic = "force-dynamic";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenantId = await requireTenantId();
  const { id } = await params;
  const [report, scans] = await Promise.all([
    getTenantReport(tenantId, id),
    getTenantImportableScans(tenantId),
  ]);
  if (!report) notFound();

  return (
    <>
      <div className="mb-6">
        <Link href="/reports" className="text-2xs text-fg-mute font-mono hover:text-fg">
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
