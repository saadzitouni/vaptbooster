"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenantUser } from "@/lib/session";
import { computeNextRunAt, isValidTimezone, type Frequency } from "@/lib/schedule";
import { encryptScanCreds, hasAnyCred, type ScanCreds } from "@/lib/scan-credentials";

const scheduleSchema = z
  .object({
    targetId: z.string().min(1, "Choose a target in scope."),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    hour: z.coerce.number().int().min(0).max(23),
    minute: z.coerce.number().int().min(0).max(59),
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
    timezone: z.string().trim().min(1).max(64).refine(isValidTimezone, "Unknown timezone."),
    notes: z.string().trim().max(2000).optional(),
    loginUrl: z.string().trim().max(500).optional(),
    username: z.string().trim().max(200).optional(),
    password: z.string().max(300).optional(),
    authHeader: z.string().trim().max(4000).optional(),
    authNotes: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.frequency !== "weekly" || d.dayOfWeek !== undefined, {
    message: "Pick a day of the week.",
    path: ["dayOfWeek"],
  })
  .refine((d) => d.frequency !== "monthly" || d.dayOfMonth !== undefined, {
    message: "Pick a day of the month (1–28).",
    path: ["dayOfMonth"],
  });

export async function createSchedule(formData: FormData) {
  const { userId, tenantId } = await requireTenantUser();
  const parsed = scheduleSchema.safeParse({
    targetId: formData.get("targetId"),
    frequency: formData.get("frequency"),
    hour: formData.get("hour"),
    minute: formData.get("minute"),
    dayOfWeek: formData.get("dayOfWeek") || undefined,
    dayOfMonth: formData.get("dayOfMonth") || undefined,
    timezone: formData.get("timezone"),
    notes: formData.get("notes") || undefined,
    loginUrl: formData.get("loginUrl") || undefined,
    username: formData.get("username") || undefined,
    password: formData.get("password") || undefined,
    authHeader: formData.get("authHeader") || undefined,
    authNotes: formData.get("authNotes") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid schedule.");
  }
  const d = parsed.data;
  const frequency = d.frequency as Frequency;
  const dayOfWeek = frequency === "weekly" ? (d.dayOfWeek ?? 0) : null;
  const dayOfMonth = frequency === "monthly" ? (d.dayOfMonth ?? 1) : null;

  const creds: ScanCreds = {
    loginUrl: d.loginUrl || undefined,
    username: d.username || undefined,
    password: d.password || undefined,
    authHeader: d.authHeader || undefined,
    notes: d.authNotes || undefined,
  };
  const credentials = hasAnyCred(creds) ? encryptScanCreds(creds) : null;

  const nextRunAt = computeNextRunAt({
    frequency,
    hour: d.hour,
    minute: d.minute,
    dayOfWeek,
    dayOfMonth,
    timezone: d.timezone,
  });

  await withTenant(tenantId, async (db) => {
    const target = await db.scopeTarget.findFirst({ where: { id: d.targetId } });
    if (!target) throw new Error("Target not found in your scope.");
    if (!target.verifiedAt) {
      throw new Error("This target is not verified. Verify ownership under Assets first.");
    }
    await db.scanSchedule.create({
      data: {
        tenantId,
        targetId: target.id,
        targetValue: target.value,
        frequency,
        hour: d.hour,
        minute: d.minute,
        dayOfWeek,
        dayOfMonth,
        timezone: d.timezone,
        notes: d.notes || null,
        credentials,
        nextRunAt,
        createdById: userId,
      },
    });
  });

  revalidatePath("/scans/schedules");
}

export async function setScheduleActive(scheduleId: string, active: boolean) {
  const { tenantId } = await requireTenantUser();
  await withTenant(tenantId, async (db) => {
    const sched = await db.scanSchedule.findFirst({ where: { id: scheduleId } });
    if (!sched) throw new Error("Schedule not found.");
    // Re-activating: recompute the next run from now so it doesn't fire for a
    // time that passed while it was paused.
    const data: { active: boolean; nextRunAt?: Date } = { active };
    if (active && !sched.active) {
      data.nextRunAt = computeNextRunAt({
        frequency: sched.frequency as Frequency,
        hour: sched.hour,
        minute: sched.minute,
        dayOfWeek: sched.dayOfWeek,
        dayOfMonth: sched.dayOfMonth,
        timezone: sched.timezone,
      });
    }
    await db.scanSchedule.update({ where: { id: scheduleId }, data });
  });
  revalidatePath("/scans/schedules");
  return { ok: true };
}

export async function deleteSchedule(scheduleId: string) {
  const { tenantId } = await requireTenantUser();
  await withTenant(tenantId, async (db) => {
    // RLS already scopes this, but delete by id+tenant for defence in depth.
    await db.scanSchedule.deleteMany({ where: { id: scheduleId, tenantId } });
  });
  revalidatePath("/scans/schedules");
  return { ok: true };
}
