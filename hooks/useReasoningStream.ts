"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredReasoningEvent, PhaseName, Severity } from "@/lib/reasoning-events";

export const PHASE_ORDER: PhaseName[] = [
  "recon",
  "modeling",
  "hypothesis",
  "testing",
  "verification",
  "report",
];

export type PhaseState = "pending" | "active" | "done";
export type StreamStatus = "connecting" | "live" | "done" | "error";

export function useReasoningStream(
  scanId: string,
  scanCompleted: boolean,
  reconnectKey = 0
): {
  events: StoredReasoningEvent[];
  phases: Record<PhaseName, PhaseState>;
  tallies: { criticals: number; verified: number };
  status: StreamStatus;
} {
  const [events, setEvents] = useState<StoredReasoningEvent[]>([]);
  const [conn, setConn] = useState<StreamStatus>("connecting");
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!scanId) return;
    seen.current = new Set();
    setEvents([]);
    setConn("connecting");

    // EventSource auto-reconnects and replays Last-Event-ID → server resumes
    // from `after`, so no gaps or dupes across a dropped connection.
    const es = new EventSource(`/api/scans/${scanId}/reasoning`);
    es.onopen = () => setConn("live");
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as StoredReasoningEvent;
        if (typeof ev.seq !== "number" || seen.current.has(ev.seq)) return;
        seen.current.add(ev.seq);
        setEvents((prev) => {
          const next = [...prev, ev];
          next.sort((a, b) => a.seq - b.seq);
          return next;
        });
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => setConn((s) => (s === "live" ? "error" : s));

    return () => es.close();
  }, [scanId, reconnectKey]);

  const phases = useMemo(() => {
    const map: Record<PhaseName, PhaseState> = {
      recon: "pending",
      modeling: "pending",
      hypothesis: "pending",
      testing: "pending",
      verification: "pending",
      report: "pending",
    };
    let furthest = -1;
    for (const ev of events) {
      if (ev.type === "PHASE") {
        map[ev.phase] = ev.status === "done" ? "done" : "active";
        furthest = Math.max(furthest, PHASE_ORDER.indexOf(ev.phase));
      }
    }
    // Everything before the furthest-reached phase is implicitly done.
    for (let i = 0; i < furthest; i++) {
      if (map[PHASE_ORDER[i]] !== "done") map[PHASE_ORDER[i]] = "done";
    }
    if (scanCompleted) for (const p of PHASE_ORDER) if (map[p] === "active") map[p] = "done";
    return map;
  }, [events, scanCompleted]);

  const tallies = useMemo(() => {
    let criticals = 0;
    let verified = 0;
    const sev = (s: Severity) => s === "critical";
    for (const ev of events) {
      if (ev.type === "FINDING") {
        if (sev(ev.severity)) criticals++;
        if (ev.verified) verified++;
      }
      if (ev.type === "RESULT" && sev(ev.severity)) criticals++;
      if (ev.type === "VERIFICATION" && ev.outcome === "confirmed") verified++;
    }
    // FINDING + RESULT can double-count a critical; clamp to distinct findings.
    const findingCriticals = events.filter(
      (e) => e.type === "FINDING" && e.severity === "critical"
    ).length;
    return { criticals: findingCriticals || criticals, verified };
  }, [events]);

  const status: StreamStatus = scanCompleted ? "done" : conn;
  return { events, phases, tallies, status };
}
