"use client";

import { useState, useTransition } from "react";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateWorkspace } from "@/lib/actions/workspace";

export function WorkspaceProfileForm({
  tenant,
}: {
  tenant: { name: string; slug: string; industry: string; country: string };
}) {
  const [name, setName] = useState(tenant.name);
  const [industry, setIndustry] = useState(tenant.industry);
  const [country, setCountry] = useState(tenant.country);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <Panel>
      <PanelHeader
        eyebrow="workspace"
        title={
          <>
            Organization <span className="em-sm">profile</span>
          </>
        }
      />
      <form
        className="p-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          start(async () => {
            const r = await updateWorkspace({ name, industry, country });
            setMsg({ ok: r.ok, text: r.message });
          });
        }}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Workspace name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Workspace URL" hint="Used in your workspace address — contact us to change it.">
            <Input value={tenant.slug} readOnly disabled className="opacity-60" />
          </Field>
          <Field label="Industry" hint="Appears on report headers.">
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              maxLength={80}
              placeholder="e.g. Fintech"
            />
          </Field>
          <Field label="Country" hint="Optional.">
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              maxLength={80}
              placeholder="e.g. Morocco"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="solid" size="md" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {msg && (
            <span className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}
