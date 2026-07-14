import { requireTenantUser } from "@/lib/session";
import { getWorkspaceSettings } from "@/lib/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { WorkspaceProfileForm } from "@/components/settings/WorkspaceProfileForm";
import { AccountSection } from "@/components/settings/AccountSection";
import { TeamSection } from "@/components/settings/TeamSection";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "workspace", label: "Workspace" },
  { id: "account", label: "Account" },
  { id: "team", label: "Team" },
  { id: "plan", label: "Plan & usage" },
];

export default async function SettingsPage() {
  const { userId, tenantId } = await requireTenantUser();
  const data = await getWorkspaceSettings(tenantId, userId);
  const me = data.members.find((m) => m.isYou);
  const u = data.usage;
  const resets = new Date(u.resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <PageHeader
        eyebrow="workspace"
        title={
          <>
            Workspace <span className="em">settings</span>
          </>
        }
        lede="Manage your organization profile, your account, your team, and your plan."
      />

      <nav className="flex flex-wrap gap-2 mb-8">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="px-3 py-1.5 rounded border border-line-2 text-2xs font-mono text-fg-2 hover:border-fg hover:text-fg transition-colors"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-6 max-w-3xl scroll-mt-8">
        <div id="workspace" className="scroll-mt-8">
          <WorkspaceProfileForm tenant={data.tenant} />
        </div>

        <div id="account" className="scroll-mt-8">
          <AccountSection me={{ name: me?.name ?? "", email: me?.email ?? "" }} />
        </div>

        <div id="team" className="scroll-mt-8">
          <TeamSection members={data.members} invites={data.invites} />
        </div>

        <div id="plan" className="scroll-mt-8">
          <Panel>
            <PanelHeader
              eyebrow="billing"
              title={
                <>
                  Plan &amp; <span className="em-sm">usage</span>
                </>
              }
              right={<Badge tone="mute">{u.planLabel}</Badge>}
            />
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label="Plan" value={u.planLabel} emphasis="serif" />
              <Stat
                label="Scans this period"
                value={`${u.used}/${u.included}`}
                tone={u.atLimit ? "crit" : "default"}
                emphasis="serif"
                change={`resets ${resets}`}
              />
              <Stat
                label="Retests this period"
                value={`${u.retestsUsed}/${u.retestsIncluded}`}
                tone={u.retestAtLimit ? "crit" : "default"}
                emphasis="serif"
              />
            </div>
            <div className="px-5 pb-5 text-2xs text-fg-mute font-mono">
              Need a higher limit? Contact us to change your plan.
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
