// =============================================================
// Reasoning event contract — the discriminated union streamed from the worker
// to the reasoning-stream UI. DUPLICATED verbatim in worker/src/reasoning-events.ts
// (this repo is not a monorepo; keep the two in sync — same pattern as the
// scan-credentials web/worker split).
//
// Storage: the `type` is a column; the remaining fields live in payload JSON.
// A row reconstructs to { type, ...payload, seq, createdAt }.
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
  method: string; // GET, POST…
  path: string; // /api/orders/1198
  headerNote?: string; // "Authorization: Bearer <session-A>"
  annotation?: string; // "← owned by account B"
  response?: {
    status: number;
    summary: string; // "account_id: B · total: 1,880.00"
    expected: boolean; // false => render in the critical colour
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

// As delivered to the client (DB/stream): the event plus ordering metadata.
export type StoredReasoningEvent = ReasoningEvent & {
  seq: number;
  createdAt: string; // ISO
};

// Split an event into its DB shape: the `type` column + the payload (rest).
export function toPayload(event: ReasoningEvent): Record<string, unknown> {
  const { type: _type, ...rest } = event;
  return rest;
}

// Reconstruct a typed event from a stored row.
export function fromRow(row: {
  type: ReasoningEventType;
  payload: unknown;
  seq: number;
  createdAt: Date | string;
}): StoredReasoningEvent {
  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<
    string,
    unknown
  >;
  return {
    type: row.type,
    ...payload,
    seq: row.seq,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  } as StoredReasoningEvent;
}
