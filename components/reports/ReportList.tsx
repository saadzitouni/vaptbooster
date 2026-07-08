import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { timeAgo } from "@/lib/utils";
import type { ReportListItem } from "@/lib/report";

export function ReportList({
  items,
  editBase,
  showTenant = false,
}: {
  items: ReportListItem[];
  editBase: string; // "/reports" | "/operator/reports"
  showTenant?: boolean;
}) {
  if (items.length === 0) {
    return (
      <Panel className="px-6 py-16">
        <div className="max-w-md mx-auto text-center">
          <div className="eyebrow mb-3">// no reports yet</div>
          <p className="text-fg-2 text-[14px] leading-relaxed">
            Create your first report to author a branded engagement deliverable —
            add findings, drop in a client logo, and export it to PDF.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <ul>
        {items.map((r) => (
          <li
            key={r.id}
            className="px-5 py-4 border-t border-line first:border-t-0 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <Link
                href={`${editBase}/${r.id}/edit`}
                className="text-[14px] font-medium hover:underline truncate block"
              >
                {r.title}
              </Link>
              <div className="mt-1 text-2xs text-fg-mute font-mono truncate">
                {showTenant && r.tenantName ? `${r.tenantName} · ` : ""}
                {r.clientName || "—"} · {r.findingCount} finding
                {r.findingCount === 1 ? "" : "s"} · updated {timeAgo(r.updatedAt)}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={r.status === "final" ? "ok" : "mute"}>{r.status}</Badge>
              <Link
                href={`${editBase}/${r.id}/edit`}
                className="font-mono text-2xs px-2.5 py-1.5 rounded border border-line-2 text-fg-2 hover:text-fg hover:border-fg transition-colors"
              >
                edit
              </Link>
              <Link
                href={`/report/${r.id}/print`}
                target="_blank"
                className="font-mono text-2xs px-2.5 py-1.5 rounded border border-line-2 text-fg-2 hover:text-fg hover:border-fg transition-colors"
              >
                export
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
