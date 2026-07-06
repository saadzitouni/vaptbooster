import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pb-10 border-b border-line mb-10">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
          <h1 className="text-[clamp(28px,3.4vw,40px)] leading-tight tracking-tight2 font-medium">
            {title}
          </h1>
          {lede && (
            <p className="mt-4 text-fg-2 text-[14.5px] max-w-2xl">{lede}</p>
          )}
        </div>
        {actions && <div className="shrink-0 flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
