"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { SeverityBadge } from "@/components/ui/Badge";
import type { Finding, Severity, FindingStatus } from "@/lib/mock-data";
import { updateFindingStatus } from "@/lib/actions/findings";
import { RetestButton } from "@/components/scans/RetestButton";
import { timeAgo, cn } from "@/lib/utils";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const STATUSES: FindingStatus[] = ["open", "triaged", "fixed", "wontfix", "duplicate"];

export function FindingsExplorer({ findings }: { findings: Finding[] }) {
  const [sev, setSev] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<FindingStatus | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (sev !== "all" && f.severity !== sev) return false;
      if (status !== "all" && f.status !== status) return false;
      if (
        query &&
        !`${f.title} ${f.location}`.toLowerCase().includes(query.toLowerCase())
      )
        return false;
      return true;
    });
  }, [findings, sev, status, query]);

  return (
    <>
      {/* Filter bar */}
      <Panel className="mb-6">
        <div className="p-4 flex flex-wrap items-center gap-3">
          <FilterGroup label="severity">
            <FilterChip active={sev === "all"} onClick={() => setSev("all")}>
              all
            </FilterChip>
            {SEVERITIES.map((s) => (
              <FilterChip key={s} active={sev === s} onClick={() => setSev(s)} tone={s}>
                {s}
              </FilterChip>
            ))}
          </FilterGroup>

          <div className="w-px h-6 bg-line" />

          <FilterGroup label="status">
            <FilterChip active={status === "all"} onClick={() => setStatus("all")}>
              all
            </FilterChip>
            {STATUSES.map((s) => (
              <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s}
              </FilterChip>
            ))}
          </FilterGroup>

          <div className="flex-1" />

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search title or location…"
            className="w-[260px] bg-ink-2 border border-line-2 rounded px-3 py-1.5 text-2xs font-mono text-fg placeholder:text-fg-mute focus:outline-none focus:border-fg"
          />
        </div>
      </Panel>

      {/* Findings list */}
      <Panel>
        <ul>
          {filtered.length === 0 && (
            <li className="p-10 text-center text-fg-mute text-sm">
              No findings match these filters.
            </li>
          )}
          {filtered.map((f) => (
            <li
              key={f.id}
              id={f.id}
              className="px-6 py-5 border-t border-line first:border-t-0 hover:bg-ink-2 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="flex flex-col gap-1.5 shrink-0 pt-0.5">
                  <SeverityBadge severity={f.severity} />
                  <FindingStatusControl id={f.id} status={f.status} />
                  {f.severity !== "info" && (
                    <RetestButton findingIds={[f.id]} redirectTo="/scans/" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-medium leading-snug">
                    {f.title}
                  </div>
                  <p className="text-[13px] text-fg-2 mt-1.5 max-w-3xl">{f.summary}</p>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-2xs text-fg-mute font-mono mt-3">
                    <span>
                      <span className="text-fg-mute">at</span>{" "}
                      <span className="text-fg-2">{f.location}</span>
                    </span>
                    {f.cwe && (
                      <span>
                        <span className="text-fg-mute">cwe</span>{" "}
                        <span className="text-fg-2">{f.cwe}</span>
                      </span>
                    )}
                    <span>
                      <span className="text-fg-mute">found</span>{" "}
                      <span className="text-fg-2">{timeAgo(f.discoveredAt)}</span>
                    </span>
                    {f.reproducedBy && (
                      <span>
                        <span className="text-fg-mute">verified by</span>{" "}
                        <span className="text-fg-2">{f.reproducedBy}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-4 text-2xs text-fg-mute font-mono">
        {filtered.length} of {findings.length} findings
      </div>
    </>
  );
}

function FindingStatusControl({
  id,
  status,
}: {
  id: string;
  status: FindingStatus;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          await updateFindingStatus(id, next);
          router.refresh();
        });
      }}
      className={cn(
        "bg-ink-2 border border-line-2 rounded px-2 py-1 text-2xs font-mono focus:outline-none focus:border-fg",
        pending ? "opacity-50" : "text-fg-2"
      )}
      title="Change status"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">{label}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  tone,
  onClick,
  children,
}: {
  active?: boolean;
  tone?: Severity;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded border text-2xs font-mono transition-colors",
        active
          ? "bg-fg text-ink border-fg"
          : "bg-transparent text-fg-2 border-line-2 hover:border-fg hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
