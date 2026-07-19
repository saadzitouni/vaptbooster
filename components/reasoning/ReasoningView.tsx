"use client";

import { useEffect, useRef, useState } from "react";
import type { PhaseName } from "@/lib/reasoning-events";
import { useReasoningStream, PHASE_ORDER } from "@/hooks/useReasoningStream";
import { ReasoningBlock } from "./ReasoningBlocks";
import styles from "./reasoning.module.css";

const PHASE_LABELS: Record<PhaseName, string> = {
  recon: "Recon & surface mapping",
  modeling: "Behavior modeling",
  hypothesis: "Hypothesis forming",
  testing: "Controlled testing",
  verification: "Operator verification",
  report: "Report compilation",
};

export function ReasoningView({
  scanId,
  target,
  targetSub,
  scanStatus,
  progress,
}: {
  scanId: string;
  target: string;
  targetSub: string;
  scanStatus: string;
  progress: number;
}) {
  const done = ["completed", "failed", "cancelled", "paused_ceiling"].includes(scanStatus);
  const [nonce, setNonce] = useState(0);
  const { events, phases, tallies, status } = useReasoningStream(scanId, done, nonce);

  // Auto-scroll to newest only when the user is already near the bottom.
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const streamEvents = events.filter((e) => e.type !== "PHASE");

  const statusText = failedText(scanStatus) ?? (done ? "Verified · report ready" : "VAPTBOOSTER is reasoning…");
  const statusCls =
    scanStatus === "failed" || scanStatus === "cancelled"
      ? styles.statusErr
      : done
      ? styles.statusDone
      : "";
  const liveText = status === "live" ? "LIVE" : status === "error" ? "RECONNECTING…" : done ? "DONE" : "…";

  return (
    <div className={`${styles.root}`}>
      <div className={styles.bar} style={{ padding: "16px 22px 0" }}>
        <span className={styles.dot} />
        <span className={styles.bname}>pwntrol</span>
        <span className={styles.spacer} />
        <span className={`${styles.status} ${statusCls}`}>
          <span className={styles.pulse} />
          <span>{statusText}</span>
        </span>
      </div>

      <div className={styles.main}>
        {/* LEFT — engagement */}
        <div className={styles.panel}>
          <div className={styles.phead}>
            <span className={styles.plabel}>ENGAGEMENT</span>
          </div>
          <div className={styles.pbody}>
            <div className={styles.tgt}>TARGET</div>
            <div className={styles.tgtv}>{target}</div>
            <div className={styles.tgtsub}>{targetSub}</div>
            <div className={styles.hr} />
            {PHASE_ORDER.map((p) => {
              const st = phases[p];
              return (
                <div
                  key={p}
                  className={`${styles.phase} ${st === "active" ? styles.phaseActive : ""} ${
                    st === "done" ? styles.phaseDone : ""
                  }`}
                >
                  <span className={styles.mk}>▸</span>
                  {PHASE_LABELS[p]}
                </div>
              );
            })}
            <div className={styles.tally}>
              <div className={`${styles.tl} ${styles.tlCrit}`}>
                <div className={styles.n}>{tallies.criticals}</div>
                <div className={styles.l}>CRITICAL</div>
              </div>
              <div className={`${styles.tl} ${styles.tlVer}`}>
                <div className={styles.n}>{tallies.verified}</div>
                <div className={styles.l}>VERIFIED</div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — reasoning stream */}
        <div className={styles.streamPanel}>
          <div className={styles.shead}>
            <span className={styles.mark}>
              <span className={styles.br}>[</span>VAPTBOOSTER<span className={styles.br}>]</span>
            </span>
            {!done && <span className={styles.caret} />}
            <span className={styles.shTag}>REASONING</span>
            <span className={`${styles.live} ${status === "live" ? styles.liveOn : ""}`}>{liveText}</span>
          </div>

          <div className={styles.stream} ref={streamRef}>
            {streamEvents.length === 0 && (
              <div className={styles.empty}>
                {status === "connecting" ? (
                  "connecting to the reasoning stream…"
                ) : done ? (
                  "No reasoning was recorded for this scan."
                ) : (
                  "waiting for the agent to start reasoning…"
                )}
              </div>
            )}
            {streamEvents.map((ev) => (
              <ReasoningBlock key={ev.seq} event={ev} />
            ))}

            {status === "error" && (
              <div className={styles.noteDrop}>
                Stream dropped — reconnecting. The scan keeps running.
                <div>
                  <button className={styles.retry} onClick={() => setNonce((n) => n + 1)}>
                    Retry now
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className={styles.progWrap}>
            <div
              className={`${styles.prog} ${done ? styles.progDone : ""}`}
              style={{ width: `${done ? 100 : Math.max(4, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function failedText(status: string): string | null {
  if (status === "failed") return "Scan failed";
  if (status === "cancelled") return "Scan cancelled";
  if (status === "paused_ceiling") return "Paused · cost ceiling";
  return null;
}
