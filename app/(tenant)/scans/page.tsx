import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { ScanStatusBadge } from "@/components/ui/Badge";
import { requireTenantId } from "@/lib/session";
import { getTenantScans } from "@/lib/queries";
import { timeAgo, hexId } from "@/lib/utils";

export default async function ScansPage() {
  const tenantId = await requireTenantId();
  const scans = await getTenantScans(tenantId);

  return (
    <>
      <PageHeader
        eyebrow="// audits"
        title={
          <>
            All <span className="em">scans</span>.
          </>
        }
        lede="Every scan ever queued, running, or completed against your scope."
        actions={
          <Link href="/scans/new">
            <Button variant="solid">
              Request scan
            </Button>
          </Link>
        }
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-ink-2 text-2xs uppercase tracking-[0.14em] text-fg-mute font-mono">
                <th className="text-left px-5 py-3 font-normal">#</th>
                <th className="text-left px-5 py-3 font-normal">Target</th>
                <th className="text-left px-5 py-3 font-normal">Requested by</th>
                <th className="text-left px-5 py-3 font-normal">Status</th>
                <th className="text-left px-5 py-3 font-normal">Findings</th>
                <th className="text-right px-5 py-3 font-normal">When</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s, i) => {
                const totalFindings = Object.values(s.findingCounts).reduce(
                  (a, b) => a + b,
                  0
                );
                return (
                  <tr
                    key={s.id}
                    className="border-b border-line hover:bg-ink-2 transition-colors"
                  >
                    <td className="px-5 py-4 text-fg-mute font-mono text-2xs">
                      {hexId(i + 1)}
                    </td>
                    <td className="px-5 py-4 font-mono">
                      <Link
                        href={`/scans/${s.id}`}
                        className="text-fg hover:underline"
                      >
                        {s.targetValue}
                      </Link>
                      {s.notes && (
                        <div className="text-2xs text-fg-mute font-mono mt-0.5 max-w-md truncate">
                          {s.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-fg-2 text-[13px]">
                      {s.requesterName}
                    </td>
                    <td className="px-5 py-4">
                      <ScanStatusBadge status={s.status} />
                    </td>
                    <td className="px-5 py-4 font-mono text-2xs">
                      {totalFindings === 0 ? (
                        <span className="text-fg-mute">—</span>
                      ) : (
                        <span>
                          {s.findingCounts.critical > 0 && (
                            <span className="text-crit">{s.findingCounts.critical}c </span>
                          )}
                          {s.findingCounts.high > 0 && (
                            <span className="text-warn">{s.findingCounts.high}h </span>
                          )}
                          {s.findingCounts.medium > 0 && (
                            <span className="text-info">{s.findingCounts.medium}m </span>
                          )}
                          <span className="text-fg-mute">
                            · {totalFindings} total
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-fg-mute font-mono text-2xs">
                      {timeAgo(s.requestedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
