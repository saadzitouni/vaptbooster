import { ComingSoon } from "@/components/ui/ComingSoon";

export default function ReportsPage() {
  return (
    <ComingSoon
      eyebrow="// tenant"
      title={
        <>
          Reports &amp; <span className="em">exports</span>
        </>
      }
      lede="Generated pentest reports, executive summaries, and evidence bundles for each completed engagement."
      note="Report generation isn't implemented in the current build. Once wired, completed scans produce downloadable PDF/HTML reports and evidence archives here."
    />
  );
}
