// SSE endpoint for the live reasoning stream. Replays stored events (seq >
// after) then streams live from Redis pub/sub. Returns 404 (never 403) if the
// scan isn't the caller's tenant, so scan existence never leaks across tenants.
import type { NextRequest } from "next/server";
import IORedis from "ioredis";
import { auth } from "@/auth";
import { withOperator, withTenant, type TxClient } from "@/lib/db";
import { fromRow, type StoredReasoningEvent } from "@/lib/reasoning-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await ctx.params;
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const isOperator = session.user.role === "operator";
  const tenantId = session.user.tenantId ?? "";
  if (!isOperator && !tenantId) return new Response("unauthorized", { status: 401 });

  const run = <T>(fn: (db: TxClient) => Promise<T>): Promise<T> =>
    isOperator ? withOperator(fn) : withTenant(tenantId, fn);

  // Ownership: RLS scopes a tenant's query to their rows, so a foreign scan
  // returns null → 404 (no existence leak). Operators see any scan.
  const scan = await run((db) =>
    db.scan.findFirst({ where: { id: scanId }, select: { id: true } })
  ).catch(() => null);
  if (!scan) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const lastId = req.headers.get("last-event-id");
  const after = Math.max(0, Number(url.searchParams.get("after") ?? lastId ?? 0) || 0);

  const encoder = new TextEncoder();
  const channel = `scan:${scanId}:reasoning`;
  let sub: IORedis | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (sub) {
      sub.unsubscribe(channel).catch(() => {});
      sub.quit().catch(() => {});
      sub = null;
    }
  };
  req.signal.addEventListener("abort", cleanup);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const frame = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* stream closed */
        }
      };
      frame(": open\n\n");

      // 1. Replay history after the resume point, in order.
      try {
        const rows = await run((db) =>
          db.reasoningEvent.findMany({
            where: { scanId, seq: { gt: after } },
            orderBy: { seq: "asc" },
            select: { type: true, payload: true, seq: true, createdAt: true },
          })
        );
        for (const r of rows) {
          const ev = fromRow(r);
          frame(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
        }
      } catch {
        /* replay is best-effort */
      }

      // 2. Live subscription.
      sub = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
      await sub.subscribe(channel).catch(() => {});
      sub.on("message", (_ch, payload) => {
        try {
          const ev = JSON.parse(payload) as StoredReasoningEvent;
          if (ev.seq > after) frame(`id: ${ev.seq}\ndata: ${payload}\n\n`);
        } catch {
          /* skip malformed frame */
        }
      });

      // 3. Heartbeat so proxies keep the connection open.
      heartbeat = setInterval(() => frame(": ping\n\n"), 15000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
