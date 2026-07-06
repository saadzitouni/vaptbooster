import { ComingSoon } from "@/components/ui/ComingSoon";

export default function OperatorFindingsPage() {
  return (
    <ComingSoon
      eyebrow="// operator · cross-tenant"
      title={
        <>
          Findings <span className="em">firehose</span>
        </>
      }
      lede="Every finding produced across all tenants — triage, deduplicate, and spot systemic issues."
      note="The cross-tenant findings view isn't implemented in the current build. Once wired, operators review and validate agent-produced findings from all workspaces here."
    />
  );
}
