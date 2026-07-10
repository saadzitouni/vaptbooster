"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { SeverityBadge, Badge } from "@/components/ui/Badge";
import type { Severity } from "@/lib/mock-data";
import type { OperatorFindingRow } from "@/lib/queries";
import { timeAgo, cn } from "@/lib/utils";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["open", "triaged", "fixed", "wontfix", "duplicate"] as const;

const VERDICT_TONE: Record<string, "ok" | "crit" | "warn" | "mute"> = {
  true_positive: "crit",
  likely: "warn",
  false_positive: "mute",
};
const VERDICT_LABEL: Record<string, string> = {
  true_positive: "AI: true positive",
  likely: "AI: likely",
  false_positive: "AI: false positive",
};

export function OperatorFindingsConsole({
  findings,
}: {
  findings: OperatorFindingRow[];
}) {
  const [sev, setSev] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<string>("all");
  const [tenant, setTenant] = useState<string>("all");
  const [query, setQuery] = useState("");

  const tenants = useMemo(
    () => Array.from(new Set(findings.map((f) => f.tenantName).filter(Boolean))).sort(),
    [findings]
  );

  const filtered = useMemo(
    () =>
      findings.filter((f) => {
        if (sev !== "all" && f.severity !== sev) return false;
        if (status !== "all" && f.status !== status) return false;
        if (tenant !== "all" && f.tenantName !== tenant) return false;
        if (
          query &&
          !`${f.title} ${f.location} ${f.tenantName}`.toLowerCase().includes(query.toLowerCase())
        )
          return false;
        return true;
      }),
    [findings, sev, status, tenant, query]
  );

  const openCrit = findings.filter(
    (f) => f.severity === "critical" && f.status === "open"
  ).length;

  return (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Findings" value={findings.length} />
        <Kpi label="Open criticals" value={openCrit} tone={openCrit ? "crit" : "default"} />
        <Kpi label="Tenants" value={tenants.length} />
        <Kpi
          label="AI-triaged"
          value={findings.filter((f) => f.hasAiTriage).length}
        />
      </div>

      {/* Filter bar */}
      <Panel className="mb-6">
        <div className="p-4 flex flex-wrap items-center gap-3">
          <FilterGroup label="severity">
            <Chip active={sev === "all"} onClick={() => setSev("all")}>all</Chip>
            {SEVERITIES.map((s) => (
              <Chip key={s} active={sev === s} onClick={() => setSev(s)}>{s}</Chip>
            ))}
          </FilterGroup>
          <div className="w-px h-6 bg-line" />
          <FilterGroup label="status">
            <Chip active={status === "all"} onClick={() => setStatus("all")}>all</Chip>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{s}</Chip>
            ))}
          </FilterGroup>
          <div className="flex-1" />
          {tenants.length > 1 && (
            <select
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              className="bg-ink-2 border border-line-2 rounded px-2 py-1.5 text-2xs font-mono text-fg focus:outline-none focus:border-fg"
            >
              <option value="all">all tenants</option>
              {tenants.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search title / location / tenant…"
            className="w-[240px] bg-ink-2 border border-line-2 rounded px-3 py-1.5 text-2xs font-mono text-fg placeholder:text-fg-mute focus:outline-none focus:border-fg"
          />
        </div>
      </Panel>

      {/* List */}
      <Panel>
        <ul>
          {filtered.length === 0 && (
            <li className="p-10 text-center text-fg-mute text-sm">
              No findings match these filters.
            </li>
          )}
          {filtered.map((f) => (
            <li key={f.id} className="border-t border-line first:border-t-0">
              <Link
                href={`/operator/findings/${f.id}`}
                className="block px-6 py-5 hover:bg-ink-2 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0 pt-0.5">
                    <SeverityBadge severity={f.severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.5px] font-medium leading-snug">{f.title}</span>
                      {f.aiVerdict && (
                        <Badge tone={VERDICT_TONE[f.aiVerdict] ?? "mute"}>
                          {VERDICT_LABEL[f.aiVerdict] ?? "AI"}
                        </Badge>
                      )}
                      {f.reproducedBy && <Badge tone="ok">verified</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-2xs text-fg-mute font-mono mt-2">
                      <span className="text-fg-2">{f.tenantName || "—"}</span>
                      <span><span className="text-fg-mute">at</span> <span className="text-fg-2">{f.location}</span></span>
                      {f.cwe && <span className="text-fg-2">{f.cwe}</span>}
                      <span><span className="text-fg-mute">status</span> <span className="text-fg-2">{f.status}</span></span>
                      <span>{timeAgo(f.discoveredAt)}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-fg-mute text-2xs font-mono self-center">triage →</span>
                </div>
              </Link>
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

function Kpi({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "crit";
}) {
  return (
    <div className="p-4 border border-line bg-ink rounded-lg">
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-2 text-[26px] font-medium leading-none", tone === "crit" ? "text-crit" : "text-fg")}>
        {value}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">{label}</span>
      <div className="flex gap-1 flex-wrap">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
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
