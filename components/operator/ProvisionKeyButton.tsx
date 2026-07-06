"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { provisionTenantKey } from "@/lib/actions/litellm";
import { Button } from "@/components/ui/Button";

export function ProvisionKeyButton({ tenantId }: { tenantId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function onClick() {
    setMsg(null);
    start(async () => {
      const r = await provisionTenantKey(tenantId);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="solid" size="sm" onClick={onClick} disabled={pending}>
          {pending ? "Provisioning…" : "Provision LiteLLM key"}
        </Button>
      </div>
      {msg && (
        <div className={`text-2xs font-mono ${msg.ok ? "text-ok" : "text-crit"}`}>{msg.text}</div>
      )}
    </div>
  );
}
