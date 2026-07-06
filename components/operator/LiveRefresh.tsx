"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the current route's server components (fresh DB
 * data) without a full page reload — so newly-requested scans and live scan
 * progress surface on the operator console on their own. Pauses while the tab
 * is hidden to avoid needless work.
 */
export function LiveRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
