"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cancelScan } from "@/lib/actions/scans";

// Stop a queued or running scan. A running autonomous scan is stopped
// cooperatively (the worker checks each turn), so it halts within seconds
// rather than needing to run to completion.
export function CancelScanButton({ scanId }: { scanId: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-fg-mute">Cancel this scan?</span>
          <Button
            variant="danger"
            size="md"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await cancelScan(scanId);
                setMsg({ ok: r.ok, text: r.message });
                setConfirming(false);
                if (r.ok) router.refresh();
              })
            }
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </Button>
          <Button variant="ghost" size="md" disabled={pending} onClick={() => setConfirming(false)}>
            Keep running
          </Button>
        </div>
      ) : (
        <Button variant="danger" size="md" onClick={() => setConfirming(true)}>
          Cancel
        </Button>
      )}
      {msg && (
        <span className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
