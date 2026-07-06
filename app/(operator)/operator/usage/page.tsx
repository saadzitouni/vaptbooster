import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { requireOperator } from "@/lib/session";
import { getOperatorUsage } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Helpers — keep cost math in cents until last-minute formatting
const fmtUsd = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
const fmtPct = (frac: number) => `${(frac * 100).toFixed(0)}%`;

export default async function OperatorUsagePage() {
  await requireOperator();
  const { summaries: MOCK_USAGE, dailyTrend: MOCK_DAILY_TREND } =
    await getOperatorUsage();

  // ---- Aggregates ----
  const totalRevenue = MOCK_USAGE.reduce(
    (a, t) => a + t.spendThisPeriodUsdCents,
    0
  );
  const totalLlmCost = MOCK_USAGE.reduce(
    (a, t) => a + t.llmCostThisPeriodUsdCents,
    0
  );
  const grossMargin = (totalRevenue - totalLlmCost) / totalRevenue;
  const totalScans = MOCK_USAGE.reduce((a, t) => a + t.scansThisPeriod, 0);
  const avgCostPerScan = totalLlmCost / Math.max(totalScans, 1);

  const unprofitable = MOCK_USAGE.filter((t) => t.margin < 0.5);

  // Sort: lowest margin first (the ones operator needs to see)
  const tenantsByHealth = [...MOCK_USAGE].sort((a, b) => a.margin - b.margin);

  // Cost trend bounds for the bars
  const maxBar = Math.max(
    ...MOCK_DAILY_TREND.map((d) => Math.max(d.revenueCents, d.llmCostCents))
  );

  return (
    <>
      <PageHeader
        eyebrow="// operator · usage & cost"
        title={
          <>
            Where the <span className="em">money</span> goes.
          </>
        }
        lede={
          <>
            Cost vs. revenue across every tenant this billing period. Use this
            to spot <span className="em-sm text-fg">unprofitable accounts</span>{" "}
            before they bleed your margin.
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Revenue · period"
          value={fmtUsd(totalRevenue)}
          emphasis="serif"
        />
        <Stat
          label="LLM cost · period"
          value={fmtUsd(totalLlmCost)}
          emphasis="serif"
        />
        <Stat
          label="Gross margin"
          value={fmtPct(grossMargin)}
          tone={grossMargin > 0.7 ? "ok" : grossMargin > 0.5 ? "warn" : "crit"}
          emphasis="serif"
          change={`${totalScans} scans · ${fmtUsd(avgCostPerScan)} avg`}
        />
        <Stat
          label="Unprofitable tenants"
          value={unprofitable.length}
          tone={unprofitable.length > 0 ? "warn" : "ok"}
          emphasis="serif"
          change={
            unprofitable.length > 0
              ? `${unprofitable.map((u) => u.tenantName).join(", ")}`
              : "All tenants healthy"
          }
        />
      </div>

      {/* Cost trend chart */}
      <Panel className="mt-8" accent>
        <PanelHeader
          eyebrow="// last 14 days"
          title={
            <>
              Daily <span className="em-sm">revenue vs cost</span>
            </>
          }
          right={
            <div className="flex items-center gap-4 text-2xs font-mono text-fg-mute">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-fg rounded-[1px]" />
                revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-warn rounded-[1px]" />
                llm cost
              </span>
            </div>
          }
        />
        <div className="p-6">
          <div className="flex items-end gap-1.5 h-[160px]">
            {MOCK_DAILY_TREND.map((d) => {
              const revH = (d.revenueCents / maxBar) * 100;
              const costH = (d.llmCostCents / maxBar) * 100;
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center gap-1 group"
                >
                  <div className="w-full h-full flex items-end gap-px">
                    <div
                      className="flex-1 bg-fg/80 group-hover:bg-fg transition-colors rounded-t-[1px]"
                      style={{ height: `${revH}%` }}
                      title={`Revenue: ${fmtUsd(d.revenueCents)}`}
                    />
                    <div
                      className="flex-1 bg-warn/80 group-hover:bg-warn transition-colors rounded-t-[1px]"
                      style={{ height: `${costH}%` }}
                      title={`LLM cost: ${fmtUsd(d.llmCostCents)}`}
                    />
                  </div>
                  <div className="text-[10px] text-fg-mute font-mono">
                    {d.date.slice(-2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* Per-tenant breakdown — the table operator scans every morning */}
      <Panel className="mt-5">
        <PanelHeader
          eyebrow="// per tenant"
          title={
            <>
              Margin <span className="em-sm">breakdown</span>
            </>
          }
          right={
            <span className="text-2xs text-fg-mute font-mono">
              sorted: lowest margin first
            </span>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-ink-2 text-2xs uppercase tracking-[0.14em] text-fg-mute font-mono">
                <th className="text-left px-5 py-3 font-normal">Tenant</th>
                <th className="text-left px-5 py-3 font-normal">Plan</th>
                <th className="text-right px-5 py-3 font-normal">Credits</th>
                <th className="text-right px-5 py-3 font-normal">Revenue</th>
                <th className="text-right px-5 py-3 font-normal">LLM cost</th>
                <th className="text-right px-5 py-3 font-normal">Per scan</th>
                <th className="text-right px-5 py-3 font-normal">Margin</th>
                <th className="text-left  px-5 py-3 font-normal">Health</th>
              </tr>
            </thead>
            <tbody>
              {tenantsByHealth.map((t) => {
                const creditsPct =
                  (t.creditsUsedThisPeriod / t.monthlyCreditsIncluded) * 100;
                const marginTone =
                  t.margin >= 0.7 ? "ok" : t.margin >= 0.5 ? "warn" : "crit";
                return (
                  <tr
                    key={t.tenantId}
                    className="border-b border-line hover:bg-ink-2 transition-colors"
                  >
                    <td className="px-5 py-4 font-medium">{t.tenantName}</td>
                    <td className="px-5 py-4 capitalize text-fg-2">{t.plan}</td>
                    <td className="px-5 py-4 text-right font-mono">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-fg-2">
                          {t.creditsUsedThisPeriod}/{t.monthlyCreditsIncluded}
                        </span>
                        <div className="w-16 h-1.5 bg-ink-2 border border-line rounded-sm overflow-hidden">
                          <div
                            className={cn(
                              "h-full",
                              creditsPct > 90 ? "bg-warn" : "bg-fg"
                            )}
                            style={{ width: `${Math.min(creditsPct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-mono">
                      {fmtUsd(t.spendThisPeriodUsdCents)}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-fg-2">
                      {fmtUsd(t.llmCostThisPeriodUsdCents)}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-2xs text-fg-mute">
                      {fmtUsd(t.avgCostPerScanUsdCents)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-4 text-right font-mono em-sm text-[15px]",
                        marginTone === "ok" && "text-ok",
                        marginTone === "warn" && "text-warn",
                        marginTone === "crit" && "text-crit"
                      )}
                    >
                      {fmtPct(t.margin)}
                    </td>
                    <td className="px-5 py-4">
                      {t.margin >= 0.7 && <Badge tone="ok">healthy</Badge>}
                      {t.margin < 0.7 && t.margin >= 0.5 && (
                        <Badge tone="warn">watch</Badge>
                      )}
                      {t.margin < 0.5 && <Badge tone="crit">bleeding</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Helpful inline guide for the operator */}
      <div className="mt-6 p-5 border border-line rounded-lg bg-ink-2 text-2xs text-fg-mute font-mono leading-relaxed">
        <div className="eyebrow mb-3">// what to do</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="text-fg mb-1">healthy ( ≥ 70% )</div>
            do nothing. they're paying more than they cost.
          </div>
          <div>
            <div className="text-warn mb-1">watch ( 50–70% )</div>
            send the tenant their usage trend. nudge toward a higher plan
            before they hit overage.
          </div>
          <div>
            <div className="text-crit mb-1">bleeding ( &lt; 50% )</div>
            this tenant is consuming most of their plan's value in LLM costs.
            either raise their plan, audit the scans, or end the engagement.
          </div>
        </div>
      </div>
    </>
  );
}
