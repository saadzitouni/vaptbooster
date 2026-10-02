// =============================================================
// Scheduled scans — the worker's DB-backed cron. A ticker in index.ts calls
// runDueSchedules() every minute (guarded by a Postgres advisory lock so only
// one worker fires, even with several worker containers). Due schedules create
// an auto-approved, queued scan and enqueue it, then roll nextRunAt forward.
//
// computeNextRunAt below is a byte-for-byte copy of lib/schedule.ts (the worker
// is a separate build and can't import from the Next app) — change both together.
// scan_schedules is read/written via raw SQL because the worker's generated
// Prisma client can lag new tables/columns (same pattern as credentials/kind).
// =============================================================
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";

// Accepts either the base client or an interactive-transaction client.
type RawClient = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;
import type { Logger } from "pino";

// ---- timezone-aware next-run (mirror of lib/schedule.ts) --------------------
type Frequency = "daily" | "weekly" | "monthly";
type ScheduleSpec = {
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
};

const DAY_MS = 86_400_000;
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function offsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") m[p.type] = p.value;
  let hour = Number(m.hour);
  if (hour === 24) hour = 0;
  const asLocal = Date.UTC(+m.year, +m.month - 1, +m.day, hour, +m.minute, +m.second);
  return asLocal - utcMs;
}

function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = offsetMs(guess, tz);
  const corrected = guess - off1;
  const off2 = offsetMs(corrected, tz);
  return off2 === off1 ? corrected : guess - off2;
}

function localCal(utcMs: number, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") m[p.type] = p.value;
  return { y: +m.year, mo: +m.month, d: +m.day, wd: WD[m.weekday] ?? 0 };
}

export function computeNextRunAt(spec: ScheduleSpec, fromMs: number = Date.now()): Date {
  const base = localCal(fromMs, spec.timezone);
  const anchor = Date.UTC(base.y, base.mo - 1, base.d, 12);
  for (let i = 0; i < 400; i++) {
    const { y, mo, d, wd } = localCal(anchor + i * DAY_MS, spec.timezone);
    const match =
      spec.frequency === "daily"
        ? true
        : spec.frequency === "weekly"
          ? wd === spec.dayOfWeek
          : d === spec.dayOfMonth;
    if (!match) continue;
    const cand = wallToUtc(y, mo, d, spec.hour, spec.minute, spec.timezone);
    if (cand > fromMs) return new Date(cand);
  }
  return new Date(fromMs + DAY_MS);
}

// ---- plan quota (mirror of lib/usage.ts + lib/plans.ts) ---------------------
const PERIOD_MS = 30 * DAY_MS; // lib/plans.ts PERIOD_DAYS
const PLAN_SCAN_BUDGET_CENTS: Record<string, number> = { solo: 600, team: 1200, enterprise: 2500 };

type ScheduleRow = {
  id: string;
  tenantId: string;
  targetId: string;
  frequency: Frequency;
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timezone: string;
  notes: string | null;
  credentials: string | null;
  createdById: string | null;
};

