import { cn } from "@/lib/utils";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        "w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5",
        "font-mono text-[14px] text-fg placeholder:text-fg-mute",
        "focus:outline-none focus:border-fg focus:bg-ink-3",
        "transition-colors",
        className
      )}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cn(
        "w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5",
        "font-mono text-[14px] text-fg placeholder:text-fg-mute",
        "focus:outline-none focus:border-fg focus:bg-ink-3",
        "transition-colors resize-y min-h-[88px]",
        className
      )}
    />
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-2xs tracking-[0.14em] uppercase text-fg-mute font-mono">
        {label}
        {required && <span className="text-crit ml-1">*</span>}
        {!required && hint === undefined && (
          <span className="em-sm normal-case tracking-normal ml-2 text-fg-mute">
            (optional)
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-2xs text-fg-mute font-mono">{hint}</p>}
    </div>
  );
}
