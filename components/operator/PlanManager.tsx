"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PLAN_KEYS, PLANS } from "@/lib/plans";
import {
  operatorSetTenantPlan,
  operatorSetScanLimit,
  operatorSetScanBudget,
  operatorResetTenantPeriod,
} from "@/lib/actions/tenants";

export function PlanManager({
  tenantId,
  plan,
  used,
  included,
  resetsAt,
  scanBudgetCents,
}: {
  tenantId: string;
  plan: string;
  used: number;
  included: number;
  resetsAt: string;
  scanBudgetCents: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [limit, setLimit] = useState(included);
  const [budget, setBudget] = useState(scanBudgetCents / 100);

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  const over = used >= included;

  return (
    <div className="bg-ink border border-line rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium">Plan &amp; quota</h3>
        <span className={`text-2xs font-mono ${over ? "text-crit" : "text-fg-mute"}`}>
          {used}/{included} scans used · resets {new Date(resetsAt).toLocaleDateString("en-GB")}
        </span>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-2xs font-mono text-fg-mute mb-1.5">plan</label>
          <div className="flex gap-2 flex-wrap">
            {PLAN_KEYS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={pending}
                onClick={() => run(() => operatorSetTenantPlan(tenantId, p))}
                className={`px-3 py-1.5 rounded border text-2xs font-mono transition-colors disabled:opacity-50 ${
                  plan === p
                    ? "bg-fg text-ink border-fg"
                    : "border-line-2 text-fg-2 hover:border-fg hover:text-fg"
                }`}
              >
                {PLANS[p].label} · {PLANS[p].scans}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-fg-mute">
            Changing the plan sets the scan quota to that tier&apos;s default.
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-2xs font-mono text-fg-mute mb-1.5">
              scan limit (override)
            </label>
            <input
              type="number"
              min={0}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-28 bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg focus:border-fg outline-none"
            />
          </div>
          <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => operatorSetScanLimit(tenantId, limit))}>
            Set limit
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => operatorResetTenantPeriod(tenantId))}>
            Reset period
          </Button>
        </div>

        <div className="flex items-end gap-2 flex-wrap pt-1">
          <div>
            <label className="block text-2xs font-mono text-fg-mute mb-1.5">
              per-scan budget (USD)
            </label>
            <input
              type="number"
              min={0}
              step="0.5"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-28 bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg focus:border-fg outline-none"
            />
          </div>
          <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => operatorSetScanBudget(tenantId, budget))}>
            Set budget
          </Button>
          <p className="w-full text-2xs text-fg-mute mt-0.5">
            Max spend per scan for this tenant. <span className="text-fg-2">0</span> = the{" "}
            {plan} plan default. Applies to the next scan.
          </p>
        </div>

        {msg && (
          <div className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
