"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  operatorVerifyTarget,
  operatorUnverifyTarget,
  operatorAddScopeTarget,
  operatorRemoveScopeTarget,
} from "@/lib/actions/operator-scope";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Field } from "@/components/ui/Input";

export type OpTarget = {
  id: string;
  type: string;
  value: string;
  verifiedAt: string | null;
  verifyMethod: string | null;
  addedAt: string;
  scanCount: number;
};

export function OperatorScopePanel({ tenantId, targets }: { tenantId: string; targets: OpTarget[] }) {
  const [addState, addAction, addPending] = useActionState(operatorAddScopeTarget, null);
  const [pending, start] = useTransition();
  const [type, setType] = useState("url");
  const router = useRouter();

  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="flex flex-col gap-6">
      {/* Add target */}
      <Panel className="p-5">
        <div className="eyebrow mb-3">// add a target to this tenant&apos;s scope</div>
        <form action={addAction} className="flex flex-col gap-3 max-w-2xl">
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <Field label="Type" required>
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
              >
                <option value="url">URL</option>
                <option value="domain">Domain</option>
                <option value="ip">IP / CIDR</option>
                <option value="repo">Repo</option>
              </select>
            </Field>
            <Field label="Value" required>
              <Input name="value" placeholder="https://app.example.com" required autoComplete="off" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-2xs font-mono text-fg-2 cursor-pointer">
            <input type="checkbox" name="verify" className="accent-fg" />
            verify immediately — I hold written authorization to test this target
          </label>
          {addState && (
            <div className={`rounded px-3.5 py-2.5 text-2xs font-mono border ${addState.ok ? "border-ok/40 text-ok" : "border-crit/40 text-crit"}`}>
              {addState.message}
            </div>
          )}
          <div>
            <Button type="submit" variant="solid" size="sm" disabled={addPending}>
              {addPending ? "Adding…" : "Add target"}
            </Button>
          </div>
        </form>
      </Panel>

      {/* Targets */}
      <div className="flex flex-col gap-2">
        <div className="eyebrow">// in-scope assets ({targets.length})</div>
        {targets.length === 0 ? (
          <Panel className="px-6 py-10">
            <p className="text-center text-fg-2 text-[14px]">No targets yet.</p>
          </Panel>
        ) : (
          targets.map((t) => (
            <Panel key={t.id} accent={!!t.verifiedAt}>
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-[14px] truncate">{t.value}</span>
                    <Badge tone="mute">{t.type}</Badge>
                    {t.verifiedAt ? (
                      <Badge tone="ok">✓ verified{t.verifyMethod ? ` · ${t.verifyMethod}` : ""}</Badge>
                    ) : (
                      <Badge tone="warn">unverified</Badge>
                    )}
                  </div>
                  <div className="text-2xs text-fg-mute font-mono mt-1">
                    added {new Date(t.addedAt).toLocaleDateString()} · {t.scanCount} scan{t.scanCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {t.verifiedAt ? (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => operatorUnverifyTarget(t.id, tenantId))}>
                      Un-verify
                    </Button>
                  ) : (
                    <Button variant="solid" size="sm" disabled={pending} onClick={() => run(() => operatorVerifyTarget(t.id, tenantId))}>
                      Verify
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Remove ${t.value} from scope?`)) run(() => operatorRemoveScopeTarget(t.id, tenantId));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </Panel>
          ))
        )}
      </div>
    </div>
  );
}
