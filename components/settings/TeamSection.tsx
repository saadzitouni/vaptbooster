"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Field, Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { inviteMember, revokeInvite, removeMember } from "@/lib/actions/workspace";
import { timeAgo } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastLogin: string | null;
  joinedAt: string;
  isYou: boolean;
};
type Invite = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

export function TeamSection({
  members,
  invites,
}: {
  members: Member[];
  invites: Invite[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sendInvite = () => {
    setMsg(null);
    setLink(null);
    setCopied(false);
    start(async () => {
      const r = await inviteMember(email);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && r.path) {
        setLink(`${window.location.origin}${r.path}`);
        setEmail("");
        router.refresh();
      }
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow={`${members.length} member${members.length === 1 ? "" : "s"}`}
        title={
          <>
            Team <span className="em-sm">members</span>
          </>
        }
      />

      {/* Members */}
      <ul>
        {members.map((m) => (
          <li
            key={m.id}
            className="px-5 py-4 border-t border-line first:border-t-0 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium flex items-center gap-2">
                <span className="truncate">{m.name || m.email}</span>
                {m.isYou && <Badge tone="mute">you</Badge>}
                {m.role !== "member" && <Badge tone="ok">{m.role}</Badge>}
              </div>
              <div className="text-2xs text-fg-mute font-mono mt-1 truncate">
                {m.email}
                {" · "}
                {m.lastLogin ? `active ${timeAgo(m.lastLogin)}` : "never signed in"}
              </div>
            </div>
            {!m.isYou && <RemoveMember id={m.id} onDone={() => router.refresh()} />}
          </li>
        ))}
      </ul>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="border-t border-line">
          <div className="px-5 pt-4 pb-1 eyebrow">pending invites</div>
          <ul>
            {invites.map((i) => (
              <li
                key={i.id}
                className="px-5 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-mono truncate">{i.email}</div>
                  <div className="text-2xs text-fg-mute font-mono mt-0.5">
                    {i.expired ? (
                      <span className="text-warn">expired</span>
                    ) : (
                      `invited ${timeAgo(i.createdAt)}`
                    )}
                  </div>
                </div>
                <RevokeInvite id={i.id} onDone={() => router.refresh()} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invite form */}
      <div className="border-t border-line p-5 flex flex-col gap-4">
        <Field label="Invite a teammate" hint="Creates a one-time link you share — no email is sent.">
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendInvite();
                }
              }}
            />
            <Button
              type="button"
              variant="solid"
              size="md"
              disabled={pending || !email}
              onClick={sendInvite}
              className="shrink-0"
            >
              {pending ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </Field>

        {msg && (
          <span className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>
            {msg.text}
          </span>
        )}

        {link && (
          <div className="flex gap-2 items-center">
            <Input value={link} readOnly className="text-[12px]" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="line" size="md" onClick={copy} className="shrink-0">
              {copied ? "Copied ✓" : "Copy link"}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RemoveMember({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} className="shrink-0 text-fg-mute">
        Remove
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2 shrink-0">
      {err && <span className="text-2xs font-mono text-crit">{err}</span>}
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await removeMember(id);
            if (r.ok) onDone();
            else {
              setErr(r.message);
              setConfirming(false);
            }
          })
        }
      >
        {pending ? "…" : "Confirm"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}

function RevokeInvite({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="shrink-0 text-fg-mute"
      onClick={() =>
        start(async () => {
          await revokeInvite(id);
          onDone();
        })
      }
    >
      {pending ? "…" : "Revoke"}
    </Button>
  );
}
