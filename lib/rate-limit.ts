// Redis-backed fixed-window rate limiter. Fails OPEN (allows) when Redis is
// unavailable — a limiter outage must never lock real users out.
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

declare global {
  // eslint-disable-next-line no-var
  var __rlRedis: IORedis | undefined;
}

const redis =
  global.__rlRedis ?? new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
if (process.env.NODE_ENV !== "production") global.__rlRedis = redis;

/**
 * Returns true if the action under `key` is still within `limit` per
 * `windowSec`. Increments the counter as a side effect.
 */
export async function rateLimitAllow(
  key: string,
  limit: number,
  windowSec: number
): Promise<boolean> {
  try {
    const k = `rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true; // fail open
  }
}
