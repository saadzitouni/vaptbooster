"use client";

import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

export function Topbar({
  user,
  tenantSlug,
}: {
  user: { name: string; email: string };
  tenantSlug?: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="flex items-center justify-between h-14 px-6">
        {/* Breadcrumb area */}
        <div className="flex items-center gap-3 text-2xs text-fg-mute font-mono">
          {tenantSlug && (
            <>
              <span>tenant</span>
              <span className="text-fg-2">/</span>
              <span className="text-fg">{tenantSlug}.vaptbooster.pwntrol.com</span>
            </>
          )}
        </div>

        {/* User cluster */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 text-2xs font-mono">
            <span className="text-fg-mute">queue:</span>
            <span className="text-ok pulse-dot">open</span>
          </div>
          <div className="flex items-center gap-2">
            <Avatar name={user.name} />
            <div className="hidden sm:block leading-tight">
              <div className="text-[13px]">{user.name}</div>
              <div className="text-2xs text-fg-mute">{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ redirectTo: "/login" })}
            className={cn(
              "font-mono text-2xs px-2.5 py-1.5 rounded border border-line-2",
              "text-fg-2 hover:text-fg hover:border-fg transition-colors"
            )}
            title="Sign out"
          >
            sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "w-8 h-8 rounded border border-line-2 bg-ink-2",
        "flex items-center justify-center text-2xs font-mono text-fg-2",
        className
      )}
    >
      {initials}
    </div>
  );
}
