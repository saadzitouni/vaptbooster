"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { AggressivenessLevel } from "@prisma/client";
import { withOperator } from "@/lib/db";
import { requireOperator } from "@/lib/session";

// -------------------------------------------------------------
// Enable / disable a skill
// -------------------------------------------------------------
export async function setSkillEnabled(key: string, enabled: boolean) {
  const op = await requireOperator();
  await withOperator(async (db) => {
    const skill = await db.skill.findUnique({ where: { key } });
    if (!skill) throw new Error("Skill not found.");
    await db.skill.update({ where: { key }, data: { enabled } });
    await db.skillAuditLog.create({
      data: {
        skillId: skill.id,
        action: enabled ? "enabled" : "disabled",
        actorId: op.id,
      },
    });
  });
  revalidatePath("/operator/skills");
  revalidatePath(`/operator/skills/${key}`);
}

// -------------------------------------------------------------
// Publish a new skill version (immutable version + repoint current)
// -------------------------------------------------------------
export type SkillVersionInput = {
  name: string;
  description: string;
  triggers: string;
  antiTriggers: string;
  systemPrompt: string;
  classifyPrompt: string;
  payloadJson: string; // raw JSON text from the editor
  modelChoice: string;
  maxCostUsdCents: number;
  confidenceThreshold: number;
  enabled: boolean;
  reason: string;
};

const skillVersionSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  description: z.string().max(4000),
  triggers: z.string().max(8000),
  antiTriggers: z.string().max(8000),
  systemPrompt: z.string().max(20000),
  classifyPrompt: z.string().max(8000),
  payloadJson: z.string().max(65536, "Payload sets too large (max 64 KB)."),
  modelChoice: z.string().max(50),
  maxCostUsdCents: z.number().int().min(0).max(1_000_000),
  confidenceThreshold: z.number().min(0).max(1),
  enabled: z.boolean(),
  reason: z.string().trim().min(1, "A commit message is required.").max(500),
});

export async function publishSkillVersion(key: string, input: SkillVersionInput) {
  const op = await requireOperator();
  const parsed = skillVersionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid skill version.");
  }
  const d = parsed.data;

  let payloadSets: unknown;
  try {
    payloadSets = d.payloadJson.trim() ? JSON.parse(d.payloadJson) : {};
  } catch {
    throw new Error("Payload sets is not valid JSON.");
  }

  await withOperator(async (db) => {
    const skill = await db.skill.findUnique({
      where: { key },
      include: { currentVersion: true },
    });
    if (!skill) throw new Error("Skill not found.");

    const nextNumber = (skill.currentVersion?.versionNumber ?? 0) + 1;

    const version = await db.skillVersion.create({
      data: {
        skillId: skill.id,
        versionNumber: nextNumber,
        name: d.name,
        description: d.description,
        triggers: d.triggers,
        antiTriggers: d.antiTriggers,
        systemPrompt: d.systemPrompt,
        classifyPrompt: d.classifyPrompt || null,
        payloadSets: payloadSets as object,
        severityMap: (skill.currentVersion?.severityMap ?? {}) as object,
        confidenceThreshold: d.confidenceThreshold,
        modelChoice: d.modelChoice,
        maxCostUsdCents: d.maxCostUsdCents,
        safety: (skill.currentVersion?.safety ?? {}) as object,
        createdById: op.id,
        publishedAt: new Date(),
      },
    });

    await db.skill.update({
      where: { id: skill.id },
      data: { enabled: d.enabled, currentVersionId: version.id },
    });

    await db.skillAuditLog.create({
      data: {
        skillId: skill.id,
        versionId: version.id,
        action: "published",
        actorId: op.id,
        reason: d.reason,
      },
    });
  });

  revalidatePath("/operator/skills");
  revalidatePath(`/operator/skills/${key}`);
}

// -------------------------------------------------------------
// Save the global agent config
// -------------------------------------------------------------
export type AgentConfigInput = {
  defaultCeilingUsdCents: number;
  stepConcurrency: number;
  maxReconDepth: number;
  maxChainDepth: number;
  aggressivenessLevel: string;
  stopOnFirstCritical: boolean;
  defaultFastModel: string;
  defaultStandardModel: string;
  defaultDeepModel: string;
  plannerSystemPrompt: string;
  reason: string;
};

const agentConfigSchema = z.object({
  defaultCeilingUsdCents: z.number().int().min(0).max(10_000_000),
  stepConcurrency: z.number().int().min(1).max(8),
  maxReconDepth: z.number().int().min(1).max(6),
  maxChainDepth: z.number().int().min(1).max(8),
  aggressivenessLevel: z.enum(["conservative", "standard", "aggressive"]),
  stopOnFirstCritical: z.boolean(),
  defaultFastModel: z.string().min(1).max(100),
  defaultStandardModel: z.string().min(1).max(100),
  defaultDeepModel: z.string().min(1).max(100),
  plannerSystemPrompt: z.string().max(20000),
  reason: z.string().max(500),
});

export async function saveAgentConfig(input: AgentConfigInput) {
  const op = await requireOperator();
  const parsed = agentConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid agent config.");
  }
  const d = parsed.data;

  await withOperator(async (db) => {
    const data = {
      defaultCeilingUsdCents: d.defaultCeilingUsdCents,
      stepConcurrency: d.stepConcurrency,
      maxReconDepth: d.maxReconDepth,
      maxChainDepth: d.maxChainDepth,
      aggressivenessLevel: d.aggressivenessLevel as AggressivenessLevel,
      stopOnFirstCritical: d.stopOnFirstCritical,
      defaultFastModel: d.defaultFastModel,
      defaultStandardModel: d.defaultStandardModel,
      defaultDeepModel: d.defaultDeepModel,
      plannerSystemPrompt: d.plannerSystemPrompt,
      updatedById: op.id,
    };
    await db.agentConfig.upsert({
      where: { id: "global" },
      update: data,
      create: { id: "global", ...data },
    });
  });
  revalidatePath("/operator/agent-config");
}
