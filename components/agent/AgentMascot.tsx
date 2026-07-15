import { cn } from "@/lib/utils";

export type MascotState = "idle" | "thinking" | "scanning" | "alert" | "clear";

const SRC: Record<MascotState, string> = {
  idle: "/mascot/idle.svg",
  thinking: "/mascot/thinking.svg",
  scanning: "/mascot/scanning.svg",
  alert: "/mascot/alert.svg",
  clear: "/mascot/clear.svg",
};

// The animated agent mascot. Served as a static SVG (its CSS animation runs
// inside the <img>, isolated from the page), swapped by state.
export function AgentMascot({
  state,
  label,
  size = 88,
  className,
}: {
  state: MascotState;
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {/* key restarts the element (and its animation) on a state change */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={state}
        src={SRC[state]}
        alt={`agent — ${state}`}
        width={size}
        height={Math.round((size * 168) / 156)}
        className="select-none"
        draggable={false}
      />
      {label && (
        <span className="text-2xs font-mono text-fg-mute text-center leading-tight max-w-[180px]">
          {label}
        </span>
      )}
    </div>
  );
}

// Derive the mascot's mood from a scan's status + finding counts.
export function scanMascot(
  status: string,
  counts: { critical: number; high: number; medium: number; low: number; info?: number }
): { state: MascotState; label: string } {
  const severe = counts.critical + counts.high;
  const vulns = severe + counts.medium + counts.low;
  switch (status) {
    case "running":
      return severe > 0
        ? { state: "alert", label: "vulnerability found — digging deeper" }
        : { state: "scanning", label: "scanning the target…" };
    case "queued":
      return { state: "thinking", label: "queued — warming up" };
    case "pending_approval":
      return { state: "idle", label: "awaiting approval" };
    case "completed":
      return vulns > 0
        ? { state: "alert", label: `${vulns} finding${vulns === 1 ? "" : "s"} to review` }
        : { state: "clear", label: "all clear — no vulnerabilities" };
    case "paused_ceiling":
      return { state: "idle", label: "paused — cost ceiling" };
    case "failed":
      return { state: "idle", label: "scan failed" };
    case "cancelled":
      return { state: "idle", label: "cancelled" };
    default:
      return { state: "idle", label: "idle" };
  }
}
