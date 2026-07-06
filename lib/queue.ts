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

/** Enqueue a scan for the worker. jobId = scanId dedupes double-approvals. */
export async function enqueueScan(scanId: string, tenantId: string) {
  await scanQueue.add(
    "scan",
    { scanId, tenantId },
    { jobId: scanId, removeOnComplete: 200, removeOnFail: 200 }
  );
}
