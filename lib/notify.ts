import { withOperator } from "@/lib/db";

export type NotifyInput = {
  userId: string;
  tenantId?: string | null;
  type: string; // scan_completed | scan_failed | finding_critical | scan_approved | scan_rejected | message
  title: string;
  body?: string | null;
  link?: string | null;
};

// Create notifications for one or more recipients. Runs in operator context
// (system/operator writes across tenants). No-op on empty input.
export async function notifyUsers(inputs: NotifyInput[]): Promise<void> {
  if (!inputs.length) return;
  await withOperator((db) =>
    db.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        tenantId: i.tenantId ?? null,
        type: i.type,
        title: i.title,
        body: i.body ?? null,
        link: i.link ?? null,
      })),
    })
  );
}
