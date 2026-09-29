"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { addOpenRouterKey, deleteOpenRouterKey } from "@/lib/actions/openrouter-keys";
import type { OpenRouterKeyRow } from "@/lib/openrouter-keys";

export function OpenRouterKeysManager({ keys: allKeys, aliasCount }: { keys: OpenRouterKeyRow[]; aliasCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  // Hide deleted keys right away even if the gateway read behind the refresh is stale.
  const [deleted, setDeleted] = useState<string[]>([]);
  const keys = allKeys.filter((k) => !deleted.includes(k.id));

  function run(fn: () => Promise<{ ok: boolean; message: string }>, onOk?: () => void) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        onOk?.();
        router.refresh();
      }
    });
  }

  function onDelete(k: OpenRouterKeyRow) {
    const last = keys.length === 1 ? "\n\nThis is the last UI key — scans will fall back to the OPENROUTER_API_KEY env key." : "";
    if (!confirm(`Delete "${k.label}" (…${k.last4})?${last}`)) return;
    run(() => deleteOpenRouterKey(k.id), () => setDeleted((d) => [...d, k.id]));
  }

  return (
    <div className="space-y-6">
      <div className="bg-ink border border-line rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium">OpenRouter keys</h3>
          <span className="text-2xs font-mono text-fg-mute">
            {keys.length} active · env key = fallback
          </span>
        </div>
        {keys.length === 0 ? (
          <div className="px-5 py-6 text-[13px] text-fg-2">
            No keys added here yet — all LLM calls use the <span className="font-mono">OPENROUTER_API_KEY</span> env key.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-fg truncate">{k.label}</div>
                  <div className="text-2xs font-mono text-fg-mute">
                    sk-or-…{k.last4} · added {k.createdAt ? new Date(k.createdAt).toLocaleDateString("en-GB") : "?"}
                    {k.createdBy && <> by {k.createdBy}</>}
                  </div>
                </div>
                {k.aliases.length < aliasCount && (
                  <span className="text-2xs font-mono text-crit">
                    partial ({k.aliases.length}/{aliasCount} models) — delete &amp; re-add
                  </span>
                )}
                <Button variant="danger" size="sm" disabled={pending} onClick={() => onDelete(k)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="bg-ink border border-line rounded-lg p-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addOpenRouterKey(label, apiKey), () => {
            setLabel("");
            setApiKey("");
          });
        }}
      >
        <h3 className="text-[13px] font-medium">Add a key</h3>
        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <Field label="Label" hint="e.g. primary, backup-account">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="primary" />
          </Field>
          <Field label="API key" required>
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-v1-…"
              required
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="solid" size="sm" disabled={pending || !apiKey.trim()}>
            {pending ? "Working…" : "Verify & add"}
          </Button>
          <p className="text-2xs text-fg-mute">
            The key is checked with OpenRouter, then stored encrypted in the LiteLLM gateway — never shown again.
          </p>
        </div>
      </form>

      {msg && <div className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>{msg.text}</div>}
    </div>
  );
}
