"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { UserRole } from "@prisma/client";
import { withTenant, withOperator } from "@/lib/db";
import { requireTenantUser } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";

type Result = { ok: boolean; message: string };

const INVITE_TTL_DAYS = 7;

// -------------------------------------------------------------
// Workspace profile — name / industry / country (the tenant row).
// -------------------------------------------------------------
const workspaceSchema = z.object({
  name: z.string().trim().min(2, "Workspace name is too short.").max(80),
  industry: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
});

export async function updateWorkspace(
  input: z.input<typeof workspaceSchema>
): Promise<Result> {
  const { tenantId } = await requireTenantUser();
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  await withTenant(tenantId, (db) =>
    db.tenant.update({
      where: { id: tenantId },
      data: { name: d.name, industry: d.industry || null, country: d.country || null },
    })
  );
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Workspace updated." };
}

// -------------------------------------------------------------
// Your account — display name.
// -------------------------------------------------------------
export async function updateProfile(input: { name: string }): Promise<Result> {
  const { userId, tenantId } = await requireTenantUser();
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (name.length < 1) return { ok: false, message: "Enter your name." };
  await withTenant(tenantId, (db) =>
    db.user.update({ where: { id: userId }, data: { name } })
  );
  revalidatePath("/settings");
  return { ok: true, message: "Name updated (shows everywhere after your next sign-in)." };
}

// -------------------------------------------------------------
// Your account — change password (verify current, then rotate).
// -------------------------------------------------------------
const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password."),
  next: z.string().min(10, "New password must be at least 10 characters.").max(200),
});

export async function changePassword(input: {
  current: string;
  next: string;
}): Promise<Result> {
  const { userId, tenantId } = await requireTenantUser();
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { current, next } = parsed.data;
  const user = await withTenant(tenantId, (db) =>
    db.user.findFirst({ where: { id: userId }, select: { passwordHash: true } })
  );
  if (!user?.passwordHash) {
    return { ok: false, message: "This account has no password set — contact support." };
  }
  if (!(await verifyPassword(current, user.passwordHash))) {
    return { ok: false, message: "Current password is incorrect." };
  }
  if (await verifyPassword(next, user.passwordHash)) {
    return { ok: false, message: "New password must be different from the current one." };
  }
  const hash = await hashPassword(next);
  await withTenant(tenantId, (db) =>
    db.user.update({ where: { id: userId }, data: { passwordHash: hash } })
  );
  return { ok: true, message: "Password changed." };
}

// -------------------------------------------------------------
// Team — invite a member. Returns a shareable accept-link path (no email
// infra needed — the workspace admin shares it). Any prior pending invite for
// the same email is replaced.
// -------------------------------------------------------------
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email.");

export async function inviteMember(
  email: string
): Promise<Result & { path?: string }> {
  const { tenantId } = await requireTenantUser();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid email." };
  }
  const addr = parsed.data;
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
  await withTenant(tenantId, async (db) => {
    await db.invite.deleteMany({ where: { tenantId, email: addr, acceptedAt: null } });
    await db.invite.create({
      data: { email: addr, token, role: UserRole.member, tenantId, expiresAt },
    });
  });
  revalidatePath("/settings");
  return {
    ok: true,
    message: `Invite link ready for ${addr}. Share it — it expires in ${INVITE_TTL_DAYS} days.`,
    path: `/invite/${token}`,
  };
}

// Revoke a pending invite.
export async function revokeInvite(inviteId: string): Promise<Result> {
  const { tenantId } = await requireTenantUser();
  await withTenant(tenantId, (db) =>
    db.invite.deleteMany({ where: { id: inviteId, tenantId, acceptedAt: null } })
  );
  revalidatePath("/settings");
  return { ok: true, message: "Invite revoked." };
}

// Remove a member (not yourself; never the last member).
export async function removeMember(memberId: string): Promise<Result> {
  const { userId, tenantId } = await requireTenantUser();
  if (memberId === userId) {
    return { ok: false, message: "You can't remove yourself." };
  }
  const outcome = await withTenant(tenantId, async (db) => {
    const target = await db.user.findFirst({
      where: { id: memberId, tenantId },
      select: { id: true },
    });
    if (!target) return "not-found";
    const count = await db.user.count({ where: { tenantId } });
    if (count <= 1) return "last";
    await db.user.delete({ where: { id: memberId } });
    return "ok";
  });
  if (outcome === "not-found") return { ok: false, message: "That member isn't in your workspace." };
  if (outcome === "last") return { ok: false, message: "You can't remove the last member." };
  revalidatePath("/settings");
  return { ok: true, message: "Member removed." };
}

// -------------------------------------------------------------
// Accept an invite (UNAUTHENTICATED). The long random token is the
// authorization gate, so this runs with operator privilege to create the user.
// -------------------------------------------------------------
const acceptSchema = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(1, "Enter your name.").max(80),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});

export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<Result> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { token, name, password } = parsed.data;
  const passwordHash = await hashPassword(password);
  try {
    await withOperator(async (db) => {
      const invite = await db.invite.findUnique({ where: { token } });
      if (!invite) throw new Error("This invite link is invalid.");
      if (invite.acceptedAt) throw new Error("This invite has already been used.");
      if (invite.expiresAt.getTime() < Date.now()) throw new Error("This invite has expired.");
      if (!invite.tenantId || invite.role === UserRole.operator) {
        throw new Error("This invite can't be accepted here.");
      }
      const existing = await db.user.findUnique({
        where: { email: invite.email },
        select: { id: true },
      });
      if (existing) {
        throw new Error("An account with this email already exists — sign in instead.");
      }
      await db.user.create({
        data: {
          email: invite.email,
          name,
          passwordHash,
          role: invite.role,
          tenantId: invite.tenantId,
        },
      });
      await db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not accept the invite." };
  }
  return { ok: true, message: "Account created — you can sign in now." };
}
