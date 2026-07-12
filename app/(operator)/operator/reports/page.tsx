import { PageHeader } from "@/components/ui/PageHeader";
import { requireOperator } from "@/lib/session";
import { getOperatorReports, getOperatorTenants } from "@/lib/queries";
import { ReportList } from "@/components/reports/ReportList";
import { NewReportForm } from "@/components/reports/NewReportForm";

export const dynamic = "force-dynamic";

export default async function OperatorReportsPage() {
  await requireOperator();
  const [items, tenants] = await Promise.all([
    getOperatorReports(),
    getOperatorTenants(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="operator"
        title={
          <>
            Reports &amp; <span className="em">exports</span>
          </>
        }
        lede="Author and export branded engagement reports for any client."
        actions={
          <NewReportForm tenants={tenants.map((t) => ({ id: t.id, name: t.name }))} />
        }
      />
      <ReportList items={items} editBase="/operator/reports" showTenant />
    </>
  );
}
