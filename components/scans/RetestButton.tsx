"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retestFindings } from "@/lib/actions/scans";
import { cn } from "@/lib/utils";

// Launch a scoped regression scan that re-verifies whether the selected prior
// finding(s) are still exploitable. On success it either jumps to the new
// scan's live page (redirectTo set) or just reports "started" and refreshes.
export function RetestButton({
  findingIds,
  label = "Retest",
  redirectTo,
  size = "sm",
  className,
}: {
  findingIds: string[];
  label?: string;
  redirectTo?: string; // e.g. "/scans/" — the new scanId is appended
  size?: "sm" | "md";
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  if (!findingIds.length) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        disabled={pending}
        title="Re-verify whether this issue is still exploitable (scoped scan — doesn't use a plan scan)"
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await retestFindings(findingIds);
            if (r.ok && r.scanId && redirectTo) {
              router.push(`${redirectTo}${r.scanId}`);
            } else {
              setMsg({ ok: r.ok, text: r.ok ? "Retest started — running…" : r.message });
              if (r.ok) router.refresh();
            }
          })
        }
        className={cn(
          "rounded border font-mono transition-colors disabled:opacity-50 bg-transparent text-fg-2 border-line-2 hover:border-fg hover:text-fg",
          size === "md" ? "px-3 py-1.5 text-2xs" : "px-2 py-1 text-2xs"
        )}
      >
        {pending ? "starting…" : label}
      </button>
      {msg && (
        <span className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
