import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import { ScanStatusBadge } from "@/components/ui/Badge";
import { LiveRefresh } from "@/components/operator/LiveRefresh";
import { requireOperator } from "@/lib/session";
import { getOperatorOverview } from "@/lib/queries";
import { approveScan, rejectScan } from "@/lib/actions/scans";
import { timeAgo, hexId } from "@/lib/utils";

export default async function OperatorDashboardPage() {
  await requireOperator();
  const { tenants, pending, running, openCriticalsGlobal } =
    await getOperatorOverview();

  return (
    <>
      <LiveRefresh />
      <PageHeader
        eyebrow="// operator console"
        title={
          <>
            <span className="em">Cross-tenant</span> overview.
          </>
        }
        lede={
          <>
            Everything VAPTBOOSTER is doing across{" "}
            <span className="em-sm text-fg">{tenants.length}</span> tenants
            right now.
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active tenants" value={tenants.length} emphasis="serif" />
        <Stat
          label="Awaiting approval"
          value={pending.length}
          tone={pending.length > 0 ? "warn" : "default"}
          emphasis="serif"
          change={pending.length > 0 ? "needs your attention" : "queue clear"}
        />
        <Stat
          label="Scans running"
          value={running.length}
          emphasis="serif"
          change={
            running.length > 0 && running[0].startedAt
              ? `Latest started ${timeAgo(running[0].startedAt)}`
              : "Idle"
          }
        />
        <Stat
          label="Open criticals · global"
          value={openCriticalsGlobal}
          tone={openCriticalsGlobal > 0 ? "crit" : "ok"}
          emphasis="serif"
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-5 mt-8">
        {/* Approval queue */}
        <Panel className="lg:col-span-3" accent>
          <PanelHeader
            eyebrow="// action required"
            title={
              <>
                Awaiting <span className="em-sm">approval</span>
              </>
            }
            right={
              <Link href="/operator/queue">
                <Button variant="line" size="sm">
                  Queue →
                </Button>
              </Link>
            }
          />
          {pending.length === 0 ? (
            <div className="p-8 text-center text-fg-mute text-sm">
              No scans waiting for approval.
            </div>
          ) : (
            <ul>
              {pending.map((s, i) => (
                <li
                  key={s.id}
                  className="px-6 py-4 border-t border-line first:border-t-0 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 text-2xs text-fg-mute font-mono mb-1">
                      <span>{hexId(i + 1)}</span>
                      <span>·</span>
                      <span className="text-fg-2">{s.tenantName}</span>
                      <span>·</span>
                      <span>{timeAgo(s.requestedAt)}</span>
                    </div>
                    <div className="font-mono text-[14px] truncate">
                      {s.targetValue}
                    </div>
                    {s.notes && (
                      <div className="text-2xs text-fg-mute italic mt-1">
                        “{s.notes}”
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <form action={approveScan.bind(null, s.id)}>
                      <Button type="submit" variant="solid" size="sm">
                        Approve
                      </Button>
                    </form>
                    <form action={rejectScan.bind(null, s.id)}>
                      <Button type="submit" variant="danger" size="sm">
                        Reject
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Tenants list */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            eyebrow={`// ${tenants.length} tenants`}
            title={
              <>
                Active <span className="em-sm">workspaces</span>
              </>
            }
            right={
              <Link href="/operator/tenants">
                <Button variant="ghost" size="sm">
                  All →
                </Button>
              </Link>
            }
          />
          <ul>
            {tenants.map((t) => (
              <li
                key={t.id}
                className="px-5 py-4 border-t border-line first:border-t-0 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{t.name}</div>
                  <div className="text-2xs text-fg-mute font-mono mt-0.5">
                    {t.industry} · {t.country} ·{" "}
                    <span className="text-fg-2">
                      last activity {timeAgo(t.lastActivityAt)}
                    </span>
                  </div>
                </div>
                <div className="text-right text-2xs font-mono shrink-0">
                  {t.openCriticals > 0 ? (
                    <span className="text-crit">{t.openCriticals}c open</span>
                  ) : (
                    <span className="text-ok">clean</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Running scans strip */}
      <Panel className="mt-5">
        <PanelHeader
          eyebrow="// in progress"
          title={
            <>
              Scans <span className="em-sm">running</span> right now
            </>
          }
        />
        {running.length === 0 ? (
          <div className="p-8 text-center text-fg-mute text-sm">
            No scans currently running.
          </div>
        ) : (
          <ul>
            {running.map((s) => (
              <li
                key={s.id}
                className="px-6 py-4 border-t border-line first:border-t-0"
              >
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">
                      {s.tenantName} <span className="text-fg-mute">·</span>{" "}
                      <span className="font-mono">{s.targetValue}</span>
                    </div>
                    <div className="text-2xs text-fg-mute font-mono mt-1">
                      {s.currentStep}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-2xs font-mono text-fg">{s.progress}%</span>
                    <ScanStatusBadge status={s.status} />
                  </div>
                </div>
                <div className="h-1 bg-ink-2 border border-line rounded overflow-hidden">
                  <div className="h-full bg-fg" style={{ width: `${s.progress}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
