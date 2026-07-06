"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stat";
import type { SkillAltitude, MockSkill } from "@/lib/mock-skills";
import { cn, timeAgo } from "@/lib/utils";

const ALTITUDE_LABELS: Record<SkillAltitude, string> = {
  atomic: "atomic",
  tactical: "tactical",
  strategic: "strategic",
};

const ALTITUDE_DESCRIPTIONS: Record<SkillAltitude, string> = {
  atomic: "Deterministic primitives. No LLM calls.",
  tactical: "Vulnerability playbooks. Mostly code; LLM only for classification.",
  strategic: "Composes tactical skills. LLM-driven planning.",
};

const ALTITUDE_ORDER: SkillAltitude[] = ["strategic", "tactical", "atomic"];

export function SkillCatalog({ skills }: { skills: MockSkill[] }) {
  const [filter, setFilter] = useState<SkillAltitude | "all">("all");
  const [showDisabled, setShowDisabled] = useState(true);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return skills.filter((s) => {
      if (filter !== "all" && s.altitude !== filter) return false;
      if (!showDisabled && !s.enabled) return false;
      if (query) {
        const q = query.toLowerCase();
        if (
          !s.key.toLowerCase().includes(q) &&
          !s.currentVersion.name.toLowerCase().includes(q) &&
          !s.category.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [skills, filter, showDisabled, query]);

  const grouped = useMemo(() => {
    const out: Record<SkillAltitude, MockSkill[]> = {
      strategic: [],
      tactical: [],
      atomic: [],
    };
    for (const s of filtered) out[s.altitude].push(s);
    return out;
  }, [filtered]);

  const totalEnabled = skills.filter((s) => s.enabled).length;
  const totalCallsLast30d = skills.reduce((a, s) => a + s.metrics.callsLast30d, 0);
  const highFpSkills = skills.filter(
    (s) => s.enabled && s.metrics.falsePositiveRate > 0.15
  );
  const latestEdit = skills
    .map((s) => s.currentVersion.publishedAt)
    .sort()
    .slice(-1)[0];

  return (
    <>
      <PageHeader
        eyebrow="// super-admin · skills"
        title={
          <>
            Skill <span className="em">catalog</span>.
          </>
        }
        lede={
          <>
            Every capability VAPTBOOSTER can invoke. Edit a skill to change its
            prompts, payloads, and thresholds — changes go live on the{" "}
            <span className="em-sm text-fg">next scan</span>, no deploy.
          </>
        }
        actions={
          <Link href="/operator/agent-config">
            <Button variant="line">Agent config →</Button>
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Enabled skills"
          value={`${totalEnabled} / ${skills.length}`}
          emphasis="serif"
        />
        <Stat
          label="Calls last 30d"
          value={totalCallsLast30d.toLocaleString()}
          emphasis="serif"
        />
        <Stat
          label="High false-positive"
          value={highFpSkills.length}
          tone={highFpSkills.length > 0 ? "warn" : "ok"}
          emphasis="serif"
          change={
            highFpSkills.length > 0
              ? highFpSkills.map((s) => s.key).join(", ")
              : "All within tolerance"
          }
        />
        <Stat
          label="Latest edit"
          value={
            <span className="text-[24px] em">
              {latestEdit ? timeAgo(latestEdit) : "—"}
            </span>
          }
          emphasis="mono"
        />
      </div>

      {/* Filter bar */}
      <Panel className="mt-8">
        <div className="p-4 flex flex-wrap items-center gap-3">
          <span className="eyebrow">altitude</span>
          <div className="flex gap-1">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              all
            </FilterChip>
            {ALTITUDE_ORDER.map((a) => (
              <FilterChip key={a} active={filter === a} onClick={() => setFilter(a)}>
                {ALTITUDE_LABELS[a]}
              </FilterChip>
            ))}
          </div>
          <div className="w-px h-6 bg-line" />
          <label className="flex items-center gap-2 text-2xs font-mono text-fg-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(e) => setShowDisabled(e.target.checked)}
              className="accent-fg"
            />
            show disabled
          </label>
          <div className="flex-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search by key, name, category…"
            className="w-[280px] bg-ink-2 border border-line-2 rounded px-3 py-1.5 text-2xs font-mono text-fg placeholder:text-fg-mute focus:outline-none focus:border-fg"
          />
        </div>
      </Panel>

      {/* Grouped lists */}
      {ALTITUDE_ORDER.map((altitude) => {
        const list = grouped[altitude];
        if (list.length === 0) return null;
        return (
          <Panel className="mt-5" key={altitude}>
            <PanelHeader
              eyebrow={`// ${ALTITUDE_LABELS[altitude]} · ${list.length}`}
              title={
                <>
                  <span className="capitalize">{ALTITUDE_LABELS[altitude]}</span>{" "}
                  <span className="em-sm">skills</span>
                </>
              }
            >
              <p className="text-2xs text-fg-mute font-mono mt-1">
                {ALTITUDE_DESCRIPTIONS[altitude]}
              </p>
            </PanelHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-ink-2 text-2xs uppercase tracking-[0.14em] text-fg-mute font-mono">
                    <th className="text-left px-5 py-3 font-normal">Skill</th>
                    <th className="text-left px-5 py-3 font-normal">Category</th>
                    <th className="text-right px-5 py-3 font-normal">v.</th>
                    <th className="text-right px-5 py-3 font-normal">Calls 30d</th>
                    <th className="text-right px-5 py-3 font-normal">Avg cost</th>
                    <th className="text-right px-5 py-3 font-normal">FP rate</th>
                    <th className="text-left  px-5 py-3 font-normal">Status</th>
                    <th className="text-right px-5 py-3 font-normal">Edited</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((skill) => (
                    <tr
                      key={skill.id}
                      className={cn(
                        "border-b border-line hover:bg-ink-2 transition-colors",
                        !skill.enabled && "opacity-60"
                      )}
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/operator/skills/${skill.key}`}
                          className="hover:underline"
                        >
                          <div className="font-medium">
                            {skill.currentVersion.name}
                          </div>
                          <div className="text-2xs text-fg-mute font-mono mt-0.5">
                            {skill.key}
                          </div>
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-fg-2 capitalize">
                        {skill.category}
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-2xs text-fg-mute">
                        v{skill.currentVersion.versionNumber}
                        <span className="text-fg-mute"> /{skill.totalVersions}</span>
                      </td>
                      <td className="px-5 py-4 text-right font-mono">
                        {skill.metrics.callsLast30d > 0
                          ? skill.metrics.callsLast30d.toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-5 py-4 text-right font-mono text-fg-2">
                        {skill.metrics.callsLast30d > 0
                          ? `$${(skill.metrics.avgCostUsdCents / 100).toFixed(2)}`
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-5 py-4 text-right font-mono em-sm text-[14px]",
                          skill.metrics.falsePositiveRate > 0.15
                            ? "text-warn"
                            : skill.metrics.falsePositiveRate > 0.08
                            ? "text-fg-2"
                            : "text-ok"
                        )}
                      >
                        {skill.metrics.callsLast30d > 0
                          ? `${(skill.metrics.falsePositiveRate * 100).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="px-5 py-4">
                        {skill.enabled ? (
                          <Badge tone="ok">enabled</Badge>
                        ) : (
                          <Badge tone="mute">disabled</Badge>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right text-2xs text-fg-mute font-mono">
                        {timeAgo(skill.currentVersion.publishedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}

      {filtered.length === 0 && (
        <Panel className="mt-5">
          <div className="p-10 text-center text-fg-mute text-sm">
            No skills match the current filters.
          </div>
        </Panel>
      )}
    </>
  );
}

function FilterChip({
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
