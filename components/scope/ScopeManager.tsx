"use client";

import { useActionState, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import {
  addScopeTarget,
  verifyScopeTarget,
  removeScopeTarget,
} from "@/lib/actions/scope";

export type ScopeRow = {
  id: string;
  type: string;
  value: string;
  verifiedAt: string | null;
  addedAt: string;
  txtRecord: string; // precomputed server-side (never exposes the secret)
};

const TYPE_HINT: Record<string, string> = {
  url: "https://app.example.com",
  domain: "example.com",
  ip: "203.0.113.10  or  203.0.113.0/24",
  repo: "https://github.com/org/repo",
};

export function ScopeManager({ targets }: { targets: ScopeRow[] }) {
  const [state, formAction, pending] = useActionState(addScopeTarget, null);
  const [type, setType] = useState("url");

  return (
    <div className="flex flex-col gap-8">
      {/* Add target */}
      <Panel className="p-6">
        <div className="eyebrow mb-4">add an asset</div>
        <form action={formAction} className="flex flex-col gap-4 max-w-2xl">
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field label="Type" required>
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-ink-2 border border-line-2 rounded px-3.5 py-2.5 font-mono text-[14px] text-fg focus:outline-none focus:border-fg"
              >
                <option value="url">URL</option>
                <option value="domain">Domain</option>
                <option value="ip">IP / CIDR</option>
                <option value="repo">Repo</option>
              </select>
            </Field>
            <Field label="Value" required>
              <Input name="value" placeholder={TYPE_HINT[type]} required autoComplete="off" />
            </Field>
          </div>

          {state && (
            <div
              className={`rounded px-3.5 py-2.5 text-2xs font-mono border ${
                state.ok ? "border-ok/40 text-ok" : "border-crit/40 text-crit"
              }`}
            >
              {state.message}
            </div>
          )}

          <div>
            <Button type="submit" variant="solid" size="md" disabled={pending}>
              {pending ? "Adding…" : "Add asset"}
            </Button>
          </div>
        </form>
      </Panel>

      {/* Targets */}
      <div>
        <div className="eyebrow mb-4">your assets ({targets.length})</div>
        {targets.length === 0 ? (
          <Panel className="px-6 py-12">
            <p className="text-center text-fg-2 text-[14px]">
              No assets yet. Add one above, then verify ownership to make it scannable.
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-3">
            {targets.map((t) => (
              <TargetRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TargetRow({ t }: { t: ScopeRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const verified = !!t.verifiedAt;
  const host = t.value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const dnsCapable = t.type === "url" || t.type === "domain";

  function onVerify() {
    setResult(null);
    start(async () => setResult(await verifyScopeTarget(t.id)));
  }
  function onRemove() {
    if (!confirm(`Remove ${t.value}?`)) return;
    start(async () => {
      const r = await removeScopeTarget(t.id);
      if (!r.ok) setResult(r);
    });
  }
  function copy() {
    navigator.clipboard?.writeText(t.txtRecord).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Panel accent={verified}>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[14px] text-fg truncate">{t.value}</span>
            <Badge tone="mute">{t.type}</Badge>
          </div>
          <div className="text-2xs text-fg-mute font-mono mt-1">
            added {new Date(t.addedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {verified ? (
            <Badge tone="ok">✓ verified</Badge>
          ) : (
            <Badge tone="warn">unverified</Badge>
          )}
          {!verified && dnsCapable && (
            <Button variant="line" size="sm" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Verify"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={pending}>
            Remove
          </Button>
        </div>
      </div>

      {!verified && dnsCapable && open && (
        <div className="border-t border-line px-5 py-5 bg-ink-2/40">
          <p className="text-[13px] text-fg-2 leading-relaxed">
            Prove you control <span className="text-fg font-mono">{host}</span> by adding this
            DNS <span className="text-fg">TXT</span> record, then click Check. Add it at the
            domain root <span className="font-mono text-fg">@</span> or as{" "}
            <span className="font-mono text-fg">_vaptbooster.{host}</span>.
          </p>

          <div className="mt-3 flex items-stretch gap-2">
            <code className="flex-1 bg-ink border border-line-2 rounded px-3 py-2.5 font-mono text-2xs text-fg break-all">
              {t.txtRecord}
            </code>
            <Button variant="line" size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          {result && (
            <div
              className={`mt-3 rounded px-3.5 py-2.5 text-2xs font-mono border ${
                result.ok ? "border-ok/40 text-ok" : "border-crit/40 text-crit"
              }`}
            >
              {result.message}
            </div>
          )}

          <div className="mt-4">
            <Button variant="solid" size="sm" onClick={onVerify} disabled={pending}>
              {pending ? "Checking DNS…" : "Check verification"}
            </Button>
          </div>
        </div>
      )}

      {!verified && !dnsCapable && (
        <div className="border-t border-line px-5 py-3 bg-ink-2/40">
          <p className="text-2xs text-fg-mute font-mono">
            {t.type.toUpperCase()} targets are verified by your operator (out-of-band authorization).
          </p>
        </div>
      )}
    </Panel>
  );
}
