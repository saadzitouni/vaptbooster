"use client";

import type { StoredReasoningEvent, Severity } from "@/lib/reasoning-events";
import styles from "./reasoning.module.css";

function sevClass(sev: Severity): string {
  return styles[`sev${sev}` as keyof typeof styles] as string;
}

// One block per event. PHASE events drive the left panel, not the stream.
export function ReasoningBlock({ event }: { event: StoredReasoningEvent }) {
  switch (event.type) {
    case "OBSERVATION":
      return (
        <div className={`${styles.blk} ${styles.think}`}>
          <span className={styles.bullet}>›</span>
          <p>{event.text}</p>
        </div>
      );

    case "INVARIANT":
      return (
        <div className={`${styles.blk} ${styles.box} ${styles.boxInv}`}>
          <div className={styles.lb}>EXPECTED BEHAVIOR — INVARIANT</div>
          <p>{event.text}</p>
          {event.endpoint && <div className={styles.sub}>{event.endpoint}</div>}
        </div>
      );

    case "HYPOTHESIS":
      return (
        <div className={`${styles.blk} ${styles.box} ${styles.boxHyp}`}>
          <div className={styles.lb}>HYPOTHESIS</div>
          <p>{event.text}</p>
          {event.falsifiableIn && <div className={styles.sub}>Falsifiable in {event.falsifiableIn}</div>}
        </div>
      );

    case "TEST":
      return (
        <div className={`${styles.blk} ${styles.code}`}>
          {event.steps.map((s, i) => (
            <div key={i} style={i > 0 ? { marginTop: 6 } : undefined}>
              <div className={styles.row}>
                <span className={styles.m}>{s.method}</span> <span className={styles.p}>{s.path}</span>
                {s.headerNote && <span className={styles.k}> {s.headerNote}</span>}
                {s.annotation && <span className={styles.note}> {s.annotation}</span>}
              </div>
              {s.response && (
                <div className={styles.row}>
                  <span className={styles.k}>→ </span>
                  <span className={s.response.expected ? styles.rOk : styles.rBad}>{s.response.status}</span>{" "}
                  <span className={styles.k}>{s.response.summary}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      );

    case "RESULT":
      return (
        <div className={`${styles.blk} ${styles.res}`}>
          <span className={`${styles.sev} ${sevClass(event.severity)}`}>{event.severity.toUpperCase()}</span>
          <p>
            {event.invariantViolated ? "Invariant violated. " : ""}
            <b>{event.title}. </b>
            <span>{event.detail}</span>
          </p>
        </div>
      );

    case "BLAST_RADIUS":
      return (
        <div className={`${styles.blk} ${styles.think}`}>
          <span className={styles.bullet}>›</span>
          <p>
            {event.text}
            {event.affectedEndpoints?.length ? ` — ${event.affectedEndpoints.join(", ")}` : ""}
          </p>
        </div>
      );

    case "HUMAN_HANDOFF":
      return (
        <div className={`${styles.blk} ${styles.ver}`}>
          <span className={styles.ic}>›</span>
          <p>
            {event.text}
            {event.evidenceCount ? ` — evidence bundle: ${event.evidenceCount} item(s).` : ""}
          </p>
        </div>
      );

    case "VERIFICATION":
      return (
        <div className={`${styles.blk} ${styles.ver}`}>
          <span className={styles.ic}>›</span>
          <p>
            <span className={event.outcome === "confirmed" ? styles.ok : styles.bad}>
              {event.outcome === "confirmed" ? "✓ Operator confirmed" : "✕ Operator rejected"}
            </span>{" "}
            by {event.operator}
            {event.note ? ` — ${event.note}` : ""}
          </p>
        </div>
      );

    case "FINDING":
      return (
        <div className={`${styles.blk} ${styles.card}`}>
          <span className={`${styles.tag} ${sevClass(event.severity)}`}>{event.severity.toUpperCase()}</span>
          <div className={styles.mid}>
            <div className={styles.nm}>{event.title}</div>
            <div className={styles.sb}>{event.subtitle}</div>
          </div>
          <div className={`${styles.st} ${event.verified ? "" : styles.stPending}`}>
            {event.verified ? "✓ operator confirmed" : "pending review"}
          </div>
        </div>
      );

    default:
      return null;
  }
}
