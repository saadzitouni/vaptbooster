"use client";

import { useState, useTransition } from "react";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateProfile, changePassword } from "@/lib/actions/workspace";

type Msg = { ok: boolean; text: string } | null;

export function AccountSection({ me }: { me: { name: string; email: string } }) {
  const [name, setName] = useState(me.name);
  const [nPending, nStart] = useTransition();
  const [nMsg, setNMsg] = useState<Msg>(null);

  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pPending, pStart] = useTransition();
  const [pMsg, setPMsg] = useState<Msg>(null);

  return (
    <Panel>
      <PanelHeader
        eyebrow="your account"
        title={
          <>
            Profile &amp; <span className="em-sm">password</span>
          </>
        }
      />
      <div className="p-5 flex flex-col gap-6">
        {/* Display name */}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setNMsg(null);
            nStart(async () => {
              const r = await updateProfile({ name });
              setNMsg({ ok: r.ok, text: r.message });
            });
          }}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Display name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Email" hint="Sign-in address — contact us to change it.">
              <Input value={me.email} readOnly disabled className="opacity-60" />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="line" size="md" disabled={nPending}>
              {nPending ? "Saving…" : "Save name"}
            </Button>
            {nMsg && (
              <span className={`text-2xs font-mono ${nMsg.ok ? "text-ok" : "text-crit"}`}>
                {nMsg.text}
              </span>
            )}
          </div>
        </form>

        <div className="h-px bg-line" />

        {/* Change password */}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPMsg(null);
            if (next !== confirm) {
              setPMsg({ ok: false, text: "New passwords don't match." });
              return;
            }
            pStart(async () => {
              const r = await changePassword({ current: cur, next });
              setPMsg({ ok: r.ok, text: r.message });
              if (r.ok) {
                setCur("");
                setNext("");
                setConfirm("");
              }
            });
          }}
        >
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Current password" required>
              <Input
                type="password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" required>
              <Input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new" required>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="line" size="md" disabled={pPending}>
              {pPending ? "Updating…" : "Change password"}
            </Button>
            {pMsg && (
              <span className={`text-2xs font-mono ${pMsg.ok ? "text-ok" : "text-crit"}`}>
                {pMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </Panel>
  );
}