// Scans used this period vs the plan quota — the worker's own read of the same
// rules enforced in lib/usage.ts (kept deliberately minimal).
async function planQuota(
  prisma: RawClient,
  tenantId: string
): Promise<{ atLimit: boolean; used: number; included: number; planLabel: string; scanBudgetCents: number }> {
  const budgets = await prisma.$queryRawUnsafe<
    {
      plan: string | null;
      monthlyCreditsIncluded: number | null;
      scanCeilingUsdCents: number | null;
      scanPeriodStart: Date | null;
      currentPeriodStart: Date | null;
    }[]
  >(
    'SELECT plan, "monthlyCreditsIncluded", "scanCeilingUsdCents", "scanPeriodStart", "currentPeriodStart" FROM tenant_budgets WHERE "tenantId" = $1',
    tenantId
  );
  const b = budgets[0];
  const plan = b?.plan ?? "solo";
  const included = b?.monthlyCreditsIncluded ?? 10;
  const now = Date.now();
  let periodStart =
    b?.scanPeriodStart?.getTime() ?? b?.currentPeriodStart?.getTime() ?? now - PERIOD_MS;
  while (periodStart + PERIOD_MS <= now) periodStart += PERIOD_MS;

  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM scans
       WHERE "tenantId" = $1 AND "requestedAt" >= $2
         AND status <> 'cancelled' AND COALESCE(kind,'assessment') <> 'retest'`,
    tenantId,
    new Date(periodStart)
  );
  const used = Number(rows[0]?.n ?? 0);
  const scanBudgetCents =
    b?.scanCeilingUsdCents ?? PLAN_SCAN_BUDGET_CENTS[plan] ?? PLAN_SCAN_BUDGET_CENTS.solo;
  return { atLimit: used >= included, used, included, planLabel: plan, scanBudgetCents };
}

async function notify(
  prisma: RawClient,
  userId: string | null,
  tenantId: string,
  type: string,
  title: string,
  body: string,
  link: string
) {
  if (!userId) return;
  try {
    await prisma.$executeRawUnsafe(
      'INSERT INTO notifications (id, "userId", "tenantId", type, title, body, link, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7, now())',
      randomUUID(),
      userId,
      tenantId,
      type,
      title.slice(0, 200),
      body.slice(0, 500),
      link
    );
  } catch {
    /* non-fatal */
  }
}

/**
 * Fire every schedule whose nextRunAt has passed. Caller holds the advisory
 * lock. Each schedule fires at most once per tick: nextRunAt always rolls to
 * the next *future* occurrence, so a worker outage collapses missed runs into
 * one rather than stampeding.
 */
export async function runDueSchedules(
  prisma: RawClient,
  enqueue: (scanId: string, tenantId: string) => Promise<void>,
  log: Logger
): Promise<void> {
  const due = await prisma.$queryRawUnsafe<ScheduleRow[]>(
    `SELECT id, "tenantId", "targetId", frequency, hour, minute,
            "dayOfWeek", "dayOfMonth", timezone, notes, credentials, "createdById"
       FROM scan_schedules
      WHERE active = true AND "nextRunAt" <= now()
      ORDER BY "nextRunAt" ASC
      LIMIT 50`
  );
  if (!due.length) return;

  for (const s of due) {
    const spec: ScheduleSpec = {
      frequency: s.frequency,
      hour: s.hour,
      minute: s.minute,
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
      timezone: s.timezone,
    };
    const nextRunAt = computeNextRunAt(spec, Date.now());

    try {
      // Target must still exist and be verified (authorization gate).
      const targets = await prisma.$queryRawUnsafe<{ verifiedAt: Date | null; value: string }[]>(
        'SELECT "verifiedAt", value FROM scope_targets WHERE id = $1 AND "tenantId" = $2',
        s.targetId,
        s.tenantId
      );
      const target = targets[0];
      if (!target || !target.verifiedAt) {
        log.warn({ scheduleId: s.id }, "schedule_skipped_unverified_target");
        await prisma.$executeRawUnsafe(
          'UPDATE scan_schedules SET "nextRunAt" = $1, "updatedAt" = now() WHERE id = $2',
          nextRunAt,
          s.id
        );
        continue;
      }

      // Plan quota — skip this occurrence, keep the schedule (operator choice).
      const quota = await planQuota(prisma, s.tenantId);
      if (quota.atLimit) {
        log.info({ scheduleId: s.id, used: quota.used, included: quota.included }, "schedule_skipped_quota");
        await notify(
          prisma,
          s.createdById,
          s.tenantId,
          "scan_skipped",
          "Scheduled scan skipped — quota reached",
          `Your scheduled scan of ${target.value} didn't run: ${quota.used}/${quota.included} scans used this period. It will try again next cycle.`,
          "/scans/schedules"
        );
        await prisma.$executeRawUnsafe(
          'UPDATE scan_schedules SET "nextRunAt" = $1, "lastRunAt" = now(), "updatedAt" = now() WHERE id = $2',
          nextRunAt,
          s.id
        );
        continue;
      }

      // Create the auto-approved, queued scan and enqueue it.
      const scanId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO scans
           (id, "tenantId", "targetId", "targetValue", status, "requesterId",
            "approverId", "approvedAt", notes, credentials, "ceilingUsdCents", kind)
         VALUES ($1,$2,$3,$4,'queued',$5,$5,now(),$6,$7,$8,'assessment')`,
        scanId,
        s.tenantId,
        s.targetId,
        target.value,
        s.createdById,
        s.notes,
        s.credentials,
        quota.scanBudgetCents
      );
      await enqueue(scanId, s.tenantId);

      await prisma.$executeRawUnsafe(
        'UPDATE scan_schedules SET "nextRunAt" = $1, "lastRunAt" = now(), "lastScanId" = $2, "updatedAt" = now() WHERE id = $3',
        nextRunAt,
        scanId,
        s.id
      );
      log.info({ scheduleId: s.id, scanId, tenantId: s.tenantId, nextRunAt }, "schedule_fired");
    } catch (err) {
      // Still advance nextRunAt so one bad schedule can't jam the tick forever.
      log.error({ scheduleId: s.id, err: (err as Error).message }, "schedule_fire_failed");
      await prisma
        .$executeRawUnsafe(
          'UPDATE scan_schedules SET "nextRunAt" = $1, "updatedAt" = now() WHERE id = $2',
          nextRunAt,
          s.id
        )
        .catch(() => {});
    }
  }
}
