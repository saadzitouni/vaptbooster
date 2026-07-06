#!/usr/bin/env tsx
/**
 * aggregate-budgets.ts
 *
 * Nightly cron: reconcile each tenant's period spend from usage_records
 * and roll the monthly budget period when it elapses.
 *
 * Run (as DB owner — cross-tenant):
 *   DATABASE_URL=<owner-url> npx tsx scripts/aggregate-budgets.ts
 *
 * Cron example (daily 02:00):
 *   0 2 * * *  cd /app && DATABASE_URL=$DIRECT_URL npx tsx scripts/aggregate-budgets.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PERIOD_DAYS = 30;
const PERIOD_MS = PERIOD_DAYS * 24 * 3600 * 1000;

async function main() {
  const budgets = await prisma.tenantBudget.findMany();
  const now = new Date();
  console.log(`Aggregating ${budgets.length} tenant budgets…`);

  for (const b of budgets) {
    const periodEnd = new Date(b.currentPeriodStart.getTime() + PERIOD_MS);

    if (now >= periodEnd) {
      // Period elapsed → roll it. Carry unused credits (capped at one month).
      const unused = Math.max(0, b.monthlyCreditsIncluded - b.creditsUsedThisPeriod);
      const rolledOver = Math.min(unused, b.monthlyCreditsIncluded);
      await prisma.tenantBudget.update({
        where: { tenantId: b.tenantId },
        data: {
          currentPeriodStart: now,
          creditsUsedThisPeriod: 0,
          spendThisPeriodUsdCents: 0,
          creditsRolledOver: rolledOver,
        },
      });
      console.log(`  ${b.tenantId}: period rolled (rollover ${rolledOver} credits)`);
      continue;
    }

    // Reconcile spend from usage records within the current period.
    const agg = await prisma.usageRecord.aggregate({
      where: { tenantId: b.tenantId, occurredAt: { gte: b.currentPeriodStart } },
      _sum: { costUsdCents: true },
    });
    const spend = agg._sum.costUsdCents ?? 0;
    await prisma.tenantBudget.update({
      where: { tenantId: b.tenantId },
      data: { spendThisPeriodUsdCents: spend },
    });
    console.log(
      `  ${b.tenantId}: spend=${spend}c  credits=${b.creditsUsedThisPeriod}/${b.monthlyCreditsIncluded}`
    );
  }

  console.log("✓ budget aggregation complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
