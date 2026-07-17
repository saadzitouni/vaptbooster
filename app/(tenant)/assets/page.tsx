import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeManager, type ScopeRow } from "@/components/scope/ScopeManager";
import { requireTenantId } from "@/lib/session";
import { getTenantScope } from "@/lib/queries";
import { expectedTxtRecord } from "@/lib/scope-verify";

export default async function ScopePage() {
  const tenantId = await requireTenantId();
  const scope = await getTenantScope(tenantId);

  // Compute each target's verification record server-side so the app secret
  // never reaches the client.
  const targets: ScopeRow[] = scope.map((s) => ({
    id: s.id,
    type: s.type,
    value: s.value,
    verifiedAt: s.verifiedAt,
    addedAt: s.addedAt,
    txtRecord: expectedTxtRecord(s.id),
  }));

  return (
    <>
      <PageHeader
        eyebrow="tenant"
        title={
          <>
            Your <span className="em">assets</span>
          </>
        }
        lede={
          <>
            Declare the domains, IPs, and apps you want assessed. An asset must be{" "}
            <span className="em-sm">verified</span> before any scan can run against it — that
            proof of ownership is your authorization to test it.
          </>
        }
      />
      <ScopeManager targets={targets} />
    </>
  );
}
