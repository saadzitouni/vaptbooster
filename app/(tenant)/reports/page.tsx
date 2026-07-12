import { PageHeader } from "@/components/ui/PageHeader";
import { requireTenantId } from "@/lib/session";
import { getTenantReports } from "@/lib/queries";
import { ReportList } from "@/components/reports/ReportList";
import { NewReportButton } from "@/components/reports/NewReportButton";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const tenantId = await requireTenantId();
  const items = await getTenantReports(tenantId);

  return (
    <>
      <PageHeader
        eyebrow="tenant"
        title={
          <>
            Reports &amp; <span className="em">exports</span>
          </>
        }
        lede="Author branded engagement reports, add your logo, edit findings, and export to PDF."
        actions={<NewReportButton />}
      />
      <ReportList items={items} editBase="/reports" />
    </>
  );
}
