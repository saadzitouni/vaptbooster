import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Panel({
  className,
  accent,
  children,
}: {
  className?: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-ink border border-line rounded-lg overflow-hidden",
        className
      )}
    >
      {accent && <div className="h-[3px] bg-fg" />}
      {children}
    </div>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  right,
  children,
}: {
  eyebrow?: string;
  title?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-line">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        {title && (
          <h3 className="text-[15px] font-medium leading-tight">{title}</h3>
        )}
        {children}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
