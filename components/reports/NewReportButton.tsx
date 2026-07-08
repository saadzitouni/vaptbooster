"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { createReport } from "@/lib/actions/reports";

// Tenant one-click create → blank draft → redirects to the editor (where a
// scan's findings can be imported).
export function NewReportButton() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="solid"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            try {
              await createReport({});
            } catch (e) {
              // redirect() throws internally on success — only surface real errors.
              const m = e instanceof Error ? e.message : "";
              if (m && !m.includes("NEXT_REDIRECT")) setErr(m);
            }
          })
        }
      >
        {pending ? "Creating…" : "+ New report"}
      </Button>
      {err && <span className="text-2xs font-mono text-crit">{err}</span>}
    </div>
  );
}
