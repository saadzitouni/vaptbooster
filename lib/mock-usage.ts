// =============================================================
// View-model type for the operator usage/cost dashboard. Computed by
// getOperatorUsage() in lib/queries.ts from live usage_records + budgets.
// (Formerly held mock rollups; only the type remains.)
// =============================================================

export type MockUsageSummary = {
  tenantId: string;
  tenantName: string;
  plan: "solo" | "team" | "enterprise";

  monthlyCreditsIncluded: number;
  creditsUsedThisPeriod: number;

  spendThisPeriodUsdCents: number;
  spendLast24hUsdCents: number;

  // Internal cost — what we paid to providers (less than spend if profitable)
  llmCostThisPeriodUsdCents: number;
  llmCostLast24hUsdCents: number;

  scansThisPeriod: number;
  avgCostPerScanUsdCents: number;

  // Health flag derived from margin
  margin: number; // 0..1 (revenue - cost) / revenue
};
