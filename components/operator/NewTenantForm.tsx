"use client";

import { useActionState, useState } from "react";
import { createTenant } from "@/lib/actions/tenants";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

export function NewTenantForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTenant, null);

  return (
    <div>
      <Button variant="solid" size="md" onClick={() => setOpen((o) => !o)}>
        {open ? "Cancel" : "+ New tenant"}
      </Button>

      {open && (
        <Panel className="p-6 mt-4">
          <div className="eyebrow mb-4">// onboard a client tenant</div>
          <form action={action} className="grid gap-4 max-w-2xl">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Company name" required>
                <Input name="name" placeholder="Acme Corp" required autoComplete="off" />
              </Field>
              <Field label="Slug" hint="lowercase, used in the subdomain" required>
                <Input name="slug" placeholder="acme" required autoComplete="off" />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Member email" required>
                <Input name="memberEmail" type="email" placeholder="user@acme.com" required autoComplete="off" />
              </Field>
              <Field label="Member password" hint="10+ chars — share with the client" required>
                <Input name="memberPassword" type="text" placeholder="ClientPass-123" required autoComplete="off" />
              </Field>
            </div>
            <Field label="Plan">
              <select
                name="plan"
                defaultValue="solo"
                className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
              >
                <option value="solo">Solo — 10 credits/mo</option>
                <option value="team">Team — 50 credits/mo</option>
                <option value="enterprise">Enterprise — 200 credits/mo</option>
              </select>
            </Field>

            {state && (
              <div
                className={`rounded px-3.5 py-2.5 text-2xs font-mono border ${
                  state.ok ? "border-ok/40 text-ok" : "border-crit/40 text-crit"
                }`}
              >
                {state.message}
                {state.ok && " → provision its LiteLLM key: scripts/provision-tenant-key.ts <slug>"}
              </div>
            )}

            <div>
              <Button type="submit" variant="solid" size="md" disabled={pending}>
                {pending ? "Creating…" : "Create tenant"}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
