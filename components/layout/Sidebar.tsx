"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = { href: string; label: string; icon: ReactNode };

const TENANT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <IconHome /> },
  { href: "/scope",     label: "Scope",     icon: <IconTarget /> },
  { href: "/scans",     label: "Scans",     icon: <IconRadar /> },
  { href: "/findings",  label: "Findings",  icon: <IconBug /> },
  { href: "/reports",   label: "Reports",   icon: <IconReport /> },
  { href: "/settings",  label: "Settings",  icon: <IconCog /> },
];

const OPERATOR_NAV: NavItem[] = [
  { href: "/operator",              label: "Overview",     icon: <IconHome /> },
  { href: "/operator/tenants",      label: "Tenants",      icon: <IconUsers /> },
  { href: "/operator/queue",        label: "Queue",        icon: <IconQueue /> },
  { href: "/operator/usage",        label: "Usage",        icon: <IconChart /> },
  { href: "/operator/findings",     label: "Findings",     icon: <IconBug /> },
  { href: "/operator/reports",      label: "Reports",      icon: <IconReport /> },
  { href: "/operator/skills",       label: "Skills",       icon: <IconBrain /> },
  { href: "/operator/agent-config", label: "Agent config", icon: <IconCog /> },
  { href: "/operator/invites",      label: "Invites",      icon: <IconMail /> },
];

export function Sidebar({
  variant = "tenant",
  tenantName,
}: {
  variant?: "tenant" | "operator";
  tenantName?: string;
}) {
  const pathname = usePathname();
  const items = variant === "operator" ? OPERATOR_NAV : TENANT_NAV;

  return (
    <aside className="hidden md:flex flex-col w-[220px] shrink-0 border-r border-line h-screen sticky top-0">
      {/* Brand block */}
      <div className="px-5 py-5 border-b border-line">
        <Link href={variant === "operator" ? "/operator" : "/dashboard"} className="flex items-center gap-2.5">
          <span className="w-2 h-2 bg-fg rounded-[1px]" />
          <span className="text-[14px] font-medium leading-none">pwntrol</span>
          <span className="text-fg-mute text-[13px]">/</span>
          <span className="text-fg-2 text-[13px]">vaptbooster</span>
        </Link>
        <div className="mt-3 text-2xs text-fg-mute font-mono">
          {variant === "operator" ? (
            <span>
              <span className="text-warn">operator</span> · cross-tenant
            </span>
          ) : (
            tenantName && <span>tenant: <span className="text-fg-2">{tenantName}</span></span>
          )}
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && item.href !== "/operator" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5 text-[13px]",
                "transition-colors",
                active
                  ? "text-fg bg-ink-2 border-l-2 border-fg pl-[18px]"
                  : "text-fg-2 hover:text-fg hover:bg-ink-2"
              )}
            >
              <span className="text-fg-mute">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

// -------- Icons (inline SVG, thin strokes, brutecat-flavored) --------
function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8M5 10v10h14V10" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
function IconRadar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.07 4.93a10 10 0 1 0 .04 14.14" />
      <path d="M12 12l4-4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
function IconBug() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="8" width="10" height="11" rx="5" />
      <path d="M12 8V5M9 5l-2-2M15 5l2-2M5 12H2M5 19H2M5 15H2M19 12h3M19 19h3M19 15h3" />
    </svg>
  );
}
function IconReport() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 12h8M8 16h8M8 8h2" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.4 1.26 1 1.51z" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconQueue() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
function IconBrain() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2a3.5 3.5 0 0 0-3.5 3.5v.5a3 3 0 0 0-2 2.83V11a3 3 0 0 0 1 5.83V18a3.5 3.5 0 0 0 5 3.17V2.5a3.5 3.5 0 0 0-.5-.5z"/>
      <path d="M14.5 2a3.5 3.5 0 0 1 3.5 3.5v.5a3 3 0 0 1 2 2.83V11a3 3 0 0 1-1 5.83V18a3.5 3.5 0 0 1-5 3.17V2.5a3.5 3.5 0 0 1 .5-.5z"/>
    </svg>
  );
}
