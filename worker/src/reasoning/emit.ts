// =============================================================
// emitReasoning — persist + publish one reasoning event.
//   1. Redact every string in the payload (single choke point).
//   2. Allocate the next per-scan seq and INSERT (raw SQL — the worker's
//      generated client predates this table, like agentLog/agentState).
//   3. Publish the reconstructed event to Redis `scan:{scanId}:reasoning`.
// Never throws — a failed emit must not affect the scan.
// =============================================================
import { randomUUID } from "crypto";
import IORedis from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { type ReasoningEvent, toPayload } from "../reasoning-events.js";
import { redactDeep } from "./redact.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let publisher: IORedis | null = null;
function pub(): IORedis {
  if (!publisher) publisher = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  return publisher;
}

export function reasoningChannel(scanId: string): string {
  return `scan:${scanId}:reasoning`;
}

export async function emitReasoning(
  prisma: PrismaClient,
  scanId: string,
  tenantId: string,
  event: ReasoningEvent
): Promise<void> {
  try {
    const payload = redactDeep(toPayload(event));
    // Single-threaded per scan (one agent) → COALESCE(MAX(seq),0)+1 is safe; the
    // unique(scanId,seq) constraint backstops any accidental concurrency.
    const rows = await prisma.$queryRawUnsafe<{ seq: number; createdAt: Date }[]>(
      `INSERT INTO reasoning_events (id, "tenantId", "scanId", seq, type, payload, "createdAt")
       VALUES ($1, $2, $3,
         (SELECT COALESCE(MAX(seq),0)+1 FROM reasoning_events WHERE "scanId" = $3),
         $4::"ReasoningEventType", $5::jsonb, now())
       RETURNING seq, "createdAt"`,
      randomUUID(),
      tenantId,
      scanId,
      event.type,
      JSON.stringify(payload)
    );
    const row = rows[0];
    if (!row) return;
    const frame = JSON.stringify({
      type: event.type,
      ...payload,
      seq: row.seq,
      createdAt: new Date(row.createdAt).toISOString(),
    });
    await pub().publish(reasoningChannel(scanId), frame);
  } catch (e) {
    console.error("[reasoning] emit failed:", e instanceof Error ? e.message : e);
  }
}
