import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import { Badge, ScanStatusBadge } from "@/components/ui/Badge";
import { requireOperator } from "@/lib/session";
import { getOperatorTenants, ROOT_DOMAIN } from "@/lib/queries";
import { NewTenantForm } from "@/components/operator/NewTenantForm";
import { timeAgo } from "@/lib/utils";

export default async function OperatorTenantsPage() {
  await requireOperator();
  const TENANTS = await getOperatorTenants();
  const totalScans = TENANTS.reduce((n, t) => n + t.scanCount, 0);
  const totalScope = TENANTS.reduce((n, t) => n + t.scopeCount, 0);
  const totalCriticals = TENANTS.reduce((n, t) => n + t.openCriticals, 0);

  return (
    <>
      <PageHeader
        eyebrow="operator"
        title={
          <>
            Tenant <span className="em">manager</span>
          </>
        }
        lede="Every workspace on the platform — provisioning, budgets, virtual keys, and lifecycle in one place."
      />

      <div className="mb-8">
        <NewTenantForm />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Active tenants" value={TENANTS.length} emphasis="serif" />
        <Stat label="Total scans · all-time" value={totalScans} emphasis="serif" />
        <Stat label="In-scope assets" value={totalScope} emphasis="serif" />
        <Stat
          label="Open criticals · global"
          value={totalCriticals}
          tone={totalCriticals > 0 ? "crit" : "ok"}
          emphasis="serif"
        />
      </div>

      <Panel>
        <PanelHeader
          eyebrow={`${TENANTS.length} workspaces`}
          title={
            <>
              All <span className="em-sm">workspaces</span>
            </>
          }
        />

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-fg-mute border-b border-line">
                <th className="text-left font-normal eyebrow px-6 py-3">Workspace</th>
                <th className="text-left font-normal eyebrow px-4 py-3">Sector</th>
                <th className="text-right font-normal eyebrow px-4 py-3">Scope</th>
                <th className="text-right font-normal eyebrow px-4 py-3">Scans</th>
                <th className="text-left font-normal eyebrow px-4 py-3">Security</th>
                <th className="text-left font-normal eyebrow px-4 py-3">Status</th>
                <th className="text-left font-normal eyebrow px-4 py-3">Last activity</th>
                <th className="text-right font-normal eyebrow px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {TENANTS.map((t) => {
                const running = t.runningScans > 0;
                return (
                  <tr
                    key={t.id}
                    className="border-b border-line last:border-b-0 hover:bg-ink-2 transition-colors"
                  >
                    {/* Workspace */}
                    <td className="px-6 py-4">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-2xs text-fg-mute font-mono mt-0.5">
                        {t.slug}.{ROOT_DOMAIN}
                      </div>
                    </td>

                    {/* Sector */}
                    <td className="px-4 py-4 text-fg-2 font-mono text-2xs">
                      {t.industry}
                      <span className="text-fg-mute"> · {t.country}</span>
                    </td>

                    {/* Scope */}
                    <td className="px-4 py-4 text-right font-mono tabular-nums">
                      {t.scopeCount}
                    </td>

                    {/* Scans */}
                    <td className="px-4 py-4 text-right font-mono tabular-nums">
                      {t.scanCount}
                    </td>

                    {/* Security */}
                    <td className="px-4 py-4">
                      {t.openCriticals > 0 ? (
                        <Badge tone="crit">{t.openCriticals} critical open</Badge>
                      ) : (
                        <Badge tone="ok">clean</Badge>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      {running ? (
                        <ScanStatusBadge status="running" />
                      ) : (
                        <span className="text-2xs text-fg-mute font-mono">idle</span>
                      )}
                    </td>

                    {/* Last activity */}
                    <td className="px-4 py-4 text-2xs text-fg-2 font-mono">
                      {timeAgo(t.lastActivityAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/operator/tenants/${t.id}`}>
                          <Button variant="line" size="sm">
                            Manage →
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="mt-6 text-2xs text-fg-mute font-mono">
        // Live data via <span className="text-fg-2">withOperator()</span> +
        Postgres RLS. Provisioning &amp; lifecycle actions are the next slice.
      </p>
    </>
  );
}
