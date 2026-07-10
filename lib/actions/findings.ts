"use server";

import { revalidatePath } from "next/cache";
import type { FindingStatus, Severity } from "@prisma/client";
import { withTenant, withOperator } from "@/lib/db";
import { requireTenantId, requireOperator } from "@/lib/session";
import type { AiTriage } from "@/lib/queries";

const STATUSES = ["open", "triaged", "fixed", "wontfix", "duplicate"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

// -------------------------------------------------------------
// Tenant: change a finding's status (RLS-scoped).
// -------------------------------------------------------------
export async function updateFindingStatus(findingId: string, status: string) {
  const tenantId = await requireTenantId();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Invalid finding status.");
  }
  await withTenant(tenantId, async (db) => {
    await db.finding.update({
      where: { id: findingId },
      data: {
        status: status as FindingStatus,
        ...(status === "fixed" ? { fixedAt: new Date() } : {}),
      },
    });
  });
  revalidatePath("/findings");
  revalidatePath("/dashboard");
}

// -------------------------------------------------------------
// Operator: cross-tenant triage (withOperator bypasses RLS by design).
// -------------------------------------------------------------
function opRevalidate(findingId: string) {
  revalidatePath(`/operator/findings/${findingId}`);
  revalidatePath("/operator/findings");
}

export async function operatorUpdateFindingStatus(findingId: string, status: string) {
  await requireOperator();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Invalid finding status.");
  }
  await withOperator((db) =>
    db.finding.update({
      where: { id: findingId },
      data: {
        status: status as FindingStatus,
        ...(status === "fixed" ? { fixedAt: new Date() } : {}),
      },
    })
  );
  opRevalidate(findingId);
}

export async function operatorSetSeverity(findingId: string, severity: string) {
  await requireOperator();
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
    throw new Error("Invalid severity.");
  }
  await withOperator((db) =>
    db.finding.update({ where: { id: findingId }, data: { severity: severity as Severity } })
  );
  opRevalidate(findingId);
}

// Confirm a finding as reproduced by a senior operator (the trust signal
// tenants see: "verified by …").
export async function operatorConfirmFinding(findingId: string) {
  const op = await requireOperator();
  const who = op.name ?? op.email ?? "operator";
  await withOperator((db) =>
    db.finding.update({
      where: { id: findingId },
      data: { reproducedBy: who, reproducedAt: new Date(), status: "triaged" as FindingStatus },
    })
  );
  opRevalidate(findingId);
}

export async function operatorUpdateRemediation(findingId: string, remediation: string) {
  await requireOperator();
  await withOperator((db) =>
    db.finding.update({
      where: { id: findingId },
      data: { remediation: remediation.slice(0, 20000) || null },
    })
  );
  opRevalidate(findingId);
}

// -------------------------------------------------------------
// AI triage assistant — an LLM reasons over the finding + the scan's captured
// evidence and returns a verdict. Runs through the LiteLLM gateway (same as the
// rest of the platform). Result is cached on the finding (aiTriage) so the
// console doesn't re-bill on every view.
// -------------------------------------------------------------
const TRIAGE_SYSTEM = `You are a senior application-security engineer triaging an AI-produced penetration-test finding. Decide whether it is a real, exploitable vulnerability based ONLY on the evidence provided — never assume facts not present. Be rigorous and skeptical: separate confirmed issues from unproven ones, and flag likely false positives.

Respond with ONLY a JSON object (no prose, no markdown fences), exactly these keys:
{
  "verdict": "true_positive" | "likely" | "false_positive",
  "confidence": "high" | "medium" | "low",
  "severityAssessment": "one sentence on whether the reported severity is accurate",
  "suggestedSeverity": "critical" | "high" | "medium" | "low" | "info",
  "exploitability": "who can exploit this and the concrete impact",
  "howToConfirm": "one concrete manual step to independently confirm it",
  "remediation": "the specific fix",
  "recommendedAction": "confirm" | "downgrade" | "duplicate" | "dismiss",
  "rationale": "2-3 sentences justifying the verdict, grounded in the evidence"
}`;

export async function analyzeFinding(
  findingId: string
): Promise<{ ok: boolean; message: string; triage?: AiTriage }> {
  await requireOperator();
  const BASE = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
  const KEY = process.env.LITELLM_MASTER_KEY;
  if (!KEY) {
    return { ok: false, message: "LITELLM_MASTER_KEY not set — AI triage is unavailable." };
  }

  const f = await withOperator((db) =>
    db.finding.findUnique({
      where: { id: findingId },
      include: { scan: { select: { targetValue: true, agentLog: true } } },
    })
  );
  if (!f) return { ok: false, message: "Finding not found." };

  const evidence = JSON.stringify(
    (f.scan as { agentLog?: unknown } | null)?.agentLog ?? []
  ).slice(0, 6000);
  const userPrompt = `Finding under review:
- Title: ${f.title}
- Reported severity: ${f.severity}
- CWE: ${f.cwe ?? "—"}
- Location: ${f.location}
- Target: ${(f.scan as { targetValue?: string } | null)?.targetValue ?? ""}

Agent's evidence / summary:
${f.summary}

Scan activity log (truncated):
${evidence}`;

  let content = "";
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "vaptbooster-default",
        messages: [
          { role: "system", content: TRIAGE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `LLM gateway ${res.status}: ${(await res.text()).slice(0, 160)}` };
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    content = j.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach the LLM gateway: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Parse the JSON object out of the response (tolerate stray prose/fences).
  let triage: AiTriage;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    triage = match ? (JSON.parse(match[0]) as AiTriage) : { rationale: content.slice(0, 2000) };
  } catch {
    triage = { rationale: content.slice(0, 2000) };
  }
  triage.model = "vaptbooster-default";
  triage.analyzedAt = new Date().toISOString();

  await withOperator((db) =>
    db.finding.update({ where: { id: findingId }, data: { aiTriage: triage as object } })
  );

  opRevalidate(findingId);
  return { ok: true, message: "Analysis complete.", triage };
}
