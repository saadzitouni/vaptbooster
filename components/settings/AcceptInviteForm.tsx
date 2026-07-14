"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { acceptInvite } from "@/lib/actions/workspace";

export function AcceptInviteForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ok font-mono">Account created ✓</p>
        <p className="text-[13px] text-fg-2">You can sign in with your email and new password.</p>
        <Link href="/login">
          <Button variant="solid" size="md" className="w-full justify-center">
            Go to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (password !== confirm) {
          setErr("Passwords don't match.");
          return;
        }
        start(async () => {
          const r = await acceptInvite({ token, name, password });
          if (r.ok) setDone(true);
          else setErr(r.message);
        });
      }}
    >
      <Field label="Your name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
      </Field>
      <Field label="Password" required hint="At least 10 characters.">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Confirm password" required>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      {err && <span className="text-2xs font-mono text-crit">{err}</span>}
      <Button type="submit" variant="solid" size="md" disabled={pending} className="w-full justify-center">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
