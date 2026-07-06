-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('operator', 'admin', 'member');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('url', 'domain', 'ip', 'repo');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('draft', 'pending_approval', 'queued', 'running', 'reviewing', 'completed', 'failed', 'cancelled', 'paused_ceiling');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'triaged', 'fixed', 'wontfix', 'duplicate');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('solo', 'team', 'enterprise');

-- CreateEnum
CREATE TYPE "SkillAltitude" AS ENUM ('atomic', 'tactical', 'strategic');

-- CreateEnum
CREATE TYPE "AggressivenessLevel" AS ENUM ('conservative', 'standard', 'aggressive');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "litellmKeyId" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLogin" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tenantId" TEXT,
    "invitedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_targets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ScopeType" NOT NULL,
    "value" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifyMethod" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'pending_approval',
    "notes" TEXT,
    "requesterId" TEXT,
    "approverId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "spentUsdCents" INTEGER NOT NULL DEFAULT 0,
    "ceilingUsdCents" INTEGER NOT NULL DEFAULT 2500,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'open',
    "cwe" TEXT,
    "location" TEXT NOT NULL,
    "reproducedBy" TEXT,
    "reproducedAt" TIMESTAMP(3),
    "evidenceUrl" TEXT,
    "remediation" TEXT,
    "fixedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scanId" TEXT,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsdCents" INTEGER NOT NULL,
    "providerLatencyMs" INTEGER,
    "providerRequestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_budgets" (
    "tenantId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'solo',
    "monthlyCreditsIncluded" INTEGER NOT NULL DEFAULT 10,
    "monthlyHardCeilingUsdCents" INTEGER NOT NULL DEFAULT 50000,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "creditsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "spendThisPeriodUsdCents" INTEGER NOT NULL DEFAULT 0,
    "creditsRolledOver" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_budgets_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "altitude" "SkillAltitude" NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_versions" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggers" TEXT NOT NULL,
    "antiTriggers" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "classifyPrompt" TEXT,
    "payloadSets" JSONB NOT NULL DEFAULT '{}',
    "severityMap" JSONB NOT NULL DEFAULT '{}',
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "modelChoice" TEXT NOT NULL DEFAULT 'vaptbooster-default',
    "maxCostUsdCents" INTEGER NOT NULL DEFAULT 50,
    "safety" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "defaultCeilingUsdCents" INTEGER NOT NULL DEFAULT 2500,
    "stepConcurrency" INTEGER NOT NULL DEFAULT 1,
    "maxReconDepth" INTEGER NOT NULL DEFAULT 3,
    "maxChainDepth" INTEGER NOT NULL DEFAULT 4,
    "aggressivenessLevel" "AggressivenessLevel" NOT NULL DEFAULT 'standard',
    "stopOnFirstCritical" BOOLEAN NOT NULL DEFAULT false,
    "defaultFastModel" TEXT NOT NULL DEFAULT 'vaptbooster-fast',
    "defaultStandardModel" TEXT NOT NULL DEFAULT 'vaptbooster-default',
    "defaultDeepModel" TEXT NOT NULL DEFAULT 'vaptbooster-deep',
    "plannerSystemPrompt" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_audit_logs" (
    "id" TEXT NOT NULL,
    "skillId" TEXT,
    "versionId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "diff" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_litellmKeyId_key" ON "tenants"("litellmKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

-- CreateIndex
CREATE INDEX "invites_tenantId_idx" ON "invites"("tenantId");

-- CreateIndex
CREATE INDEX "invites_email_idx" ON "invites"("email");

-- CreateIndex
CREATE INDEX "scope_targets_tenantId_idx" ON "scope_targets"("tenantId");

-- CreateIndex
CREATE INDEX "scans_tenantId_idx" ON "scans"("tenantId");

-- CreateIndex
CREATE INDEX "scans_status_idx" ON "scans"("status");

-- CreateIndex
CREATE INDEX "scans_requestedAt_idx" ON "scans"("requestedAt");

-- CreateIndex
CREATE INDEX "findings_tenantId_idx" ON "findings"("tenantId");

-- CreateIndex
CREATE INDEX "findings_scanId_idx" ON "findings"("scanId");

-- CreateIndex
CREATE INDEX "findings_severity_status_idx" ON "findings"("severity", "status");

-- CreateIndex
CREATE INDEX "reports_tenantId_idx" ON "reports"("tenantId");

-- CreateIndex
CREATE INDEX "usage_records_tenantId_occurredAt_idx" ON "usage_records"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "usage_records_scanId_idx" ON "usage_records"("scanId");

-- CreateIndex
CREATE INDEX "usage_records_operation_idx" ON "usage_records"("operation");

-- CreateIndex
CREATE UNIQUE INDEX "skills_key_key" ON "skills"("key");

-- CreateIndex
CREATE UNIQUE INDEX "skills_currentVersionId_key" ON "skills"("currentVersionId");

-- CreateIndex
CREATE INDEX "skills_altitude_idx" ON "skills"("altitude");

-- CreateIndex
CREATE INDEX "skills_category_idx" ON "skills"("category");

-- CreateIndex
CREATE INDEX "skill_versions_skillId_idx" ON "skill_versions"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_versions_skillId_versionNumber_key" ON "skill_versions"("skillId", "versionNumber");

-- CreateIndex
CREATE INDEX "skill_audit_logs_skillId_idx" ON "skill_audit_logs"("skillId");

-- CreateIndex
CREATE INDEX "skill_audit_logs_actorId_idx" ON "skill_audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "skill_audit_logs_createdAt_idx" ON "skill_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_targets" ADD CONSTRAINT "scope_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "scope_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_budgets" ADD CONSTRAINT "tenant_budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

