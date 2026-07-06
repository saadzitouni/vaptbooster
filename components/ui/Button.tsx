import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "solid" | "ghost" | "line" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  solid:
    "bg-fg text-ink border border-fg hover:bg-white hover:border-white disabled:bg-line-2 disabled:text-fg-mute disabled:border-line-2",
  ghost:
    "bg-transparent text-fg-2 border border-transparent hover:text-fg hover:bg-ink-2",
  line:
    "bg-transparent text-fg border border-line-2 hover:border-fg disabled:opacity-50",
  danger:
    "bg-transparent text-crit border border-crit/40 hover:border-crit hover:bg-crit/5",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-[13px]",
  lg: "px-5 py-3 text-sm",
};

export function Button({
  variant = "line",
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center gap-2 rounded font-mono transition-colors",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
    >
      {children}
    </button>
  );
}
