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

  // Roll the period window forward to the one that contains 'now'.
  let periodStart = budget?.currentPeriodStart
    ? budget.currentPeriodStart.getTime()
    : now;
  let advanced = false;
  while (periodStart + PERIOD_MS <= now) {
    periodStart += PERIOD_MS;
    advanced = true;
  }
  if (advanced && budget) {
    await db.tenantBudget
      .update({
        where: { tenantId },
        data: { currentPeriodStart: new Date(periodStart), creditsUsedThisPeriod: 0 },
      })
      .catch(() => {});
  }

  const used = await db.scan.count({
    where: {
      tenantId,
      requestedAt: { gte: new Date(periodStart) },
      NOT: { status: ScanStatus.cancelled },
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
