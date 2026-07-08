"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createReport } from "@/lib/actions/reports";

// Operator create — must name the target client (tenant). Findings are
// imported later in the editor.
export function NewReportForm({
  tenants,
}: {
  tenants: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (tenants.length === 0) {
    return (
      <span className="text-2xs font-mono text-fg-mute">
        No tenants — onboard a client first.
      </span>
    );
  }

  if (!open) {
    return (
      <Button variant="solid" size="sm" onClick={() => setOpen(true)}>
        + New report
      </Button>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-line-2 bg-ink-2 w-[320px]">
      <div className="space-y-3">
        <div>
          <label className="block text-2xs font-mono text-fg-mute mb-1.5">Client (tenant)</label>
          <select
            className="w-full bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg outline-none focus:border-fg"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-mono text-fg-mute mb-1.5">Title (optional)</label>
          <input
            className="w-full bg-ink-3 border border-line-2 rounded px-3 py-2 text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-fg"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Security Assessment Report"
          />
        </div>
        {err && <div className="text-2xs font-mono text-crit">{err}</div>}
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="solid"
            size="sm"
            disabled={pending || !tenantId}
            onClick={() =>
              start(async () => {
                setErr(null);
                try {
                  await createReport({ tenantId, title: title.trim() || undefined });
                } catch (e) {
                  const m = e instanceof Error ? e.message : "";
                  if (m && !m.includes("NEXT_REDIRECT")) setErr(m);
                }
              })
            }
          >
            {pending ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
