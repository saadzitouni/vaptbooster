"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import type { MockAgentConfig } from "@/lib/mock-skills";
import { saveAgentConfig } from "@/lib/actions/skills";
import { timeAgo, cn } from "@/lib/utils";

const AGGRESSIVENESS_OPTIONS = [
  {
    value: "conservative" as const,
    label: "Conservative",
    desc: "Only invoke tactical skills with very high trigger signal. Lower false-positive rate, may miss findings.",
  },
  {
    value: "standard" as const,
    label: "Standard",
    desc: "Balanced. Recommended default.",
  },
  {
    value: "aggressive" as const,
    label: "Aggressive",
    desc: "Invoke any skill that triggers, even speculatively. More findings, more cost, more noise.",
  },
];

// The LiteLLM model aliases (infra/litellm/config.yaml). Standard = what scans run on.
const MODEL_OPTIONS = [
  { value: "vaptbooster-fast", label: "Fast · Haiku 4.5 — $1 / $5 per Mtok" },
  { value: "vaptbooster-default", label: "Standard · Sonnet 4.6 — $3 / $15 per Mtok" },
  { value: "vaptbooster-deep", label: "Deep · Opus 4.8 — $5 / $25 per Mtok" },
];

export function AgentConfigEditor({ config }: { config: MockAgentConfig }) {
  const c = config;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [ceilingCents, setCeilingCents] = useState(c.defaultCeilingUsdCents);
  const [concurrency, setConcurrency] = useState(c.stepConcurrency);
  const [reconDepth, setReconDepth] = useState(c.maxReconDepth);
  const [chainDepth, setChainDepth] = useState(c.maxChainDepth);
  const [aggressiveness, setAggressiveness] = useState(c.aggressivenessLevel);
  const [stopOnCrit, setStopOnCrit] = useState(c.stopOnFirstCritical);
  const [fastModel, setFastModel] = useState(c.defaultFastModel);
  const [stdModel, setStdModel]   = useState(c.defaultStandardModel);
  const [deepModel, setDeepModel] = useState(c.defaultDeepModel);
  const [plannerPrompt, setPlannerPrompt] = useState(c.plannerSystemPrompt);
  const [reason, setReason] = useState("");

  const dirty =
    ceilingCents !== c.defaultCeilingUsdCents ||
    concurrency !== c.stepConcurrency ||
    reconDepth !== c.maxReconDepth ||
    chainDepth !== c.maxChainDepth ||
    aggressiveness !== c.aggressivenessLevel ||
    stopOnCrit !== c.stopOnFirstCritical ||
    fastModel !== c.defaultFastModel ||
    stdModel !== c.defaultStandardModel ||
    deepModel !== c.defaultDeepModel ||
    plannerPrompt !== c.plannerSystemPrompt;

  return (
    <>
      <div className="mb-6">
        <Link
          href="/operator/skills"
          className="text-2xs text-fg-mute font-mono hover:text-fg"
        >
          ← skill catalog
        </Link>
      </div>

      <PageHeader
        eyebrow="super-admin · agent"
        title={
          <>
            Agent <span className="em">behavior</span>.
          </>
        }
        lede={
          <>
            Global knobs that govern the strategic planner. Per-skill settings
            live in the <Link href="/operator/skills" className="underline">skill catalog</Link>.
            Last edited <span className="em-sm">{timeAgo(c.updatedAt)}</span> by {c.updatedBy}.
          </>
        }
      />

      <div className="flex flex-col gap-6">

        {/* ===== 1. COST + EXECUTION ===== */}
        <Panel>
          <PanelHeader
            eyebrow="01"
            title={
              <>
                Cost &amp; <span className="em-sm">execution</span>
              </>
            }
          />
          <div className="p-6 grid md:grid-cols-2 gap-5">
            <div>
              <Label>Default cost ceiling per scan (USD)</Label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={(ceilingCents / 100).toFixed(2)}
                onChange={(e) =>
                  setCeilingCents(Math.round(parseFloat(e.target.value) * 100))
                }
                className={inputCls}
              />
              <Hint>
                Hard ceiling per scan. Overridable per tenant plan. Hits this
                cap → scan pauses, operator notified.
              </Hint>
            </div>
            <div>
              <Label>Step concurrency</Label>
              <input
                type="number"
                min="1"
                max="8"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                className={inputCls}
              />
              <Hint>
                Parallel agent steps per scan. Higher = faster scans, more
                target rate-limit exposure.
              </Hint>
            </div>
            <div>
              <Label>Max recon depth</Label>
              <input
                type="number"
                min="1"
                max="6"
                value={reconDepth}
                onChange={(e) => setReconDepth(parseInt(e.target.value))}
                className={inputCls}
              />
              <Hint>How many crawl/discovery passes before moving to hunt.</Hint>
            </div>
            <div>
              <Label>Max chain depth</Label>
              <input
                type="number"
                min="1"
                max="8"
                value={chainDepth}
                onChange={(e) => setChainDepth(parseInt(e.target.value))}
                className={inputCls}
              />
              <Hint>
                How many findings to combine into one chain (e.g. SSRF → IAM →
                lateral). Higher = better chains, exponentially more LLM calls.
              </Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 2. AGGRESSIVENESS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="02"
            title={
              <>
                Hunt <span className="em-sm">aggressiveness</span>
              </>
            }
          />
          <div className="p-6 space-y-3">
            {AGGRESSIVENESS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex gap-4 p-4 border rounded cursor-pointer transition-colors",
                  aggressiveness === opt.value
                    ? "border-fg bg-ink-2"
                    : "border-line-2 hover:border-fg-mute"
                )}
              >
                <input
                  type="radio"
                  name="aggressiveness"
                  value={opt.value}
                  checked={aggressiveness === opt.value}
                  onChange={() => setAggressiveness(opt.value)}
                  className="mt-1 accent-fg shrink-0"
                />
                <div>
                  <div className="font-medium text-[14px]">{opt.label}</div>
                  <p className="text-[12.5px] text-fg-2 mt-1">{opt.desc}</p>
                </div>
              </label>
            ))}

            <label className="flex items-start gap-3 mt-4 pt-4 border-t border-line cursor-pointer">
              <input
                type="checkbox"
                checked={stopOnCrit}
                onChange={(e) => setStopOnCrit(e.target.checked)}
                className="mt-1 accent-fg"
              />
              <div>
                <div className="text-[13px]">
                  Stop on first <span className="em-sm">critical</span> finding
                </div>
                <p className="text-2xs text-fg-mute font-mono mt-1">
                  Halt the scan as soon as one critical is verified — saves
                  budget when targets are heavily vulnerable.
                </p>
              </div>
            </label>
          </div>
        </Panel>

        {/* ===== 3. DEFAULT MODELS ===== */}
        <Panel>
          <PanelHeader
            eyebrow="03"
            title={
              <>
                Default <span className="em-sm">models</span>
              </>
            }
          />
          <div className="p-6 grid md:grid-cols-3 gap-5">
            <div>
              <Label>Fast (cheap loops)</Label>
              <ModelSelect value={fastModel} onChange={setFastModel} />
            </div>
            <div>
              <Label>Standard — scans run on this</Label>
              <ModelSelect value={stdModel} onChange={setStdModel} />
            </div>
            <div>
              <Label>Deep (chained exploits)</Label>
              <ModelSelect value={deepModel} onChange={setDeepModel} />
            </div>
            <div className="md:col-span-3">
              <Hint>
                <span className="text-fg-2">Standard</span> is the model every scan runs on —
                switch it to trade cost for depth (Haiku ≪ Sonnet ≪ Opus). Applies to the next
                scan. Fast &amp; Deep are available for per-skill overrides via{" "}
                <code className="text-fg-2">modelChoice</code>. Aliases are defined in{" "}
                <code className="text-fg-2">infra/litellm/config.yaml</code>.
              </Hint>
            </div>
          </div>
        </Panel>

        {/* ===== 4. PLANNER PROMPT ===== */}
        <Panel>
          <PanelHeader
            eyebrow="04"
            title={
              <>
                Planner <span className="em-sm">system prompt</span>
              </>
            }
          />
          <div className="p-6">
            <textarea
              value={plannerPrompt}
              onChange={(e) => setPlannerPrompt(e.target.value)}
              rows={12}
              className={cn(inputCls, "font-mono text-[13px] leading-relaxed")}
              spellCheck={false}
            />
            <Hint>
              The strategic planner uses this prompt when deciding which skill
              to invoke next. This is the highest-leverage knob in the whole
              system — changes ripple to every scan.
            </Hint>
          </div>
        </Panel>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-6 md:-mx-10 mt-10 border-t border-line bg-ink/95 backdrop-blur px-6 md:px-10 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-2xs font-mono">
            {error ? (
              <span className="text-crit">{error}</span>
            ) : dirty ? (
              <span className="text-warn pulse-dot">
                unsaved changes · applies to next scan
              </span>
            ) : (
              <span className="text-fg-mute">no changes</span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="commit message (required)"
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
                    await saveAgentConfig({
                      defaultCeilingUsdCents: ceilingCents,
                      stepConcurrency: concurrency,
                      maxReconDepth: reconDepth,
                      maxChainDepth: chainDepth,
                      aggressivenessLevel: aggressiveness,
                      stopOnFirstCritical: stopOnCrit,
                      defaultFastModel: fastModel,
                      defaultStandardModel: stdModel,
                      defaultDeepModel: deepModel,
                      plannerSystemPrompt: plannerPrompt,
                      reason,
                    });
                    setReason("");
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Save failed.");
                  }
                });
              }}
            >
              {pending ? "Saving…" : "Save config"}
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

function ModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const known = MODEL_OPTIONS.some((o) => o.value === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {!known && value && <option value={value}>{value} (custom alias)</option>}
      {MODEL_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
