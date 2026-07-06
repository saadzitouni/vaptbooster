import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { Severity, ScanStatus, FindingStatus } from "@/lib/mock-data";

type Tone = "default" | "ok" | "warn" | "crit" | "info" | "mute";

export function Badge({
  tone = "default",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<Tone, string> = {
    default: "border-line-2 text-fg",
    ok: "border-ok/40 text-ok",
    warn: "border-warn/40 text-warn",
    crit: "border-crit/40 text-crit",
    info: "border-info/40 text-info",
    mute: "border-line text-fg-mute",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded",
        "border bg-transparent",
        "font-mono text-2xs",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONES: Record<Severity, Tone> = {
  critical: "crit",
  high: "warn",
  medium: "info",
  low: "mute",
  info: "mute",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY_TONES[severity]}>{severity.toUpperCase()}</Badge>;
}

const SCAN_STATUS_TONES: Record<ScanStatus, Tone> = {
  draft: "mute",
  pending_approval: "warn",
  queued: "info",
  running: "info",
  reviewing: "info",
  completed: "ok",
  failed: "crit",
  cancelled: "mute",
  paused_ceiling: "warn",
};

const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  draft: "draft",
  pending_approval: "awaiting approval",
  queued: "queued",
  running: "running",
  reviewing: "in review",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  paused_ceiling: "paused · ceiling",
};

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const live = status === "running" || status === "reviewing";
  return (
    <Badge tone={SCAN_STATUS_TONES[status]}>
      <span className={live ? "pulse-dot" : ""}>{SCAN_STATUS_LABEL[status]}</span>
    </Badge>
  );
}

const FINDING_STATUS_TONES: Record<FindingStatus, Tone> = {
  open: "warn",
  triaged: "info",
  fixed: "ok",
  wontfix: "mute",
  duplicate: "mute",
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <Badge tone={FINDING_STATUS_TONES[status]}>{status}</Badge>;
}
