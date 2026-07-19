import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import {
  SeverityBadge,
  ScanStatusBadge,
  FindingStatusBadge,
} from "@/components/ui/Badge";
import { requireTenantId } from "@/lib/session";
import { getTenantScanDetail } from "@/lib/queries";
import { LiveRefresh } from "@/components/operator/LiveRefresh";
import { ReasoningView } from "@/components/reasoning/ReasoningView";
import { ResumeScanButton } from "@/components/scans/ResumeScanButton";
import { RetestButton } from "@/components/scans/RetestButton";
import { CancelScanButton } from "@/components/scans/CancelScanButton";
import { timeAgo, hexId } from "@/lib/utils";

export default async function ScanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const detail = await getTenantScanDetail(tenantId, id);
  if (!detail) notFound();
  const { scan, findings, resumable } = detail;
  const totalFindings = Object.values(scan.findingCounts).reduce(
    (a, b) => a + b,
    0
  );
  const canResume =
    resumable &&
    (scan.status === "failed" ||
      scan.status === "paused_ceiling" ||
      scan.status === "cancelled");

  const isActive = scan.status === "running" || scan.status === "queued";
  // Non-info findings can be re-tested after the client fixes them.
  const retestable = findings.filter((f) => f.severity !== "info").map((f) => f.id);

  return (
    <>
      {isActive && <LiveRefresh intervalMs={3000} />}
      <div className="mb-6">
        <Link
          href="/scans"
          className="text-2xs text-fg-mute font-mono hover:text-fg"
        >
          ← all scans
        </Link>
      </div>

      <PageHeader
        eyebrow={`scan · ${hexId(1)}`}
        title={
          <>
            <span className="em">{scan.targetValue}</span>
          </>
        }
        lede={
          <>
            Requested by {scan.requesterName}, {timeAgo(scan.requestedAt)}.
            {scan.notes && (
              <>
                {" "}
                <span className="text-fg-mute">Notes: {scan.notes}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <ScanStatusBadge status={scan.status} />
            {canResume && <ResumeScanButton scanId={scan.id} />}
            {(scan.status === "running" || scan.status === "queued") && (
              <CancelScanButton scanId={scan.id} />
            )}
            {scan.status === "completed" && retestable.length > 0 && (
              <RetestButton
                findingIds={retestable}
                label={`Retest ${retestable.length} finding${retestable.length === 1 ? "" : "s"}`}
                redirectTo="/scans/"
                size="md"
              />
            )}
            {scan.status === "completed" && (
              <Button variant="solid" size="md">
                Download report
              </Button>
            )}
          </>
        }
      />

      {/* Progress strip */}
      {scan.status === "running" && (
        <Panel accent className="mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between text-2xs font-mono mb-2">
              <span className="text-fg-2">{scan.currentStep}</span>
              <span className="text-fg">{scan.progress}%</span>
            </div>
            <div className="h-1.5 bg-ink-2 border border-line rounded overflow-hidden">
              <div
                className="h-full bg-fg transition-all duration-700"
                style={{ width: `${scan.progress}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {(["critical", "high", "medium", "low", "info"] as const).map(
                (sev) => (
                  <div
                    key={sev}
                    className="p-3 border border-line rounded text-center"
                  >
                    <div className="eyebrow text-[10px]">{sev}</div>
                    <div className="mt-2 em text-[22px] leading-none">
                      {scan.findingCounts[sev]}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* Live reasoning stream (replaces the raw agent log) */}
      <div className="mb-6">
        <ReasoningView
          scanId={scan.id}
          target={scan.targetValue}
          targetSub="Web application · authorized scope"
          scanStatus={scan.status}
          progress={scan.progress}
        />
      </div>

      <div>
        {/* Findings list (compact) */}
        <Panel>
          <PanelHeader
            eyebrow={`${findings.length} findings`}
            title={
              <>
                Discovered <span className="em-sm">so far</span>
              </>
            }
          />
          <ul>
            {findings.length === 0 && (
              <li className="p-6 text-center text-fg-mute text-sm">
                No findings discovered yet.
              </li>
            )}
            {findings.map((f) => (
              <li
                key={f.id}
                className="px-5 py-4 border-t border-line first:border-t-0 hover:bg-ink-2 transition-colors"
              >
                <div className="flex items-start gap-3 mb-2">
                  <SeverityBadge severity={f.severity} />
                  <FindingStatusBadge status={f.status} />
                </div>
                <div className="text-[13px] font-medium leading-snug">
                  {f.title}
                </div>
                <div className="text-2xs text-fg-mute font-mono mt-1.5">
                  {f.location}
                </div>
                {f.reproducedBy && (
                  <div className="text-2xs text-fg-2 font-mono mt-1.5">
                    <span className="text-fg-mute">verified by</span>{" "}
                    {f.reproducedBy}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
