import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Input";
import { requireTenantId } from "@/lib/session";
import { getTenantScope, getTenantUsage } from "@/lib/queries";
import { requestScan } from "@/lib/actions/scans";

export default async function NewScanPage() {
  const tenantId = await requireTenantId();
  const [scope, usage] = await Promise.all([
    getTenantScope(tenantId),
    getTenantUsage(tenantId),
  ]);
  // Only verified targets are scannable (enforced in requestScan + the worker).
  const verified = scope.filter((s) => s.verifiedAt);
  const resetDate = new Date(usage.resetsAt).toLocaleDateString("en-GB");

  return (
    <>
      <div className="mb-6">
        <Link href="/scans" className="text-2xs text-fg-mute font-mono hover:text-fg">
          ← all scans
        </Link>
      </div>

      <PageHeader
        eyebrow="tenant · scans"
        title={
          <>
            Request a <span className="em">scan</span>
          </>
        }
        lede={`${usage.remaining} of ${usage.included} scans left this period on the ${usage.planLabel} plan · resets ${resetDate}.`}
      />

      {usage.atLimit ? (
        <Panel className="px-6 py-12">
          <div className="max-w-md mx-auto text-center">
            <div className="eyebrow mb-3 text-crit">scan limit reached</div>
            <p className="text-fg-2 text-[14px]">
              You&apos;ve used all{" "}
              <span className="text-fg">{usage.included}</span> scans on the{" "}
              {usage.planLabel} plan for this period. Your quota resets on{" "}
              <span className="text-fg">{resetDate}</span> — or contact us to
              raise your plan.
            </p>
          </div>
        </Panel>
      ) : verified.length === 0 ? (
        <Panel className="px-6 py-12">
          <div className="max-w-md mx-auto text-center">
            <div className="eyebrow mb-3">no verified scope</div>
            <p className="text-fg-2 text-[14px]">
              You have no <span className="text-fg">verified</span> targets in
              scope yet. Add and verify ownership of a target under{" "}
              <Link href="/scope" className="underline text-fg">
                Scope
              </Link>{" "}
              before requesting a scan — scans only run against verified targets.
            </p>
          </div>
        </Panel>
      ) : (
        <Panel className="p-6">
          <form action={requestScan} className="flex flex-col gap-5 max-w-2xl">
            <Field label="Target" required>
              <select
                name="targetId"
                required
                defaultValue=""
                className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
              >
                <option value="" disabled>
                  Choose a target…
                </option>
                {verified.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.value} ({s.type} · verified)
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Notes" hint="Optional — anything the operator should know (out-of-scope paths, timing, etc.)">
              <Textarea
                name="notes"
                placeholder="e.g. Skip /admin/billing — production data."
              />
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" variant="solid" size="lg" className="justify-center">
                Request scan
              </Button>
              <Link href="/scans">
                <Button type="button" variant="ghost" size="lg">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}
