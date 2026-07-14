// =============================================================
// Plan usage — how many scans a tenant has used in the current billing period,
// vs the plan quota. Single source of truth for enforcement (requestScan) and
// display (tenant dashboard, operator tenant detail).
//
// Counts actual scans (excluding cancelled) since the current period start, so
// it's truthful regardless of the worker's credit counter. Auto-rolls the
// period window forward if it has elapsed (best-effort persist).
// =============================================================
import { ScanStatus } from "@prisma/client";
import type { TxClient } from "@/lib/db";
import { PERIOD_DAYS, planLabel } from "@/lib/plans";

const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;

export type PlanUsage = {
  plan: string;
  planLabel: string;
  used: number;
  included: number;
  remaining: number;
  atLimit: boolean;
  periodStart: string;
  resetsAt: string;
};

export async function getPlanUsage(
  db: TxClient,
  tenantId: string
): Promise<PlanUsage> {
  const budget = await db.tenantBudget.findUnique({ where: { tenantId } });
  const plan = (budget?.plan as string) ?? "solo";
  const included = budget?.monthlyCreditsIncluded ?? 10;
  const now = Date.now();

  // Scan-quota window — independent of the billing/cost window
  // (currentPeriodStart). Falls back to the billing window, then a rolling 30d.
  // The final fallback is now-PERIOD (NOT now): a tenant with no budget row must
  // still be counted over a real window, not handed an empty (unlimited) one.
  let periodStart =
    budget?.scanPeriodStart?.getTime() ??
    budget?.currentPeriodStart?.getTime() ??
    now - PERIOD_MS;
  let advanced = false;
  while (periodStart + PERIOD_MS <= now) {
    periodStart += PERIOD_MS;
    advanced = true;
  }
  if (advanced && budget) {
    // Roll ONLY the scan window — never touch currentPeriodStart, or cost
    // tracking (which scopes to it) would be wiped.
    await db.tenantBudget
      .update({
        where: { tenantId },
        data: { scanPeriodStart: new Date(periodStart), creditsUsedThisPeriod: 0 },
      })
      .catch(() => {});
  }

  const used = await db.scan.count({
    where: {
      tenantId,
      requestedAt: { gte: new Date(periodStart) },
      NOT: { status: ScanStatus.cancelled },
      // Retests are a courtesy re-verification — they don't count against quota.
      kind: { not: "retest" },
    },
  });

  return {
    plan,
    planLabel: planLabel(plan),
    used,
    included,
    remaining: Math.max(0, included - used),
    atLimit: used >= included,
    periodStart: new Date(periodStart).toISOString(),
    resetsAt: new Date(periodStart + PERIOD_MS).toISOString(),
  };
}
