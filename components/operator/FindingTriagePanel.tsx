"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { AiTriage } from "@/lib/queries";
import {
  analyzeFinding,
  operatorUpdateFindingStatus,
  operatorSetSeverity,
  operatorConfirmFinding,
  operatorUpdateRemediation,
} from "@/lib/actions/findings";

const STATUSES = ["open", "triaged", "fixed", "wontfix", "duplicate"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

const VERDICT: Record<string, { tone: "crit" | "warn" | "mute"; label: string }> = {
  true_positive: { tone: "crit", label: "TRUE POSITIVE" },
  likely: { tone: "warn", label: "LIKELY" },
  false_positive: { tone: "mute", label: "FALSE POSITIVE" },
};

const SELECT =
  "bg-ink-3 border border-line-2 rounded px-2.5 py-1.5 text-2xs font-mono text-fg focus:outline-none focus:border-fg";

export function FindingTriagePanel({
  findingId,
  status,
  severity,
  remediation,
  reproducedBy,
  aiTriage: initialTriage,
}: {
  findingId: string;
  status: string;
  severity: string;
  remediation: string | null;
  reproducedBy: string | null;
  aiTriage: AiTriage | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [triage, setTriage] = useState<AiTriage | null>(initialTriage);
  const [rem, setRem] = useState(remediation ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<unknown>, after?: () => void) {
    setMsg(null);
    start(async () => {
      try {
        await fn();
        after?.();
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Action failed." });
      }
    });
  }

  function onAnalyze() {
    setMsg(null);
    start(async () => {
      const r = await analyzeFinding(findingId);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && r.triage) {
        setTriage(r.triage);
        router.refresh();
      }
    });
  }

  const v = triage?.verdict ? VERDICT[triage.verdict] : null;

  return (
    <div className="space-y-5">
      {/* ---- AI triage ---- */}
      <div className="bg-ink border border-line rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h3 className="text-[13px] font-medium">AI triage assistant</h3>
          <Button variant="line" size="sm" onClick={onAnalyze} disabled={pending}>
            {pending ? "Analyzing…" : triage ? "Re-analyze" : "Run AI triage"}
          </Button>
        </div>

        <div className="p-5">
          {!triage && (
            <p className="text-2xs text-fg-mute leading-relaxed">
              Have the assistant assess this finding against the scan&apos;s captured
              evidence — verdict, confidence, exploitability, how to confirm, and a
              remediation. It never claims more than the evidence shows.
            </p>
          )}

          {triage && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {v && <Badge tone={v.tone}>{v.label}</Badge>}
                {triage.confidence && (
                  <Badge tone="mute">confidence: {triage.confidence}</Badge>
                )}
                {triage.suggestedSeverity && triage.suggestedSeverity !== severity && (
                  <Badge tone="warn">suggests: {triage.suggestedSeverity}</Badge>
                )}
              </div>

              {triage.rationale && (
                <Field label="Assessment">{triage.rationale}</Field>
              )}
              {triage.severityAssessment && (
                <Field label="Severity">{triage.severityAssessment}</Field>
              )}
              {triage.exploitability && (
                <Field label="Exploitability & impact">{triage.exploitability}</Field>
              )}
              {triage.howToConfirm && (
                <Field label="How to confirm">{triage.howToConfirm}</Field>
              )}
              {triage.remediation && (
                <Field label="Suggested remediation">{triage.remediation}</Field>
              )}

              {/* Quick-apply */}
              <div className="flex flex-wrap gap-2 pt-1">
                {triage.suggestedSeverity && triage.suggestedSeverity !== severity && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => operatorSetSeverity(findingId, triage.suggestedSeverity!))}
                  >
                    Apply severity → {triage.suggestedSeverity}
                  </Button>
                )}
                {triage.remediation && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => operatorUpdateRemediation(findingId, triage.remediation!),
                        () => setRem(triage.remediation!)
                      )
                    }
                  >
                    Use this remediation
                  </Button>
                )}
                {triage.recommendedAction === "confirm" && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => operatorConfirmFinding(findingId))}>
                    Confirm (recommended)
                  </Button>
                )}
                {triage.recommendedAction === "duplicate" && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => operatorUpdateFindingStatus(findingId, "duplicate"))}>
                    Mark duplicate (recommended)
                  </Button>
                )}
                {triage.recommendedAction === "dismiss" && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => operatorUpdateFindingStatus(findingId, "wontfix"))}>
                    Dismiss (recommended)
                  </Button>
                )}
              </div>

              {triage.analyzedAt && (
                <div className="text-[10px] text-fg-mute font-mono">
                  analyzed {new Date(triage.analyzedAt).toLocaleString("en-GB")} · {triage.model}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Triage controls ---- */}
      <div className="bg-ink border border-line rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h3 className="text-[13px] font-medium">Triage</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2">
              <span className="text-2xs font-mono text-fg-mute">status</span>
              <select
                className={SELECT}
                value={status}
                disabled={pending}
                onChange={(e) => run(() => operatorUpdateFindingStatus(findingId, e.target.value))}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-2xs font-mono text-fg-mute">severity</span>
              <select
                className={SELECT}
                value={severity}
                disabled={pending}
                onChange={(e) => run(() => operatorSetSeverity(findingId, e.target.value))}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          <div>
            {reproducedBy ? (
              <div className="text-2xs font-mono text-ok">✓ verified by {reproducedBy}</div>
            ) : (
              <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => operatorConfirmFinding(findingId))}>
                Confirm finding (mark verified)
              </Button>
            )}
          </div>

          <div>
            <label className="block text-2xs font-mono text-fg-mute mb-1.5">remediation</label>
            <textarea
              className="w-full bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg placeholder:text-fg-mute focus:border-fg outline-none min-h-[90px] resize-y"
              value={rem}
              onChange={(e) => setRem(e.target.value)}
              placeholder="Remediation guidance for the tenant…"
            />
            <div className="mt-2">
              <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => operatorUpdateRemediation(findingId, rem))}>
                Save remediation
              </Button>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`font-mono text-2xs ${msg.ok ? "text-ok" : "text-crit"}`}>{msg.text}</div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-mute mb-1">{label}</div>
      <p className="text-[13px] text-fg-2 leading-relaxed whitespace-pre-wrap">{children}</p>
    </div>
  );
}
