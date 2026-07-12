import { ComingSoon } from "@/components/ui/ComingSoon";

export default function OperatorQueuePage() {
  return (
    <ComingSoon
      eyebrow="operator"
      title={
        <>
          Scan <span className="em">queue</span>
        </>
      }
      lede="Scans awaiting approval and jobs currently running on the worker fleet, across every tenant."
      note="The queue view isn't implemented in the current build. Once wired, operators approve pending scans and monitor BullMQ job state and ceiling enforcement here."
    />
  );
}
