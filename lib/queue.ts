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
  active: boolean = process.env.SCAN_ACTIVE !== "false"
) {
  await scanQueue.add(
    "scan",
    { scanId, tenantId, active },
    { jobId: scanId, removeOnComplete: 200, removeOnFail: 200 }
  );
}
