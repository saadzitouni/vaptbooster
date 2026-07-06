import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Stat({
  label,
  value,
  change,
  tone = "default",
  emphasis = "mono",
  className,
}: {
  label: string;
  value: ReactNode;
  change?: string;
  tone?: "default" | "crit" | "warn" | "ok";
  emphasis?: "mono" | "serif";
  className?: string;
}) {
  const toneCls = {
    default: "text-fg",
    crit: "text-crit",
    warn: "text-warn",
    ok: "text-ok",
  }[tone];
  return (
    <div className={cn("p-5 border border-line bg-ink rounded-lg", className)}>
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "mt-3 leading-none",
          emphasis === "serif" ? "em" : "font-mono font-medium",
          "text-[34px]",
          toneCls
        )}
      >
        {value}
      </div>
      {change && (
        <div className="mt-2 text-2xs text-fg-mute font-mono">{change}</div>
      )}
    </div>
  );
}
