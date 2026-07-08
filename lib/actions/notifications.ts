"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { withTenant, withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";
import { notifyUsers } from "@/lib/notify";

type Result = { ok: boolean; message: string };

async function currentUser() {
  const s = await auth();
  if (!s?.user) throw new Error("Not authenticated.");
  return { id: s.user.id, role: s.user.role as string, tenantId: (s.user.tenantId ?? null) as string | null };
}

// Mark all of the current user's notifications read.
export async function markAllRead(): Promise<void> {
  const u = await currentUser();
  const where = { userId: u.id, readAt: null };
  const data = { readAt: new Date() };
  if (u.role === "operator") await withOperator((db) => db.notification.updateMany({ where, data }));
  else await withTenant(u.tenantId ?? "", (db) => db.notification.updateMany({ where, data }));
  revalidatePath("/notifications");
}

// Mark a single notification read (on click).
export async function markNotificationRead(id: string): Promise<void> {
  const u = await currentUser();
  const where = { id, userId: u.id };
  const data = { readAt: new Date() };
  if (u.role === "operator") await withOperator((db) => db.notification.updateMany({ where, data }));
  else await withTenant(u.tenantId ?? "", (db) => db.notification.updateMany({ where, data }));
  revalidatePath("/notifications");
}

// Operator → send a message to every member of a tenant (lands in their feed).
const msgSchema = z.object({
  tenantId: z.string().min(1),
  title: z.string().trim().min(1, "Enter a subject.").max(120),
  body: z.string().trim().max(2000).optional(),
});

export async function sendTenantMessage(_prev: Result | null, formData: FormData): Promise<Result> {
  await requireOperator();
  const parsed = msgSchema.safeParse({
    tenantId: formData.get("tenantId"),
    title: formData.get("title"),
    body: formData.get("body") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid message." };
  const { tenantId, title, body } = parsed.data;

  const users = await withOperator((db) => db.user.findMany({ where: { tenantId }, select: { id: true } }));
  if (!users.length) return { ok: false, message: "This tenant has no members to message." };

  await notifyUsers(users.map((u) => ({ userId: u.id, tenantId, type: "message", title, body: body ?? null })));
  revalidatePath(`/operator/tenants/${tenantId}`);
  return { ok: true, message: `Message sent to ${users.length} member${users.length === 1 ? "" : "s"}.` };
}
