"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/lib/actions/notifications";
import { cn, timeAgo } from "@/lib/utils";

export type NotifItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const TONE: Record<string, string> = {
  finding_critical: "bg-crit",
  scan_failed: "bg-crit",
  scan_completed: "bg-ok",
  scan_approved: "bg-ok",
  scan_rejected: "bg-warn",
  message: "bg-info",
};

export function NotificationBell({ items, unread }: { items: NotifItem[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) start(async () => { await markAllRead(); router.refresh(); });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        title="Notifications"
        className="relative w-8 h-8 rounded border border-line-2 bg-ink-2 flex items-center justify-center text-fg-2 hover:text-fg hover:border-fg transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-crit text-ink text-[10px] font-mono font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-ink border border-line rounded-lg shadow-xl z-50">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between sticky top-0 bg-ink">
            <span className="eyebrow">notifications</span>
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-2xs font-mono text-fg-mute hover:text-fg">
              view all →
            </Link>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-fg-mute text-sm">No notifications yet.</div>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={cn("border-b border-line last:border-b-0", !n.readAt && "bg-ink-2/40")}>
                  <Row n={n} onNav={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ n, onNav }: { n: NotifItem; onNav: () => void }) {
  const inner = (
    <div className="px-4 py-3 hover:bg-ink-2 transition-colors flex items-start gap-2.5">
      <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", TONE[n.type] ?? "bg-fg-mute")} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg leading-snug">{n.title}</div>
        {n.body && <div className="text-2xs text-fg-2 mt-0.5 line-clamp-2">{n.body}</div>}
        <div className="text-2xs text-fg-mute font-mono mt-1">{timeAgo(n.createdAt)}</div>
      </div>
    </div>
  );
  return n.link ? (
    <Link href={n.link} onClick={onNav}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
