import { PageHeader } from "@/components/ui/PageHeader";
import { FindingsExplorer } from "@/components/findings/FindingsExplorer";
import { requireTenantId } from "@/lib/session";
import { getTenantFindings } from "@/lib/queries";

export default async function FindingsPage() {
  const tenantId = await requireTenantId();
  const findings = await getTenantFindings(tenantId);

  return (
    <>
      <PageHeader
        eyebrow="// vulnerabilities"
        title={
          <>
            All <span className="em">findings</span>.
          </>
        }
        lede={
          <>
            Every vulnerability VAPTBOOSTER has surfaced across your scope.{" "}
            <span className="em-sm">Verified</span> ones have been reproduced by
            a senior operator.
          </>
        }
      />
      <FindingsExplorer findings={findings} />
    </>
  );
}
