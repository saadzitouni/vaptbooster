// =============================================================
// Seed script — populates a realistic dev dataset.
// Run:   DATABASE_URL=<owner-url> npx tsx prisma/seed.ts
//
// Idempotent: wipes tenant-scoped data + skills first, then recreates.
// Runs as the DB owner (superuser) so RLS does not block cross-tenant writes.
// =============================================================

import {
  PrismaClient,
  ScanStatus,
  Severity,
  FindingStatus,
  PlanTier,
  UserRole,
  ScopeType,
  SkillAltitude,
  AggressivenessLevel,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { MOCK_SKILLS, MOCK_AGENT_CONFIG } from "../lib/mock-skills";

const prisma = new PrismaClient();

const OPERATOR_PASSWORD = process.env.SEED_OPERATOR_PASSWORD ?? "operator123";
const MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD ?? "member123";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);

async function wipe() {
  await prisma.usageRecord.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.report.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.scopeTarget.deleteMany();
  await prisma.skillAuditLog.deleteMany();
  await prisma.skill.updateMany({ data: { currentVersionId: null } });
  await prisma.skillVersion.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.agentConfig.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.tenantBudget.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
}

async function main() {
  console.log("Seeding…");
  await wipe();

  const operatorHash = await bcrypt.hash(OPERATOR_PASSWORD, 10);
  const memberHash = await bcrypt.hash(MEMBER_PASSWORD, 10);

  // ---- Operator ----
  const operator = await prisma.user.create({
    data: {
      email: "saad@pwntrol.com",
      name: "Saad Zitouni",
      role: UserRole.operator,
      passwordHash: operatorHash,
    },
  });

  // ---- Tenants (+ budgets) ----
  type TenantSpec = {
    slug: string;
    name: string;
    industry: string;
    country: string;
    plan: PlanTier;
    credits: number;
    creditsUsed: number;
    createdDaysAgo: number;
    lastActivityHrsAgo: number;
  };
  const tenantSpecs: TenantSpec[] = [
    { slug: "acme", name: "ACME Corp", industry: "Fintech", country: "UAE", plan: PlanTier.team, credits: 50, creditsUsed: 32, createdDaysAgo: 81, lastActivityHrsAgo: 4 },
    { slug: "northwind", name: "Northwind Banque", industry: "Banking", country: "DZ", plan: PlanTier.team, credits: 50, creditsUsed: 28, createdDaysAgo: 100, lastActivityHrsAgo: 15 },
    { slug: "horizon", name: "Horizon SaaS", industry: "Technology", country: "SA", plan: PlanTier.solo, credits: 10, creditsUsed: 9, createdDaysAgo: 60, lastActivityHrsAgo: 6 },
    { slug: "atlas", name: "Atlas Retail", industry: "E-commerce", country: "DZ", plan: PlanTier.solo, credits: 10, creditsUsed: 3, createdDaysAgo: 43, lastActivityHrsAgo: 96 },
  ];

  const tenants: Record<string, { id: string }> = {};
  for (const t of tenantSpecs) {
    const created = await prisma.tenant.create({
      data: {
        slug: t.slug,
        name: t.name,
        industry: t.industry,
        country: t.country,
        createdAt: ago(t.createdDaysAgo * DAY),
        budget: {
          create: {
            plan: t.plan,
            monthlyCreditsIncluded: t.credits,
            creditsUsedThisPeriod: t.creditsUsed,
            monthlyHardCeilingUsdCents: t.plan === PlanTier.team ? 100000 : 30000,
            currentPeriodStart: ago(20 * DAY),
          },
        },
      },
    });
    tenants[t.slug] = { id: created.id };
  }

  // ---- Members (one+ per tenant) ----
  const maya = await prisma.user.create({
    data: { email: "maya@acme.example", name: "Maya Choudhury", role: UserRole.member, tenantId: tenants.acme.id, passwordHash: memberHash, lastLogin: ago(4 * HOUR) },
  });
  const adam = await prisma.user.create({
    data: { email: "adam@acme.example", name: "Adam Vere", role: UserRole.member, tenantId: tenants.acme.id, passwordHash: memberHash },
  });
  const nora = await prisma.user.create({
    data: { email: "nora@northwind.example", name: "Nora Belkacem", role: UserRole.member, tenantId: tenants.northwind.id, passwordHash: memberHash },
  });
  const hugo = await prisma.user.create({
    data: { email: "hugo@horizon.example", name: "Hugo Park", role: UserRole.member, tenantId: tenants.horizon.id, passwordHash: memberHash },
  });
  const aya = await prisma.user.create({
    data: { email: "aya@atlas.example", name: "Aya Rahmani", role: UserRole.member, tenantId: tenants.atlas.id, passwordHash: memberHash },
  });

  // ---- Scope targets ----
  async function scope(tenantId: string, type: ScopeType, value: string, verified: boolean, daysAgo: number) {
    return prisma.scopeTarget.create({
      data: {
        tenantId,
        type,
        value,
        verifiedAt: verified ? ago(daysAgo * DAY - HOUR) : null,
        verifyMethod: verified ? "dns-txt" : null,
        addedAt: ago(daysAgo * DAY),
      },
    });
  }
  const acmeApp = await scope(tenants.acme.id, ScopeType.url, "https://app.acme.example", true, 78);
  const acmeApi = await scope(tenants.acme.id, ScopeType.url, "https://api.acme.example", true, 78);
  const acmeStaging = await scope(tenants.acme.id, ScopeType.domain, "*.staging.acme.example", true, 60);
  await scope(tenants.acme.id, ScopeType.ip, "203.0.113.10/29", false, 5);

  const nwApp = await scope(tenants.northwind.id, ScopeType.url, "https://online.northwind.example", true, 95);
  const nwApi = await scope(tenants.northwind.id, ScopeType.url, "https://api.northwind.example", true, 95);
  await scope(tenants.northwind.id, ScopeType.domain, "*.northwind.example", true, 90);

  const hzApp = await scope(tenants.horizon.id, ScopeType.url, "https://app.horizon.example", true, 55);
  await scope(tenants.horizon.id, ScopeType.domain, "*.horizon.example", true, 55);

  const atApp = await scope(tenants.atlas.id, ScopeType.url, "https://shop.atlas.example", true, 40);

  // ---- Scans ----
  type ScanSpec = {
    tenantId: string;
    target: { id: string; value: string };
    status: ScanStatus;
    requester: { id: string };
    requestedDaysAgo: number;
    startedHrsAgo?: number;
    completedHrsAgo?: number;
    progress?: number;
    currentStep?: string | null;
    notes?: string;
    spentUsdCents?: number;
  };
  const scanSpecs: ScanSpec[] = [
    // ACME
    { tenantId: tenants.acme.id, target: acmeApp, status: ScanStatus.running, requester: maya, requestedDaysAgo: 1, startedHrsAgo: 5, progress: 62, currentStep: "exploit: Chaining SSRF → IAM enumeration", notes: "Skip /admin/billing — production data.", spentUsdCents: 1180 },
    { tenantId: tenants.acme.id, target: acmeApi, status: ScanStatus.pending_approval, requester: maya, requestedDaysAgo: 0, notes: "Quarterly check before audit." },
    { tenantId: tenants.acme.id, target: acmeStaging, status: ScanStatus.completed, requester: adam, requestedDaysAgo: 9, startedHrsAgo: 9 * 24, completedHrsAgo: 8 * 24, progress: 100, spentUsdCents: 1420 },
    { tenantId: tenants.acme.id, target: acmeApp, status: ScanStatus.completed, requester: maya, requestedDaysAgo: 16, startedHrsAgo: 16 * 24, completedHrsAgo: 15 * 24, progress: 100, spentUsdCents: 1980 },
    { tenantId: tenants.acme.id, target: acmeApi, status: ScanStatus.failed, requester: maya, requestedDaysAgo: 21, startedHrsAgo: 21 * 24, completedHrsAgo: 21 * 24, progress: 14 },
    // NORTHWIND
    { tenantId: tenants.northwind.id, target: nwApp, status: ScanStatus.completed, requester: nora, requestedDaysAgo: 3, startedHrsAgo: 3 * 24, completedHrsAgo: 2 * 24 - 4, progress: 100, spentUsdCents: 860 },
    { tenantId: tenants.northwind.id, target: nwApi, status: ScanStatus.running, requester: nora, requestedDaysAgo: 0, startedHrsAgo: 2, progress: 34, currentStep: "recon: enumerating API surface" },
    // HORIZON
    { tenantId: tenants.horizon.id, target: hzApp, status: ScanStatus.paused_ceiling, requester: hugo, requestedDaysAgo: 1, startedHrsAgo: 6, progress: 48, currentStep: "cost_ceiling_hit", notes: "Deep scan — watch the budget.", spentUsdCents: 2600 },
    // ATLAS
    { tenantId: tenants.atlas.id, target: atApp, status: ScanStatus.completed, requester: aya, requestedDaysAgo: 6, startedHrsAgo: 6 * 24, completedHrsAgo: 5 * 24, progress: 100, spentUsdCents: 540 },
  ];

  const scans: Record<string, string> = {};
  let scanIdx = 0;
  for (const s of scanSpecs) {
    const created = await prisma.scan.create({
      data: {
        tenantId: s.tenantId,
        targetId: s.target.id,
        targetValue: s.target.value,
        status: s.status,
        requesterId: s.requester.id,
        approverId: s.status === ScanStatus.pending_approval ? null : operator.id,
        requestedAt: ago(s.requestedDaysAgo * DAY),
        approvedAt: s.status === ScanStatus.pending_approval ? null : ago(s.requestedDaysAgo * DAY - HOUR),
        startedAt: s.startedHrsAgo != null ? ago(s.startedHrsAgo * HOUR) : null,
        completedAt: s.completedHrsAgo != null ? ago(s.completedHrsAgo * HOUR) : null,
        progress: s.progress ?? 0,
        currentStep: s.currentStep ?? null,
        notes: s.notes,
        spentUsdCents: s.spentUsdCents ?? 0,
      },
    });
    scans[`s${scanIdx++}`] = created.id;
  }

  // ---- Findings ----
  async function finding(tenantId: string, scanId: string, f: {
    title: string; summary: string; severity: Severity; status: FindingStatus;
    cwe?: string; location: string; reproducedBy?: string; discoveredHrsAgo: number;
  }) {
    return prisma.finding.create({
      data: {
        tenantId, scanId,
        title: f.title, summary: f.summary, severity: f.severity, status: f.status,
        cwe: f.cwe, location: f.location,
        reproducedBy: f.reproducedBy,
        reproducedAt: f.reproducedBy ? ago(f.discoveredHrsAgo * HOUR - 600000) : null,
        discoveredAt: ago(f.discoveredHrsAgo * HOUR),
      },
    });
  }

  // ACME running scan (s0)
  await finding(tenants.acme.id, scans.s0, { title: "Server-Side Request Forgery in /api/v2/proxy", summary: "The proxy endpoint accepts arbitrary user-controlled URLs. Chained with IAM creds endpoint to retrieve temporary tokens.", severity: Severity.critical, status: FindingStatus.open, cwe: "CWE-918", location: "POST /api/v2/proxy", reproducedBy: "S. Zitouni", discoveredHrsAgo: 4 });
  await finding(tenants.acme.id, scans.s0, { title: "Outdated jQuery (1.7.2) — multiple known XSS", summary: "jQuery 1.7.2 has multiple known DOM XSS issues. Upgrade path to 3.x straightforward.", severity: Severity.high, status: FindingStatus.triaged, cwe: "CWE-1104", location: "GET /static/js/vendor.min.js", discoveredHrsAgo: 5 });
  await finding(tenants.acme.id, scans.s0, { title: "Blind boolean SQL injection in /search?q=", summary: "Time-based blind SQLi confirmed via WAITFOR delay. Parameterize the query, or use prepared statements.", severity: Severity.high, status: FindingStatus.open, cwe: "CWE-89", location: "GET /search", reproducedBy: "S. Zitouni", discoveredHrsAgo: 4 });
  await finding(tenants.acme.id, scans.s0, { title: "Missing X-Frame-Options on all routes", summary: "Clickjacking exposure on every endpoint. Add CSP frame-ancestors or X-Frame-Options: DENY.", severity: Severity.medium, status: FindingStatus.open, cwe: "CWE-1021", location: "All routes", discoveredHrsAgo: 5 });
  await finding(tenants.acme.id, scans.s0, { title: "TLS 1.0/1.1 still negotiable", summary: "Server still accepts TLS 1.0 and 1.1. Disable both in nginx config.", severity: Severity.medium, status: FindingStatus.open, location: ":443", discoveredHrsAgo: 5 });
  await finding(tenants.acme.id, scans.s0, { title: "Open redirect via /r?url=", summary: "Whitelist allowed destinations.", severity: Severity.low, status: FindingStatus.open, cwe: "CWE-601", location: "GET /r", discoveredHrsAgo: 5 });
  // ACME completed scan (s3) — historical, fixed
  await finding(tenants.acme.id, scans.s3, { title: "Insecure direct object reference in /invoices/:id", summary: "Any authenticated user can read any invoice by ID. Fixed in PR #4112.", severity: Severity.critical, status: FindingStatus.fixed, cwe: "CWE-639", location: "GET /invoices/:id", reproducedBy: "S. Zitouni", discoveredHrsAgo: 15 * 24 });
  // NORTHWIND completed (s5)
  await finding(tenants.northwind.id, scans.s5, { title: "Session cookie missing Secure + HttpOnly", summary: "Session cookie can be read by JS and sent over HTTP. Add Secure, HttpOnly, SameSite=Lax.", severity: Severity.high, status: FindingStatus.open, cwe: "CWE-614", location: "Set-Cookie: SESSIONID", discoveredHrsAgo: 2 * 24 });
  await finding(tenants.northwind.id, scans.s5, { title: "Verbose error stack traces exposed", summary: "500 responses leak framework + query info.", severity: Severity.medium, status: FindingStatus.triaged, cwe: "CWE-209", location: "GET /api/accounts", discoveredHrsAgo: 2 * 24 });
  // HORIZON paused (s7)
  await finding(tenants.horizon.id, scans.s7, { title: "GraphQL introspection enabled in production", summary: "Full schema disclosed via introspection. Disable in prod.", severity: Severity.medium, status: FindingStatus.open, cwe: "CWE-200", location: "POST /graphql", discoveredHrsAgo: 6 });
  await finding(tenants.horizon.id, scans.s7, { title: "Reflected XSS in ?redirect param", summary: "Unencoded reflection of the redirect parameter into the page.", severity: Severity.high, status: FindingStatus.open, cwe: "CWE-79", location: "GET /login", reproducedBy: "S. Zitouni", discoveredHrsAgo: 6 });
  // ATLAS completed (s8)
  await finding(tenants.atlas.id, scans.s8, { title: "Rate limiting absent on login", summary: "No throttling on POST /login — credential stuffing possible.", severity: Severity.medium, status: FindingStatus.open, cwe: "CWE-307", location: "POST /login", discoveredHrsAgo: 5 * 24 });

  // ---- Usage records (spread over 14 days; totals drive the margin story) ----
  const usageTargets: Record<string, { total: number; scanId: string | null }> = {
    [tenants.acme.id]: { total: 28400, scanId: scans.s0 },
    [tenants.northwind.id]: { total: 19200, scanId: scans.s5 },
    [tenants.horizon.id]: { total: 38200, scanId: scans.s7 }, // bleeding: high cost on a solo plan
    [tenants.atlas.id]: { total: 6800, scanId: scans.s8 },
  };
  const OPS = ["recon", "fuzz", "exploit", "validate", "report"] as const;
  const MODELS = ["vaptbooster-fast", "vaptbooster-default", "vaptbooster-deep"];
  for (const [tenantId, spec] of Object.entries(usageTargets)) {
    const days = 14;
    const base = Math.round(spec.total / days);
    for (let d = 0; d < days; d++) {
      const jitter = Math.round(base * 0.25 * Math.sin(d * 1.7));
      const cents = Math.max(1, base + jitter);
      await prisma.usageRecord.create({
        data: {
          tenantId,
          scanId: d < 3 ? spec.scanId ?? undefined : undefined,
          operation: OPS[d % OPS.length],
          model: MODELS[d % MODELS.length],
          promptTokens: 8000 + d * 220,
          completionTokens: 1200 + d * 45,
          cachedTokens: 400 + d * 30,
          costUsdCents: cents,
          providerLatencyMs: 1500 + d * 60,
          occurredAt: ago(d * DAY + (d * 137) * 1000),
        },
      });
    }
  }

  // ---- Skills + current versions ----
  for (const s of MOCK_SKILLS) {
    const v = s.currentVersion;
    const skill = await prisma.skill.create({
      data: {
        key: s.key,
        altitude: s.altitude as SkillAltitude,
        category: s.category,
        enabled: s.enabled,
      },
    });
    const version = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        versionNumber: 1,
        name: v.name,
        description: v.description,
        triggers: v.triggers,
        antiTriggers: v.antiTriggers,
        systemPrompt: v.systemPrompt,
        classifyPrompt: v.classifyPrompt,
        payloadSets: v.payloadSets as object,
        severityMap: v.severityMap as object,
        confidenceThreshold: v.confidenceThreshold,
        modelChoice: v.modelChoice,
        maxCostUsdCents: v.maxCostUsdCents,
        safety: v.safety as object,
        createdById: operator.id,
        publishedAt: ago(3 * DAY),
      },
    });
    await prisma.skill.update({
      where: { id: skill.id },
      data: { currentVersionId: version.id },
    });
  }

  // ---- Agent config (singleton) ----
  const c = MOCK_AGENT_CONFIG;
  await prisma.agentConfig.create({
    data: {
      id: "global",
      defaultCeilingUsdCents: c.defaultCeilingUsdCents,
      stepConcurrency: c.stepConcurrency,
      maxReconDepth: c.maxReconDepth,
      maxChainDepth: c.maxChainDepth,
      aggressivenessLevel: c.aggressivenessLevel as AggressivenessLevel,
      stopOnFirstCritical: c.stopOnFirstCritical,
      defaultFastModel: c.defaultFastModel,
      defaultStandardModel: c.defaultStandardModel,
      defaultDeepModel: c.defaultDeepModel,
      plannerSystemPrompt: c.plannerSystemPrompt,
      updatedById: operator.id,
    },
  });

  const counts = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    scopeTargets: await prisma.scopeTarget.count(),
    scans: await prisma.scan.count(),
    findings: await prisma.finding.count(),
    usageRecords: await prisma.usageRecord.count(),
    skills: await prisma.skill.count(),
  };
  console.log("✓ Seeded:", counts);
  console.log("");
  console.log("  Login credentials (dev):");
  console.log(`    operator → saad@pwntrol.com  / ${OPERATOR_PASSWORD}`);
  console.log(`    member   → maya@acme.example / ${MEMBER_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
