import { ComingSoon } from "@/components/ui/ComingSoon";

export default function OperatorInvitesPage() {
  return (
    <ComingSoon
      eyebrow="operator"
      title={
        <>
          Invitations <span className="em">&amp; access</span>
        </>
      }
      lede="Outstanding invites, pending onboardings, and beta cohort access across all workspaces."
      note="Invitation management isn't implemented in the current build. Once wired, operators send workspace invites and track onboarding status here."
    />
  );
}
