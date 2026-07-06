import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

// Shared placeholder for screens that are part of the product surface
// (linked in the nav) but not yet implemented in this build. Keeps the
// navigation complete end-to-end instead of 404-ing.
export function ComingSoon({
  eyebrow,
  title,
  lede,
  note,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} lede={lede} />
      <Panel className="px-6 py-16">
        <div className="max-w-md mx-auto text-center">
          <div className="eyebrow mb-4">// not yet wired</div>
          <h3 className="text-[20px] font-medium">
            On the <span className="em">roadmap</span>
          </h3>
          <p className="mt-4 text-fg-2 text-[14px] leading-relaxed">
            {note ??
              "This screen isn't implemented in the current build. The route and navigation are in place so the product flow stays complete end-to-end."}
          </p>
        </div>
      </Panel>
    </>
  );
}
