import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireTenantId } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { getTenantScope } from "@/lib/queries";
import { ScheduleManager } from "@/components/scans/ScheduleManager";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const tenantId = await requireTenantId();

  const [scope, schedules] = await Promise.all([
    getTenantScope(tenantId),
    withTenant(tenantId, (db) =>
      db.scanSchedule.findMany({ orderBy: { createdAt: "desc" } })
    ),
  ]);
  const verified = scope.filter((s) => s.verifiedAt);

  // Only the fields the client needs (never the encrypted credentials blob).
  const rows = schedules.map((s) => ({
    id: s.id,
    targetValue: s.targetValue,
    frequency: s.frequency as "daily" | "weekly" | "monthly",
    hour: s.hour,
    minute: s.minute,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    timezone: s.timezone,
    active: s.active,
    hasCredentials: !!s.credentials,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastScanId: s.lastScanId,
  }));

  return (
    <>
      <div className="mb-6">
        <Link href="/scans" className="text-2xs text-fg-mute font-mono hover:text-fg">
          ← all scans
        </Link>
      </div>

      <PageHeader
        eyebrow="tenant · scans"
        title={
          <>
            Scan <span className="em">schedules</span>
          </>
        }
        lede="Run a scan automatically on a recurring cadence — daily, weekly, or monthly at a time you choose. Each run counts against your plan quota."
      />

      <ScheduleManager
        targets={verified.map((t) => ({ id: t.id, value: t.value, type: t.type }))}
        schedules={rows}
      />
    </>
  );
}
