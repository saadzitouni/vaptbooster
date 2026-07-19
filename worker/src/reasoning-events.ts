// =============================================================
// Reasoning event contract — worker copy. DUPLICATED verbatim from
// lib/reasoning-events.ts (not a monorepo). Keep the two in sync.
// =============================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type PhaseName =
  | "recon"
  | "modeling"
  | "hypothesis"
  | "testing"
  | "verification"
  | "report";

export interface TestStep {
  method: string;
  path: string;
  headerNote?: string;
  annotation?: string;
  response?: {
    status: number;
    summary: string;
    expected: boolean;
  };
}

export type ReasoningEvent =
  | { type: "PHASE"; phase: PhaseName; status: "active" | "done" }
  | { type: "OBSERVATION"; text: string; highlights?: string[] }
  | { type: "INVARIANT"; endpoint: string; text: string }
  | { type: "HYPOTHESIS"; text: string; falsifiableIn?: string }
  | { type: "TEST"; steps: TestStep[] }
  | { type: "RESULT"; severity: Severity; title: string; detail: string; invariantViolated: boolean }
  | { type: "BLAST_RADIUS"; text: string; affectedEndpoints: string[] }
  | { type: "HUMAN_HANDOFF"; text: string; evidenceCount: number }
  | { type: "VERIFICATION"; outcome: "confirmed" | "rejected"; operator: string; note?: string }
  | {
      type: "FINDING";
      findingId: string;
      severity: Severity;
      title: string;
      subtitle: string;
      verified: boolean;
    };

export type ReasoningEventType = ReasoningEvent["type"];

// The DB payload = the event minus the `type` (which is a column).
export function toPayload(event: ReasoningEvent): Record<string, unknown> {
  const { type: _type, ...rest } = event;
  return rest;
}
