"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { resumeScan } from "@/lib/actions/scans";

// Continue a failed/paused autonomous scan from its checkpoint instead of
// restarting (which re-bills the client's tokens).
export function ResumeScanButton({ scanId }: { scanId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="solid"
        size="md"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await resumeScan(scanId);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Resuming…" : "Resume scan"}
      </Button>
      {msg && (
        <span className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
