import { ComingSoon } from "@/components/ui/ComingSoon";

export default function SettingsPage() {
  return (
    <ComingSoon
      eyebrow="// tenant"
      title={
        <>
          Workspace <span className="em">settings</span>
        </>
      }
      lede="Team members, notification preferences, API tokens, and billing for your workspace."
      note="Settings aren't implemented in the current build. Once wired, workspace members, invitations, and billing plan management live here."
    />
  );
}
