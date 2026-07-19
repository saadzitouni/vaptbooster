// =============================================================
// Plan tiers — the single source of truth for what each plan includes.
// Scans/month is the quota enforced at scan-request time (lib/usage.ts).
// =============================================================
export type PlanKey = "solo" | "team" | "enterprise";

export const PLANS: Record<
  PlanKey,
  { label: string; scans: number; retests: number; scanBudgetUsdCents: number; priceUsdCents: number }
> = {
  // `retests` caps courtesy re-checks per period. They don't consume a scan,
  // but each is a full (paid) autonomous run, so they're bounded separately —
  // generously (2x scans) since a fix→retest→fix loop is legitimate.
  // `scanBudgetUsdCents` = per-scan LLM cost cap for the tier (override per
  // tenant via TenantBudget.scanCeilingUsdCents).
  solo: { label: "Solo", scans: 10, retests: 20, scanBudgetUsdCents: 600, priceUsdCents: 49000 },
  team: { label: "Team", scans: 50, retests: 100, scanBudgetUsdCents: 1200, priceUsdCents: 199000 },
  enterprise: { label: "Enterprise", scans: 200, retests: 400, scanBudgetUsdCents: 2500, priceUsdCents: 500000 },
};

export const PLAN_KEYS: PlanKey[] = ["solo", "team", "enterprise"];

// Billing period length. A tenant's window rolls forward from its
// currentPeriodStart in these increments.
export const PERIOD_DAYS = 30;

export function planScans(plan: string): number {
  return PLANS[plan as PlanKey]?.scans ?? PLANS.solo.scans;
}
export function planRetests(plan: string): number {
  return PLANS[plan as PlanKey]?.retests ?? PLANS.solo.retests;
}
export function planScanBudget(plan: string): number {
  return PLANS[plan as PlanKey]?.scanBudgetUsdCents ?? PLANS.solo.scanBudgetUsdCents;
}
export function planLabel(plan: string): string {
  return PLANS[plan as PlanKey]?.label ?? plan;
}
export function planPriceCents(plan: string): number {
  return PLANS[plan as PlanKey]?.priceUsdCents ?? PLANS.solo.priceUsdCents;
}
