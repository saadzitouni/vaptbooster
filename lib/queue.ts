// BullMQ producer — the app enqueues scan jobs here; the worker
// (worker/) consumes them. Singleton connection to survive dev hot-reload.
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const SCAN_QUEUE = "scans";

declare global {
  // eslint-disable-next-line no-var
  var __scanQueueConn: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __scanQueue: Queue | undefined;
}

const connection =
  global.__scanQueueConn ??
  new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export const scanQueue: Queue =
  global.__scanQueue ??
  new Queue(SCAN_QUEUE, {
    connection: connection as unknown as ConnectionOptions,
  });

if (process.env.NODE_ENV !== "production") {
  global.__scanQueueConn = connection;
  global.__scanQueue = scanQueue;
}

/**
 * Enqueue a scan for the worker. jobId = scanId dedupes double-approvals.
 *
 * `active` turns on Stage-3 vulnerability testing (SQLi / IDOR / XSS / form /
 * API). This is a pentest product and the target is already scope-VERIFIED
 * (the authorization gate), so active testing is ON by default — a scan that
 * only did passive header checks would never find SQLi/IDOR. Set
 * SCAN_ACTIVE=false to fall back to recon+passive only.
 */
export async function enqueueScan(
  scanId: string,
  tenantId: string,
  opts: { active?: boolean; resume?: boolean } = {}
) {
  const active = opts.active ?? process.env.SCAN_ACTIVE !== "false";
  const resume = opts.resume ?? false;
  // Resuming re-runs the SAME scanId — clear any prior (failed) job with that
  // jobId first, otherwise BullMQ dedupes it and the resume never runs.
  if (resume) await scanQueue.remove(scanId).catch(() => {});
  await scanQueue.add(
    "scan",
    { scanId, tenantId, active, resume },
    { jobId: scanId, removeOnComplete: 200, removeOnFail: 200 }
  );
}

/**
 * Remove a scan's queued job. If the job is still waiting, this stops it from
 * ever starting. If it's already active (a worker is processing it), BullMQ
 * can't force-kill it — the worker stops cooperatively when it sees the scan's
 * `cancelled` status. Errors are swallowed either way.
 */
export async function removeScanJob(scanId: string) {
  await scanQueue.remove(scanId).catch(() => {});
}
