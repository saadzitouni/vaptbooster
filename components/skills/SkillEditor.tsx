"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { MockSkill } from "@/lib/mock-skills";
import { setSkillEnabled, publishSkillVersion } from "@/lib/actions/skills";
import { timeAgo, cn } from "@/lib/utils";

export function SkillEditor({ skill }: { skill: MockSkill }) {
  const v = skill.currentVersion;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local edit state — wired to save actions in Phase 3.
  const [name, setName] = useState(v.name);
  const [description, setDescription] = useState(v.description);
  const [triggers, setTriggers] = useState(v.triggers);
  const [antiTriggers, setAntiTriggers] = useState(v.antiTriggers);
  const [systemPrompt, setSystemPrompt] = useState(v.systemPrompt);
  const [classifyPrompt, setClassifyPrompt] = useState(v.classifyPrompt ?? "");
  const [payloadJson, setPayloadJson] = useState(
    JSON.stringify(v.payloadSets, null, 2)
  );
  const [modelChoice, setModelChoice] = useState(v.modelChoice);
  const [maxCostCents, setMaxCostCents] = useState(v.maxCostUsdCents);
  const [confidence, setConfidence] = useState(v.confidenceThreshold);
  const [enabled, setEnabled] = useState(skill.enabled);
  const [reason, setReason] = useState("");

  const dirty =
    name !== v.name ||
    description !== v.description ||
    triggers !== v.triggers ||
    antiTriggers !== v.antiTriggers ||
    systemPrompt !== v.systemPrompt ||
    classifyPrompt !== (v.classifyPrompt ?? "") ||
    payloadJson !== JSON.stringify(v.payloadSets, null, 2) ||
    modelChoice !== v.modelChoice ||
    maxCostCents !== v.maxCostUsdCents ||
    confidence !== v.confidenceThreshold ||
    enabled !== skill.enabled;

  const hasMetrics = skill.metrics.callsLast30d > 0;

  return (
    <>
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/operator/skills"
          className="text-2xs text-fg-mute font-mono hover:text-fg"
        >
          ← catalog
        </Link>
      </div>

      <PageHeader
        eyebrow={`${skill.altitude} · ${skill.category}`}
        title={
          <>
            <span className="em">{v.name}</span>
          </>
        }
        lede={
          <>
            <span className="font-mono text-fg">{skill.key}</span>
            {" · "}
            v{v.versionNumber} of {skill.totalVersions}
            {" · "}
            last edited {timeAgo(v.publishedAt)} by {v.createdBy}
          </>
        }
        actions={
          <>
            <Badge tone={enabled ? "ok" : "mute"}>
              {enabled ? "enabled" : "disabled"}
            </Badge>
            <button
              disabled={pending}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                start(async () => {
                  await setSkillEnabled(skill.key, next);
                  router.refresh();
                });
              }}
              className="px-3 py-1.5 text-2xs font-mono border border-line-2 rounded hover:border-fg text-fg-2 hover:text-fg transition-colors disabled:opacity-50"
            >
              {enabled ? "disable" : "enable"}
            </button>
          </>
        }
      />

      {/* ----- Metrics strip (read-only context) ----- */}
      <Panel className="mb-8">
        <PanelHeader
          eyebrow="last 30 days"
          title={
            <>
              How this skill is <span className="em-sm">performing</span>
            </>
          }
        />
        {hasMetrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-line border-t border-line">
            <Metric label="Calls" value={skill.metrics.callsLast30d.toLocaleString()} />
            <Metric
              label="Avg cost"
              value={`$${(skill.metrics.avgCostUsdCents / 100).toFixed(2)}`}
            />
            <Metric
              label="Avg latency"
              value={`${(skill.metrics.avgLatencyMs / 1000).toFixed(1)}s`}
            />
            <Metric
              label="False-positive rate"
              value={`${(skill.metrics.falsePositiveRate * 100).toFixed(0)}%`}
              tone={
                skill.metrics.falsePositiveRate > 0.15
                  ? "warn"
                  : skill.metrics.falsePositiveRate > 0.08
                  ? "default"
                  : "ok"
              }
            />
          </div>
        ) : (
          <div className="border-t border-line p-6 text-2xs text-fg-mute font-mono">
            No calls recorded yet — per-skill metrics start tracking once scans
            run through the agent pipeline.
          </div>
        )}
      </Panel>

      <div className="flex flex-col gap-6">
        {/* ===== 1. IDENTITY ===== */}
        <Panel>
          <PanelHeader eyebrow="01" title={<>Identity</>} />
          <div className="p-6 grid md:grid-cols-2 gap-5">
            <div>
              <Label>Display name</Label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <Label>Skill key</Label>
              <input
                value={skill.key}
                disabled
                className={cn(inputCls, "opacity-60 cursor-not-allowed")}
              />
              <Hint>Stable identifier — cannot be changed.</Hint>
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={inputCls}
              />
              <Hint>One sentence the planner sees when picking which skill to invoke.</Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 2. TRIGGERS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="02"
            title={
              <>
                When to <span className="em-sm">use</span>, when to{" "}
                <span className="em-sm">skip</span>
              </>
            }
          />
          <div className="p-6 grid md:grid-cols-2 gap-5">
            <div>
              <Label>Triggers (markdown bullets)</Label>
              <textarea
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                rows={6}
                className={cn(inputCls, "font-mono text-[13px]")}
              />
              <Hint>The planner runs this skill when any trigger fires.</Hint>
            </div>
            <div>
              <Label>Anti-triggers</Label>
              <textarea
                value={antiTriggers}
                onChange={(e) => setAntiTriggers(e.target.value)}
                rows={6}
                className={cn(inputCls, "font-mono text-[13px]")}
              />
              <Hint>The planner skips this skill if any anti-trigger fires — overrides triggers.</Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 3. PROMPTS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="03"
            title={
              <>
                LLM <span className="em-sm">prompts</span>
              </>
            }
          />
          <div className="p-6 space-y-5">
            <div>
              <Label>System prompt</Label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={6}
                className={cn(inputCls, "font-mono text-[13px]")}
                placeholder="You are…"
              />
              <Hint>
                Set the role and constraints. For atomic skills (deterministic),
                leave as <code className="text-fg-2">(no LLM)</code>.
              </Hint>
            </div>
            <div>
              <Label>Classification prompt (optional)</Label>
              <textarea
                value={classifyPrompt}
                onChange={(e) => setClassifyPrompt(e.target.value)}
                rows={4}
                className={cn(inputCls, "font-mono text-[13px]")}
                placeholder="Given X and Y, classify as one of: confirmed, ambiguous, denied."
              />
              <Hint>
                For tactical skills: the constrained prompt used at the classify
                step. Should produce one enum value, nothing else.
              </Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 4. PAYLOADS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="04"
            title={
              <>
                Payload <span className="em-sm">sets</span>
              </>
            }
            right={<span className="text-2xs text-fg-mute font-mono">JSON</span>}
          />
          <div className="p-6">
            <textarea
              value={payloadJson}
              onChange={(e) => setPayloadJson(e.target.value)}
              rows={12}
              className={cn(inputCls, "font-mono text-[12.5px] leading-relaxed")}
              spellCheck={false}
            />
            <Hint>
              Structured payload data — payload arrays, wordlists, regex patterns,
              canary URLs. Validated on save.
            </Hint>
          </div>
        </Panel>

        {/* ===== 5. PARAMETERS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="05"
            title={
              <>
                Runtime <span className="em-sm">parameters</span>
              </>
            }
          />
          <div className="p-6 grid md:grid-cols-3 gap-5">
            <div>
              <Label>Model</Label>
              <select
                value={modelChoice}
                onChange={(e) => setModelChoice(e.target.value)}
                className={inputCls}
              >
                <option value="vaptbooster-fast">vaptbooster-fast · cheap</option>
                <option value="vaptbooster-default">vaptbooster-default</option>
                <option value="vaptbooster-deep">vaptbooster-deep · slow + expensive</option>
                <option value="none">none · deterministic</option>
              </select>
            </div>
            <div>
              <Label>Max cost per call (USD)</Label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={(maxCostCents / 100).toFixed(2)}
                onChange={(e) => setMaxCostCents(Math.round(parseFloat(e.target.value) * 100))}
                className={inputCls}
              />
              <Hint>Hard ceiling — call aborts if exceeded.</Hint>
            </div>
            <div>
              <Label>Confidence threshold</Label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={confidence}
                onChange={(e) => setConfidence(parseFloat(e.target.value))}
                className={inputCls}
              />
              <Hint>0–1. Below this, finding is logged as 'ambiguous'.</Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 6. SAFETY ===== */}
        <Panel>
          <PanelHeader
            eyebrow="06"
            title={
              <>
                Safety <span className="em-sm">guards</span>
              </>
            }
          />
          <div className="p-6">
            <pre className="bg-ink-2 border border-line-2 rounded p-4 text-2xs font-mono text-fg-2 leading-relaxed overflow-x-auto">
              {JSON.stringify(v.safety, null, 2)}
            </pre>
            <Hint>
              Edit safety constraints carefully. Changes here can let the agent
              hit endpoints it shouldn't — review with a second operator before
              publishing.
            </Hint>
          </div>
        </Panel>
      </div>

      {/* ===== Save bar (sticky) ===== */}
      <div className="sticky bottom-0 -mx-6 md:-mx-10 mt-10 border-t border-line bg-ink/95 backdrop-blur px-6 md:px-10 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-2xs font-mono">
            {error ? (
              <span className="text-crit">{error}</span>
            ) : dirty ? (
              <span className="text-warn pulse-dot">
                unsaved changes · will create v{v.versionNumber + 1}
              </span>
            ) : (
              <span className="text-fg-mute">no changes</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="commit message (e.g. 'tighten IDOR threshold')"
              className="flex-1 bg-ink-2 border border-line-2 rounded px-3 py-1.5 text-2xs font-mono text-fg placeholder:text-fg-mute focus:outline-none focus:border-fg"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="solid"
              disabled={!dirty || !reason.trim() || pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  try {
                    await publishSkillVersion(skill.key, {
                      name,
                      description,
                      triggers,
                      antiTriggers,
                      systemPrompt,
                      classifyPrompt,
                      payloadJson,
                      modelChoice,
                      maxCostUsdCents: maxCostCents,
                      confidenceThreshold: confidence,
                      enabled,
                      reason,
                    });
                    setReason("");
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Publish failed.");
                  }
                });
              }}
            >
              {pending ? "Publishing…" : `Publish v${v.versionNumber + 1}`}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

const inputCls =
  "w-full bg-ink-2 border border-line-2 rounded px-3 py-2 text-[13px] text-fg placeholder:text-fg-mute focus:outline-none focus:border-fg focus:bg-ink-3 transition-colors font-mono";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-2xs tracking-[0.14em] uppercase text-fg-mute font-mono mb-2">
      {children}
    </label>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-2xs text-fg-mute font-mono">{children}</p>;
}
function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "ok";
}) {
  const toneCls = { default: "text-fg", warn: "text-warn", ok: "text-ok" }[tone];
  return (
    <div className="px-6 py-5">
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-3 em text-[26px] leading-none", toneCls)}>{value}</div>
    </div>
  );
}
