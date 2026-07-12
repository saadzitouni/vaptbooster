import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import {
  SeverityBadge,
  ScanStatusBadge,
} from "@/components/ui/Badge";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTenantDashboard } from "@/lib/queries";
import { timeAgo, hexId } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.tenantId) redirect("/login");
  const firstName = (session.user.name ?? "there").split(" ")[0];
  const { tenant, scans, findings } = await getTenantDashboard(
    session.user.tenantId
  );

  const runningScans = scans.filter((s) => s.status === "running");
  const pendingScans = scans.filter((s) => s.status === "pending_approval");
  const completedScans = scans.filter((s) => s.status === "completed");
  const openCriticals = findings.filter(
    (f) => f.severity === "critical" && f.status === "open"
  );
  const openHighs = findings.filter(
    (f) => f.severity === "high" && f.status === "open"
  );

  return (
    <>
      <PageHeader
        eyebrow={`tenant · ${tenant.industry.toLowerCase()}`}
        title={
          <>
            Welcome back, <span className="em">{firstName}</span>.
          </>
        }
        lede={
          <>
            Here's what VAPTBOOSTER has been up to across{" "}
            <span className="em-sm text-fg">{tenant.scopeCount}</span> targets
            in your scope.
          </>
        }
        actions={
          <>
            <Link href="/scans/new">
              <Button variant="solid">
                Request scan
                <ArrowRight />
              </Button>
            </Link>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Open criticals"
          value={openCriticals.length}
          tone={openCriticals.length > 0 ? "crit" : "ok"}
          emphasis="serif"
          change={
            openCriticals.length > 0
              ? `Latest ${timeAgo(openCriticals[0].discoveredAt)}`
              : "All clear."
          }
        />
        <Stat
          label="Open highs"
          value={openHighs.length}
          tone={openHighs.length > 0 ? "warn" : "ok"}
          emphasis="serif"
        />
        <Stat
          label="Scans running"
          value={runningScans.length}
          tone="default"
          emphasis="serif"
          change={
            runningScans.length > 0
              ? `Started ${timeAgo(runningScans[0].startedAt!)}`
              : "Idle."
          }
        />
        <Stat
          label="Total scans"
          value={completedScans.length + runningScans.length}
          tone="default"
          emphasis="serif"
          change={`${completedScans.length} completed`}
        />
      </div>

      {/* Two-column section: live scan + recent findings */}
      <div className="grid lg:grid-cols-5 gap-5 mt-8">

        {/* Live scan */}
        <Panel className="lg:col-span-3" accent>
          <PanelHeader
            eyebrow="in progress"
            title={
              <>
                Live <span className="em-sm">scan</span>
              </>
            }
            right={
              runningScans[0] && (
                <Link href={`/scans/${runningScans[0].id}`}>
                  <Button variant="line" size="sm">
                    Open
                  </Button>
                </Link>
              )
            }
          />
          {runningScans[0] ? (
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-2xs text-fg-mute font-mono mb-1">
                    {hexId(1)} · target
                  </div>
                  <div className="text-[15px] font-medium truncate">
                    {runningScans[0].targetValue}
                  </div>
                  <div className="mt-2 text-2xs text-fg-mute font-mono">
                    Started {timeAgo(runningScans[0].startedAt!)} · by{" "}
                    {runningScans[0].requesterName}
                  </div>
                </div>
                <ScanStatusBadge status={runningScans[0].status} />
              </div>

              {/* Progress bar */}
              <div className="mt-6">
                <div className="flex items-center justify-between text-2xs font-mono mb-1.5">
                  <span className="text-fg-mute">{runningScans[0].currentStep}</span>
                  <span className="text-fg">{runningScans[0].progress}%</span>
                </div>
                <div className="h-1.5 bg-ink-2 border border-line rounded overflow-hidden">
                  <div
                    className="h-full bg-fg"
                    style={{ width: `${runningScans[0].progress}%` }}
                  />
                </div>
              </div>

              {/* Findings preview */}
              <div className="mt-6 grid grid-cols-5 gap-2">
                {(["critical", "high", "medium", "low", "info"] as const).map(
                  (sev) => (
                    <div
                      key={sev}
                      className="p-3 border border-line rounded text-center"
                    >
                      <div className="eyebrow text-[10px]">{sev}</div>
                      <div className="mt-2 em text-[22px] leading-none">
                        {runningScans[0].findingCounts[sev]}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="text-fg-mute text-sm">
                No scans running. <Link href="/scans/new" className="text-fg underline">Start one</Link>.
              </div>
            </div>
          )}
        </Panel>

        {/* Pending approvals + recent findings */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {pendingScans.length > 0 && (
            <Panel>
              <PanelHeader
                eyebrow="awaiting"
                title={
                  <>
                    Pending <span className="em-sm">approval</span>
                  </>
                }
              />
              <div className="p-5 space-y-3">
                {pendingScans.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.targetValue}</div>
                      <div className="text-2xs text-fg-mute font-mono mt-0.5">
                        Requested {timeAgo(s.requestedAt)}
                      </div>
                    </div>
                    <ScanStatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader
              eyebrow="fresh"
              title={
                <>
                  Recent <span className="em-sm">findings</span>
                </>
              }
              right={
                <Link href="/findings">
                  <Button variant="ghost" size="sm">
                    All →
                  </Button>
                </Link>
              }
            />
            <ul>
              {findings.slice(0, 4).map((f) => (
                <li
                  key={f.id}
                  className="px-5 py-3 border-t border-line first:border-t-0"
                >
                  <div className="flex items-start gap-3">
                    <SeverityBadge severity={f.severity} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/findings#${f.id}`}
                        className="text-[13px] font-medium hover:text-fg block leading-snug"
                      >
                        {f.title}
                      </Link>
                      <div className="text-2xs text-fg-mute font-mono mt-1">
                        {f.location} · {timeAgo(f.discoveredAt)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ArrowRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
