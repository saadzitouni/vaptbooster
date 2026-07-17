import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
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
              verified yet. Add and verify ownership of an asset under{" "}
              <Link href="/assets" className="underline text-fg">
                Assets
              </Link>{" "}
              before requesting a scan — scans only run against verified assets.
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

            {/* Authenticated (gray-box) scanning — optional test account */}
            <details className="border border-line-2 rounded-lg overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-mono text-fg-2 hover:text-fg bg-ink-2/40 flex items-center gap-2">
                Authenticated scan
                <span className="text-2xs text-fg-mute">(optional)</span>
                <span className="text-2xs text-fg-mute ml-auto">test the logged-in surface →</span>
              </summary>
              <div className="p-4 flex flex-col gap-4 border-t border-line">
                <p className="text-2xs text-fg-mute font-mono leading-relaxed">
                  Give the agent a{" "}
                  <span className="text-fg-2">throwaway test account</span> and it
                  logs in first, then focuses on the authenticated surface (IDOR,
                  broken access control, privilege escalation). Credentials are{" "}
                  <span className="text-fg-2">encrypted at rest</span> and used only
                  against this target. Leave blank for a black-box scan.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Login URL" hint="Where the login form / API is">
                    <Input name="loginUrl" placeholder="https://app.example.com/login" autoComplete="off" />
                  </Field>
                  <Field label="Username / email" hint="The test account">
                    <Input name="username" placeholder="pentest@example.com" autoComplete="off" />
                  </Field>
                  <Field label="Password" hint="Stored encrypted">
                    <Input name="password" type="password" placeholder="••••••••" autoComplete="new-password" />
                  </Field>
                  <Field label="Auth header or cookie" hint="For JWT / API apps">
                    <Input name="authHeader" placeholder="Authorization: Bearer eyJ…" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Auth notes" hint="Anything the agent needs to log in / stay authenticated">
                  <Textarea
                    name="authNotes"
                    placeholder="e.g. token is stored in localStorage as 'jwt'; MFA is disabled for this test account."
                  />
                </Field>
              </div>
            </details>

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
