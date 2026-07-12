import { PageHeader } from "@/components/ui/PageHeader";
import { requireOperator } from "@/lib/session";
import { getOperatorFindings } from "@/lib/queries";
import { OperatorFindingsConsole } from "@/components/operator/OperatorFindingsConsole";

export const dynamic = "force-dynamic";

export default async function OperatorFindingsPage() {
  await requireOperator();
  const findings = await getOperatorFindings();

  return (
    <>
      <PageHeader
        eyebrow="operator"
        title={
          <>
            Findings <span className="em">firehose</span>
          </>
        }
        lede="Every finding across all tenants. Triage, confirm, and let the AI assistant assess each one against the scan's captured evidence."
      />
      <OperatorFindingsConsole findings={findings} />
    </>
  );
}
