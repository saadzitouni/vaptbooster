"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { withTenant, withOperator, type TxClient } from "@/lib/db";
import { requireTenantUser, requireOperator } from "@/lib/session";
import { enqueueScan } from "@/lib/queue";
import { getPlanUsage } from "@/lib/usage";

const requestScanSchema = z.object({
  targetId: z.string().min(1, "Choose a target in scope."),
  notes: z.string().trim().max(2000, "Notes are too long (max 2000 chars).").optional(),
});

// -------------------------------------------------------------
// Tenant: request a scan (→ pending_approval)
// Only VERIFIED, in-scope targets may be scanned — this is a pentest
// tool, so a scan must never run against a target the tenant hasn't
// proven they own.
// -------------------------------------------------------------
export async function requestScan(formData: FormData) {
  const { userId, tenantId } = await requireTenantUser();
  const parsed = requestScanSchema.safeParse({
    targetId: formData.get("targetId"),
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid scan request.");
  }
  const { targetId, notes } = parsed.data;

  // AUTO_APPROVE_SCANS=true → skip the operator approval step: the scan is
  // queued immediately when the tenant requests it. Scope must still be verified
  // (that's the authorization gate). Leave unset to keep operator approval.
  const autoApprove = process.env.AUTO_APPROVE_SCANS === "true";
  let newScanId = "";

  await withTenant(tenantId, async (db) => {
    const target = await db.scopeTarget.findFirst({ where: { id: targetId } });
    if (!target) throw new Error("Target not found in your scope.");
    if (!target.verifiedAt) {
      throw new Error(
        "This target is not verified. Verify ownership under Scope before scanning it."
      );
    }

    // Plan quota — hard block once the tenant has used all their scans this
    // billing period. (Operators bypass: they don't go through requestScan.)
    const usage = await getPlanUsage(db, tenantId);
    if (usage.atLimit) {
      throw new Error(
        `Scan limit reached — ${usage.used}/${usage.included} scans used on the ${usage.planLabel} plan this period. Resets ${new Date(
          usage.resetsAt
        ).toLocaleDateString("en-GB")}. Contact us to raise your plan.`
      );
    }

    const scan = await db.scan.create({
      data: {
        tenantId,
        targetId: target.id,
        targetValue: target.value,
        status: autoApprove ? "queued" : "pending_approval",
        requesterId: userId,
        approverId: autoApprove ? userId : null,
        approvedAt: autoApprove ? new Date() : null,
        notes: notes || null,
      },
    });
    newScanId = scan.id;
  });

  // Enqueue immediately when auto-approving; revert to pending on enqueue failure.
  if (autoApprove && newScanId) {
    try {
      await enqueueScan(newScanId, tenantId);
    } catch {
      await withTenant(tenantId, (db) =>
        db.scan.update({
          where: { id: newScanId },
          data: { status: "pending_approval", approverId: null, approvedAt: null },
        })
      );
    }
  }

  revalidatePath("/scans");
  revalidatePath("/dashboard");
  // The operator's approval queue must reflect this request immediately,
  // not just the tenant's own views.
  revalidatePath("/operator");
  revalidatePath("/operator/queue");
  redirect("/scans");
}

// -------------------------------------------------------------
// Operator: approve → queued + enqueue for the worker.
// Enqueue and the status flip must not diverge: if the enqueue
// fails, revert to pending_approval so the scan isn't stranded.
// -------------------------------------------------------------
export async function approveScan(scanId: string) {
  const op = await requireOperator();

  const tenantId = await withOperator(async (db) => {
    const scan = await db.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new Error("Scan not found.");
    if (scan.status !== "pending_approval")
      throw new Error(`Scan is not awaiting approval (status: ${scan.status}).`);
    await db.scan.update({
      where: { id: scanId },
      data: { status: "queued", approverId: op.id, approvedAt: new Date() },
    });
    return scan.tenantId;
  });

  try {
    await enqueueScan(scanId, tenantId);
  } catch (err) {
    // Roll the status back so the scan can be re-approved rather than
    // being stranded in `queued` with no job behind it.
    await withOperator((db) =>
      db.scan.update({
        where: { id: scanId },
        data: { status: "pending_approval", approverId: null, approvedAt: null },
      })
    );
    throw new Error(
      "Approved, but the scan could not be queued (is Redis running?). Please try again."
    );
  }

  revalidatePath("/operator");
  revalidatePath("/operator/queue");
  revalidatePath("/scans");
}

// -------------------------------------------------------------
// Operator: reject → cancelled
// -------------------------------------------------------------
export async function rejectScan(scanId: string) {
  const op = await requireOperator();
  await withOperator(async (db) => {
    const scan = await db.scan.findUnique({ where: { id: scanId } });
    if (!scan) throw new Error("Scan not found.");
    await db.scan.update({
      where: { id: scanId },
      data: { status: "cancelled", approverId: op.id },
    });
  });
  revalidatePath("/operator");
  revalidatePath("/operator/queue");
}

// -------------------------------------------------------------
// Resume a failed/paused autonomous scan from its saved checkpoint, so the
// client isn't re-billed for work already done. Operator or the owning tenant.
// Only autonomous-mode scans have a checkpoint (agentState); the deterministic
// pipeline is cheap and simply re-runs.
// -------------------------------------------------------------
export async function resumeScan(
  scanId: string
): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, message: "Not authenticated." };
  const isOperator = session.user.role === "operator";
  const tenantId = session.user.tenantId ?? "";
  if (!isOperator && !tenantId) return { ok: false, message: "Not authorized." };

  const run = <T>(fn: (db: TxClient) => Promise<T>) =>
    isOperator ? withOperator(fn) : withTenant(tenantId, fn);

  const RESUMABLE = ["failed", "paused_ceiling", "cancelled"];
  let targetTenantId = "";
  try {
    await run(async (db) => {
      const scan = await db.scan.findFirst({
        where: { id: scanId },
        select: { id: true, status: true, tenantId: true, agentState: true },
      });
      if (!scan) throw new Error("Scan not found.");
      if (!RESUMABLE.includes(scan.status as string)) {
        throw new Error(
          `Scan is ${scan.status} — only failed or paused scans can be resumed.`
        );
      }
      const st = scan.agentState as { messages?: unknown[] } | null;
      if (!st || !Array.isArray(st.messages) || st.messages.length === 0) {
        throw new Error(
          "No checkpoint to resume from — this scan has no saved agent state."
        );
      }
      await db.scan.update({
        where: { id: scanId },
        data: { status: "queued", currentStep: "queued for resume" },
      });
      targetTenantId = scan.tenantId;
    });
    await enqueueScan(scanId, targetTenantId, { resume: true });
  } catch (err) {
    // If we flipped to queued but couldn't enqueue, don't strand it.
    if (targetTenantId) {
      await run((db) =>
        db.scan.update({ where: { id: scanId }, data: { status: "failed" } })
      ).catch(() => {});
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not resume the scan.",
    };
  }
  revalidatePath(`/scans/${scanId}`);
  revalidatePath("/scans");
  revalidatePath("/operator/queue");
  return { ok: true, message: "Resuming from the last checkpoint…" };
}
