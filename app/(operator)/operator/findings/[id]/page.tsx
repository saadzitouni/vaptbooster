import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { SeverityBadge, Badge } from "@/components/ui/Badge";
import type { Severity } from "@/lib/mock-data";
import { requireOperator } from "@/lib/session";
import { getOperatorFindingDetail } from "@/lib/queries";
import { FindingTriagePanel } from "@/components/operator/FindingTriagePanel";
import { RetestButton } from "@/components/scans/RetestButton";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OperatorFindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOperator();
  const { id } = await params;
  const detail = await getOperatorFindingDetail(id);
  if (!detail) notFound();
  const { finding, evidence, aiTriage } = detail;

  const evLines = evidence.map((e) => ({
    ts: new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false }),
    actor: e.actor,
    level: e.level,
    msg: e.msg,
  }));

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <Link href="/operator/findings" className="text-2xs text-fg-mute font-mono hover:text-fg">
          ← findings firehose
        </Link>
        <Link href={`/scans/${finding.scanId}`} className="text-2xs text-fg-mute font-mono hover:text-fg">
          source scan →
        </Link>
      </div>

      <PageHeader
        eyebrow={`${finding.tenantName} · ${finding.targetValue}`}
        title={<>{finding.title}</>}
        lede={
          <span className="font-mono text-[13px]">
            {finding.location}
            {finding.cwe ? ` · ${finding.cwe}` : ""} · found {timeAgo(finding.discoveredAt)}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity as Severity} />
            <Badge tone="mute">{finding.status}</Badge>
            {finding.reproducedBy && <Badge tone="ok">verified</Badge>}
            {finding.severity !== "info" && (
              <RetestButton findingIds={[finding.id]} label="Retest" size="md" />
            )}
          </div>
        }
      />

      <div className="grid lg:grid-cols-5 gap-5">
        {/* Evidence */}
        <div className="lg:col-span-3 space-y-5">
          <Panel>
            <PanelHeader eyebrow="agent evidence" title={<>What the agent <span className="em-sm">found</span></>} />
            <div className="p-5">
              <p className="text-[13px] text-fg-2 leading-relaxed whitespace-pre-wrap">
                {finding.summary}
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="scan activity"
              title={<>Captured <span className="em-sm">log</span></>}
              right={<span className="text-2xs text-fg-mute font-mono">{evLines.length} lines</span>}
            />
            <div className="p-4 max-h-[440px] overflow-y-auto bg-ink">
              <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                {evLines.length === 0 && (
                  <div className="text-fg-mute">No captured activity log for this scan.</div>
                )}
                {evLines.map((l, i) => (
                  <div key={i} className="flex gap-2.5">
                    <span className="text-fg-mute shrink-0">[{l.ts}]</span>
                    <span className="shrink-0 w-[34px] text-fg-mute">
                      {l.actor === "claude" ? "AI→" : l.actor === "tool" ? "exec" : "sys"}
                    </span>
                    <span
                      className={
                        l.level === "crit"
                          ? "text-crit"
                          : l.level === "warn"
                          ? "text-warn"
                          : l.level === "ok"
                          ? "text-ok"
                          : l.actor === "claude"
                          ? "text-fg"
                          : "text-fg-2"
                      }
                    >
                      {l.msg}
                    </span>
                  </div>
                ))}
              </pre>
            </div>
          </Panel>
        </div>

        {/* Triage + AI */}
        <div className="lg:col-span-2">
          <FindingTriagePanel
            findingId={finding.id}
            status={finding.status}
            severity={finding.severity}
            remediation={finding.remediation}
            reproducedBy={finding.reproducedBy}
            aiTriage={aiTriage}
          />
        </div>
      </div>
    </>
  );
}
