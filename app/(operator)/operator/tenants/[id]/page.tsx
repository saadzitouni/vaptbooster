import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { Badge, ScanStatusBadge } from "@/components/ui/Badge";
import type { ScanStatus } from "@/lib/mock-data";
import { requireOperator } from "@/lib/session";
import { getOperatorTenantDetail, ROOT_DOMAIN } from "@/lib/queries";
import { OperatorScopePanel } from "@/components/operator/OperatorScopePanel";
import { ProvisionKeyButton } from "@/components/operator/ProvisionKeyButton";
import { MessageTenantForm } from "@/components/operator/MessageTenantForm";
import { PlanManager } from "@/components/operator/PlanManager";
import { timeAgo } from "@/lib/utils";

export default async function OperatorTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOperator();
  const { id } = await params;
  const detail = await getOperatorTenantDetail(id);
  if (!detail) notFound();
  const { tenant, targets, users, scans, usage } = detail;

  return (
    <>
      <div className="mb-6">
        <Link href="/operator/tenants" className="text-2xs text-fg-mute font-mono hover:text-fg">
          ← all tenants
        </Link>
      </div>

      <PageHeader
        eyebrow="operator · tenant"
        title={
          <>
            {tenant.name}
          </>
        }
        lede={
          <>
            <span className="font-mono">{tenant.slug}.{ROOT_DOMAIN}</span> ·{" "}
            {tenant.plan} plan
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Plan" value={tenant.plan} emphasis="serif" />
        <Stat
          label="LiteLLM key"
          value={tenant.hasKey ? "provisioned" : "missing"}
          tone={tenant.hasKey ? "ok" : "warn"}
        />
        <Stat
          label="Scans used"
          value={`${usage.used}/${usage.included}`}
          tone={usage.atLimit ? "crit" : "default"}
          emphasis="serif"
        />
        <Stat label="Spend · period" value={`$${(tenant.spendUsdCents / 100).toFixed(2)}`} emphasis="serif" />
      </div>

      {!tenant.hasKey && (
        <Panel className="px-5 py-4 mb-8">
          <p className="text-2xs font-mono text-warn mb-3">
            ⚠ No LiteLLM key — scans can&apos;t run for this tenant until one is provisioned
            (mints a metered virtual key on the gateway with this tenant&apos;s budget).
          </p>
          <ProvisionKeyButton tenantId={tenant.id} />
        </Panel>
      )}

      {/* Plan & quota */}
      <div className="mb-8">
        <PlanManager
          tenantId={tenant.id}
          plan={usage.plan}
          used={usage.used}
          included={usage.included}
          resetsAt={usage.resetsAt}
        />
      </div>

      {/* Message the tenant */}
      <div className="mb-8">
        <MessageTenantForm tenantId={tenant.id} />
      </div>

      {/* Scope + verification */}
      <div className="mb-10">
        <div className="eyebrow mb-4">engagement scope — verify = authorization to test</div>
        <OperatorScopePanel tenantId={tenant.id} targets={targets} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Users */}
        <Panel>
          <PanelHeader eyebrow={`${users.length} users`} title={<>Members</>} />
          <ul>
            {users.map((u) => (
              <li key={u.id} className="px-5 py-3 border-t border-line first:border-t-0 flex items-center justify-between gap-3">
                <span className="font-mono text-[13px] truncate">{u.email}</span>
                <Badge tone="mute">{u.role}</Badge>
              </li>
            ))}
            {users.length === 0 && <li className="px-5 py-4 text-fg-mute text-sm">No users.</li>}
          </ul>
        </Panel>

        {/* Recent scans */}
        <Panel>
          <PanelHeader eyebrow="recent scans" title={<>Activity</>} />
          <ul>
            {scans.map((s) => (
              <li key={s.id} className="px-5 py-3 border-t border-line first:border-t-0 flex items-center justify-between gap-3">
                <span className="font-mono text-[13px] truncate text-fg-2">
                  {s.targetValue}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs text-fg-mute font-mono">{timeAgo(s.requestedAt)}</span>
                  <ScanStatusBadge status={s.status as ScanStatus} />
                </div>
              </li>
            ))}
            {scans.length === 0 && <li className="px-5 py-4 text-fg-mute text-sm">No scans yet.</li>}
          </ul>
        </Panel>
      </div>
    </>
  );
}
