"use client";

import { useActionState, useState } from "react";
import { sendTenantMessage } from "@/lib/actions/notifications";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input, Field, Textarea } from "@/components/ui/Input";

export function MessageTenantForm({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(sendTenantMessage, null);

  return (
    <div>
      <Button variant="line" size="sm" onClick={() => setOpen((o) => !o)}>
        {open ? "Cancel" : "✉ Message tenant"}
      </Button>

      {open && (
        <Panel className="p-5 mt-3">
          <div className="eyebrow mb-3">// send a message to this tenant&apos;s members</div>
          <form action={action} className="flex flex-col gap-3 max-w-xl">
            <input type="hidden" name="tenantId" value={tenantId} />
            <Field label="Subject" required>
              <Input name="title" placeholder="Engagement update" required autoComplete="off" />
            </Field>
            <Field label="Message">
              <Textarea name="body" placeholder="Message the client's members will see in their notifications…" />
            </Field>
            {state && (
              <div className={`rounded px-3.5 py-2.5 text-2xs font-mono border ${state.ok ? "border-ok/40 text-ok" : "border-crit/40 text-crit"}`}>
                {state.message}
              </div>
            )}
            <div>
              <Button type="submit" variant="solid" size="sm" disabled={pending}>
                {pending ? "Sending…" : "Send message"}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
