// =============================================================
// Query layer — the ONLY place pages read data from.
//
// Every function runs through withTenant()/withOperator() so RLS
// enforces isolation at the DB. Returns view-model shapes (ISO
// string dates, computed aggregates) matching the former mock types,
// so page components need minimal changes.
// =============================================================

import { withTenant, withOperator } from "@/lib/db";
import type { Tenant, Scan, Finding, Severity } from "@/lib/mock-data";
import type { MockUsageSummary } from "@/lib/mock-usage";
import type { MockSkill, MockAgentConfig, SkillAltitude } from "@/lib/mock-skills";
import {
  normalizeFindings,
  type ReportDoc,
  type ReportListItem,
} from "@/lib/report";
import { getPlanUsage, type PlanUsage } from "@/lib/usage";
import { planPriceCents } from "@/lib/plans";

// -------------------------------------------------------------
// helpers
// -------------------------------------------------------------
function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function countBySeverity(
  findings: { severity: Severity }[]
): Record<Severity, number> {
  const c = emptyCounts();
  for (const f of findings) c[f.severity]++;
  return c;
}

type ScanRow = {
  id: string;
  tenantId: string;
  targetId: string;
  targetValue: string;
  status: string;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  progress: number;
  currentStep: string | null;
  notes: string | null;
  requester: { name: string | null } | null;
  findings: { severity: Severity }[];
};

function mapScan(s: ScanRow): Scan {
  return {
    id: s.id,
    tenantId: s.tenantId,
    targetId: s.targetId,
    targetValue: s.targetValue,
    status: s.status as Scan["status"],
    requestedAt: s.requestedAt.toISOString(),
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    progress: s.progress,
    currentStep: s.currentStep,
    requesterName: s.requester?.name ?? "—",
    notes: s.notes ?? undefined,
    findingCounts: countBySeverity(s.findings),
  };
}

type FindingRow = {
  id: string;
  tenantId: string;
  scanId: string;
  title: string;
  summary: string;
  severity: Severity;
  status: string;
  cwe: string | null;
  location: string;
  reproducedBy: string | null;
  discoveredAt: Date;
};

function mapFinding(f: FindingRow): Finding {
  return {
    id: f.id,
    tenantId: f.tenantId,
    scanId: f.scanId,
    title: f.title,
    summary: f.summary,
    severity: f.severity,
    status: f.status as Finding["status"],
    cwe: f.cwe ?? undefined,
    location: f.location,
    reproducedBy: f.reproducedBy ?? undefined,
    discoveredAt: f.discoveredAt.toISOString(),
  };
}

const SCAN_INCLUDE = {
  requester: { select: { name: true } },
  findings: { select: { severity: true } },
} as const;

// =============================================================
// TENANT-SCOPED (RLS: only this tenant's rows)
// =============================================================

export async function getTenantUsage(tenantId: string): Promise<PlanUsage> {
  return withTenant(tenantId, (db) => getPlanUsage(db, tenantId));
}

export async function getTenantDashboard(tenantId: string) {
  return withTenant(tenantId, async (db) => {
    const [tenant, scopeCount, scanRows, findingRows] = await Promise.all([
      db.tenant.findFirst(),
      db.scopeTarget.count(),
      db.scan.findMany({
        include: SCAN_INCLUDE,
        orderBy: { requestedAt: "desc" },
      }),
      db.finding.findMany({ orderBy: { discoveredAt: "desc" } }),
    ]);

    const usage = await getPlanUsage(db, tenantId);

    return {
      tenant: {
        id: tenant?.id ?? tenantId,
        slug: tenant?.slug ?? "",
        name: tenant?.name ?? "",
        industry: tenant?.industry ?? "",
        country: tenant?.country ?? "",
        scopeCount,
      },
      usage,
      scans: (scanRows as ScanRow[]).map(mapScan),
      findings: (findingRows as FindingRow[]).map(mapFinding),
    };
  });
}

export async function getTenantScans(tenantId: string): Promise<Scan[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.scan.findMany({
      include: SCAN_INCLUDE,
      orderBy: { requestedAt: "desc" },
    });
    return (rows as ScanRow[]).map(mapScan);
  });
}

export async function getTenantScanDetail(tenantId: string, scanId: string) {
  return withTenant(tenantId, async (db) => {
    const scan = await db.scan.findFirst({
      where: { id: scanId },
      include: SCAN_INCLUDE,
    });
    if (!scan) return null;
    const findings = await db.finding.findMany({
      where: { scanId },
      orderBy: [{ severity: "asc" }, { discoveredAt: "desc" }],
    });
    const agentLog =
      ((scan as { agentLog?: unknown }).agentLog as AgentLogEntry[] | null) ?? [];
    // A scan can be resumed only if the autonomous agent left a checkpoint.
    const st = (scan as { agentState?: { messages?: unknown[] } | null }).agentState;
    const resumable = !!(st && Array.isArray(st.messages) && st.messages.length);
    return {
      scan: mapScan(scan as ScanRow),
      findings: (findings as FindingRow[]).map(mapFinding),
      agentLog,
      resumable,
    };
  });
}

export type AgentLogEntry = {
  ts: string;
  actor: "system" | "claude" | "tool";
  level: "info" | "ok" | "warn" | "crit";
  msg: string;
};

export type ScopeTargetView = {
  id: string;
  type: string;
  value: string;
  verifiedAt: string | null;
  addedAt: string;
};

export async function getTenantScope(
  tenantId: string
): Promise<ScopeTargetView[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.scopeTarget.findMany({ orderBy: { addedAt: "desc" } });
    return rows.map((s) => ({
      id: s.id,
      type: s.type,
      value: s.value,
      verifiedAt: s.verifiedAt ? s.verifiedAt.toISOString() : null,
      addedAt: s.addedAt.toISOString(),
    }));
  });
}

export async function getTenantFindings(tenantId: string): Promise<Finding[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.finding.findMany({
      orderBy: { discoveredAt: "desc" },
    });
    return (rows as FindingRow[]).map(mapFinding);
  });
}

// =============================================================
// OPERATOR-SCOPED (RLS bypassed — cross-tenant)
// =============================================================

const ROOT_DOMAIN = "vaptbooster.pwntrol.com";

export type OperatorTenantView = Tenant & {
  plan: string;
  runningScans: number;
};

type OpScan = Scan & { tenantName: string };

export async function getOperatorOverview() {
  return withOperator(async (db) => {
    const [tenants, scanRows, criticalOpen] = await Promise.all([
      db.tenant.findMany({ orderBy: { createdAt: "asc" } }),
      db.scan.findMany({ include: SCAN_INCLUDE, orderBy: { requestedAt: "desc" } }),
      db.finding.findMany({
        where: { severity: "critical", status: "open" },
        select: { tenantId: true },
      }),
    ]);

    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    const critByTenant = new Map<string, number>();
    for (const f of criticalOpen)
      critByTenant.set(f.tenantId, (critByTenant.get(f.tenantId) ?? 0) + 1);

    const lastActivity = new Map<string, number>();
    const scanCountByTenant = new Map<string, number>();
    for (const s of scanRows as ScanRow[]) {
      scanCountByTenant.set(s.tenantId, (scanCountByTenant.get(s.tenantId) ?? 0) + 1);
      const t = s.requestedAt.getTime();
      if (t > (lastActivity.get(s.tenantId) ?? 0)) lastActivity.set(s.tenantId, t);
    }

    const tenantViews: Tenant[] = tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      industry: t.industry ?? "",
      country: t.country ?? "",
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: new Date(
        lastActivity.get(t.id) ?? t.updatedAt.getTime()
      ).toISOString(),
      scopeCount: 0,
      scanCount: scanCountByTenant.get(t.id) ?? 0,
      openCriticals: critByTenant.get(t.id) ?? 0,
    }));

    const withName = (s: ScanRow): OpScan => ({
      ...mapScan(s),
      tenantName: nameById.get(s.tenantId) ?? "—",
    });

    const pending = (scanRows as ScanRow[])
      .filter((s) => s.status === "pending_approval")
      .map(withName);
    const running = (scanRows as ScanRow[])
      .filter((s) => s.status === "running")
      .map(withName);

    return {
      tenants: tenantViews,
      pending,
      running,
      openCriticalsGlobal: criticalOpen.length,
    };
  });
}

export async function getOperatorTenants(): Promise<OperatorTenantView[]> {
  return withOperator(async (db) => {
    const [tenants, scanRows, criticalOpen] = await Promise.all([
      db.tenant.findMany({
        include: {
          budget: true,
          _count: { select: { scopeTargets: true, scans: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.scan.findMany({ select: { tenantId: true, status: true, requestedAt: true } }),
      db.finding.findMany({
        where: { severity: "critical", status: "open" },
        select: { tenantId: true },
      }),
    ]);

    const critByTenant = new Map<string, number>();
    for (const f of criticalOpen)
      critByTenant.set(f.tenantId, (critByTenant.get(f.tenantId) ?? 0) + 1);
    const runningByTenant = new Map<string, number>();
    const lastActivity = new Map<string, number>();
    for (const s of scanRows) {
      if (s.status === "running")
        runningByTenant.set(s.tenantId, (runningByTenant.get(s.tenantId) ?? 0) + 1);
      const t = s.requestedAt.getTime();
      if (t > (lastActivity.get(s.tenantId) ?? 0)) lastActivity.set(s.tenantId, t);
    }

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      industry: t.industry ?? "",
      country: t.country ?? "",
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: new Date(
        lastActivity.get(t.id) ?? t.updatedAt.getTime()
      ).toISOString(),
      scopeCount: t._count.scopeTargets,
      scanCount: t._count.scans,
      openCriticals: critByTenant.get(t.id) ?? 0,
      plan: t.budget?.plan ?? "solo",
      runningScans: runningByTenant.get(t.id) ?? 0,
    }));
  });
}

export type OperatorTargetView = {
  id: string;
  type: string;
  value: string;
  verifiedAt: string | null;
  verifyMethod: string | null;
  addedAt: string;
  scanCount: number;
};

export async function getOperatorTenantDetail(tenantId: string) {
  return withOperator(async (db) => {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { budget: true } });
    if (!tenant) return null;
    const [targets, users, scans] = await Promise.all([
      db.scopeTarget.findMany({
        where: { tenantId },
        orderBy: { addedAt: "desc" },
        include: { _count: { select: { scans: true } } },
      }),
      db.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
      db.scan.findMany({ where: { tenantId }, orderBy: { requestedAt: "desc" }, take: 10 }),
    ]);
    const usage = await getPlanUsage(db, tenantId);
    return {
      usage,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        industry: tenant.industry ?? "",
        country: tenant.country ?? "",
        plan: (tenant.budget?.plan ?? "solo") as string,
        hasKey: !!tenant.litellmKeyId,
        creditsUsed: tenant.budget?.creditsUsedThisPeriod ?? 0,
        creditsIncluded: tenant.budget?.monthlyCreditsIncluded ?? 0,
        spendUsdCents: tenant.budget?.spendThisPeriodUsdCents ?? 0,
      },
      targets: targets.map((t) => ({
        id: t.id,
        type: t.type as string,
        value: t.value,
        verifiedAt: t.verifiedAt ? t.verifiedAt.toISOString() : null,
        verifyMethod: t.verifyMethod ?? null,
        addedAt: t.addedAt.toISOString(),
        scanCount: t._count.scans,
      })) as OperatorTargetView[],
      users: users.map((u) => ({ id: u.id, email: u.email, name: u.name ?? "", role: u.role as string })),
      scans: scans.map((s) => ({
        id: s.id,
        targetValue: s.targetValue,
        status: s.status as string,
        requestedAt: s.requestedAt.toISOString(),
      })),
    };
  });
}

// -------------------------------------------------------------
// Notifications (per recipient user)
// -------------------------------------------------------------
export type NotifUser = { id: string; role: string; tenantId: string | null };
export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function mapNotif(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function getNotifications(user: NotifUser): Promise<{ items: NotificationView[]; unread: number }> {
  // Notifications must NEVER break a page — the bell renders on every layout.
  // If the query fails (e.g. the table isn't migrated yet), degrade to empty.
  try {
    if (user.role === "operator") {
      return await withOperator(async (db) => {
        const [rows, unread] = await Promise.all([
          db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25 }),
          db.notification.count({ where: { userId: user.id, readAt: null } }),
        ]);
        return { items: rows.map(mapNotif), unread };
      });
    }
    return await withTenant(user.tenantId ?? "", async (db) => {
      const [rows, unread] = await Promise.all([
        db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25 }),
        db.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);
      return { items: rows.map(mapNotif), unread };
    });
  } catch {
    return { items: [], unread: 0 };
  }
}

// -------------------------------------------------------------
// Reports (editable engagement deliverables)
// -------------------------------------------------------------
type ReportRow = {
  id: string;
  tenantId: string;
  scanId: string | null;
  createdByRole: string;
  title: string;
  clientName: string;
  clientTagline: string | null;
  engagementRef: string | null;
  preparedBy: string;
  logoDataUrl: string | null;
  executiveSummary: string | null;
  scopeText: string | null;
  methodology: string | null;
  findings: unknown;
  status: string;
  confidential: boolean;
  generatedAt: Date;
  updatedAt: Date;
  tenant?: { name: string } | null;
};

function mapReportDoc(r: ReportRow): ReportDoc {
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenant?.name ?? "",
    scanId: r.scanId,
    createdByRole: r.createdByRole,
    title: r.title,
    clientName: r.clientName,
    clientTagline: r.clientTagline,
    engagementRef: r.engagementRef,
    preparedBy: r.preparedBy,
    logoDataUrl: r.logoDataUrl,
    executiveSummary: r.executiveSummary,
    scopeText: r.scopeText,
    methodology: r.methodology,
    findings: normalizeFindings(r.findings),
    status: r.status,
    confidential: r.confidential,
    generatedAt: r.generatedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// List (light — never selects the logo data URI).
const REPORT_LIST_SELECT = {
  id: true,
  title: true,
  clientName: true,
  status: true,
  findings: true,
  updatedAt: true,
} as const;

export async function getTenantReports(
  tenantId: string
): Promise<ReportListItem[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.report.findMany({
      orderBy: { updatedAt: "desc" },
      select: REPORT_LIST_SELECT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      clientName: r.clientName,
      status: r.status,
      findingCount: normalizeFindings(r.findings).length,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getTenantReport(
  tenantId: string,
  id: string
): Promise<ReportDoc | null> {
  return withTenant(tenantId, async (db) => {
    const r = await db.report.findFirst({
      where: { id },
      include: { tenant: { select: { name: true } } },
    });
    return r ? mapReportDoc(r as ReportRow) : null;
  });
}

export async function getOperatorReports(): Promise<ReportListItem[]> {
  return withOperator(async (db) => {
    const rows = await db.report.findMany({
      orderBy: { updatedAt: "desc" },
      select: { ...REPORT_LIST_SELECT, tenant: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      clientName: r.clientName,
      status: r.status,
      findingCount: normalizeFindings(r.findings).length,
      tenantName: r.tenant?.name ?? "",
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export async function getOperatorReport(id: string): Promise<ReportDoc | null> {
  return withOperator(async (db) => {
    const r = await db.report.findUnique({
      where: { id },
      include: { tenant: { select: { name: true } } },
    });
    return r ? mapReportDoc(r as ReportRow) : null;
  });
}

// Role-aware loader for the shared print route.
export async function getReportForPrint(
  user: NotifUser,
  id: string
): Promise<ReportDoc | null> {
  if (user.role === "operator") return getOperatorReport(id);
  if (!user.tenantId) return null;
  return getTenantReport(user.tenantId, id);
}

// Scans a report can import findings from (only those that produced findings).
export type ImportableScan = {
  id: string;
  targetValue: string;
  status: string;
  completedAt: string | null;
  findingCount: number;
};

function mapImportableScan(s: {
  id: string;
  targetValue: string;
  status: string;
  completedAt: Date | null;
  _count: { findings: number };
}): ImportableScan {
  return {
    id: s.id,
    targetValue: s.targetValue,
    status: s.status as string,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    findingCount: s._count.findings,
  };
}

export async function getTenantImportableScans(
  tenantId: string
): Promise<ImportableScan[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db.scan.findMany({
      orderBy: { requestedAt: "desc" },
      include: { _count: { select: { findings: true } } },
    });
    return rows.filter((s) => s._count.findings > 0).map(mapImportableScan);
  });
}

export async function getOperatorImportableScans(
  tenantId: string
): Promise<ImportableScan[]> {
  return withOperator(async (db) => {
    const rows = await db.scan.findMany({
      where: { tenantId },
      orderBy: { requestedAt: "desc" },
      include: { _count: { select: { findings: true } } },
    });
    return rows.filter((s) => s._count.findings > 0).map(mapImportableScan);
  });
}

// -------------------------------------------------------------
// Operator findings console (cross-tenant) + AI triage
// -------------------------------------------------------------
export type OperatorFindingRow = {
  id: string;
  tenantId: string;
  tenantName: string;
  scanId: string;
  title: string;
  summary: string;
  severity: Severity;
  status: string;
  cwe: string | null;
  location: string;
  discoveredAt: string;
  reproducedBy: string | null;
  hasAiTriage: boolean;
  aiVerdict: string | null;
};

export type AiTriage = {
  verdict?: string; // true_positive | likely | false_positive
  confidence?: string; // high | medium | low
  severityAssessment?: string;
  suggestedSeverity?: string;
  exploitability?: string;
  howToConfirm?: string;
  remediation?: string;
  recommendedAction?: string; // confirm | downgrade | duplicate | dismiss
  rationale?: string;
  model?: string;
  analyzedAt?: string;
};

export async function getOperatorFindings(): Promise<OperatorFindingRow[]> {
  return withOperator(async (db) => {
    const rows = await db.finding.findMany({
      orderBy: [{ discoveredAt: "desc" }],
      include: { tenant: { select: { name: true } } },
    });
    return rows.map((f) => {
      const triage = (f as { aiTriage?: AiTriage | null }).aiTriage ?? null;
      return {
        id: f.id,
        tenantId: f.tenantId,
        tenantName: f.tenant?.name ?? "",
        scanId: f.scanId,
        title: f.title,
        summary: f.summary,
        severity: f.severity as Severity,
        status: f.status as string,
        cwe: f.cwe ?? null,
        location: f.location,
        discoveredAt: f.discoveredAt.toISOString(),
        reproducedBy: f.reproducedBy ?? null,
        hasAiTriage: !!triage,
        aiVerdict: triage?.verdict ?? null,
      };
    });
  });
}

export type OperatorFindingDetail = {
  finding: {
    id: string;
    tenantId: string;
    tenantName: string;
    scanId: string;
    title: string;
    summary: string;
    severity: Severity;
    status: string;
    cwe: string | null;
    location: string;
    remediation: string | null;
    reproducedBy: string | null;
    reproducedAt: string | null;
    discoveredAt: string;
    targetValue: string;
  };
  evidence: AgentLogEntry[];
  aiTriage: AiTriage | null;
};

export async function getOperatorFindingDetail(
  id: string
): Promise<OperatorFindingDetail | null> {
  return withOperator(async (db) => {
    const f = await db.finding.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true } },
        scan: { select: { targetValue: true, agentLog: true } },
      },
    });
    if (!f) return null;
    return {
      finding: {
        id: f.id,
        tenantId: f.tenantId,
        tenantName: f.tenant?.name ?? "",
        scanId: f.scanId,
        title: f.title,
        summary: f.summary,
        severity: f.severity as Severity,
        status: f.status as string,
        cwe: f.cwe ?? null,
        location: f.location,
        remediation: f.remediation ?? null,
        reproducedBy: f.reproducedBy ?? null,
        reproducedAt: f.reproducedAt ? f.reproducedAt.toISOString() : null,
        discoveredAt: f.discoveredAt.toISOString(),
        targetValue: f.scan?.targetValue ?? "",
      },
      evidence:
        ((f.scan as { agentLog?: unknown } | null)?.agentLog as AgentLogEntry[] | null) ?? [],
      aiTriage: (f as { aiTriage?: AiTriage | null }).aiTriage ?? null,
    };
  });
}

export { ROOT_DOMAIN };

// -------------------------------------------------------------
// Usage & cost (operator)
// -------------------------------------------------------------
export async function getOperatorUsage() {
  return withOperator(async (db) => {
    const [tenants, usage, scanRows] = await Promise.all([
      db.tenant.findMany({ include: { budget: true }, orderBy: { createdAt: "asc" } }),
      db.usageRecord.findMany({
        select: { tenantId: true, costUsdCents: true, occurredAt: true },
      }),
      db.scan.findMany({ select: { tenantId: true, requestedAt: true } }),
    ]);

    const dayMs = 24 * 3600 * 1000;
    const nowMs = Date.now();

    // Group usage + scans by tenant once. Period filtering is per-tenant —
    // each tenant's billing period starts at its own currentPeriodStart, so
    // spend/scan totals must be scoped to that window (not all-time) to keep
    // margin correct as history accumulates.
    const usageByTenant = new Map<string, { cost: number; at: number }[]>();
    for (const u of usage) {
      const arr = usageByTenant.get(u.tenantId) ?? [];
      arr.push({ cost: u.costUsdCents, at: u.occurredAt.getTime() });
      usageByTenant.set(u.tenantId, arr);
    }
    const scanAtByTenant = new Map<string, number[]>();
    for (const s of scanRows) {
      const arr = scanAtByTenant.get(s.tenantId) ?? [];
      arr.push(s.requestedAt.getTime());
      scanAtByTenant.set(s.tenantId, arr);
    }

    const summaries: MockUsageSummary[] = tenants.map((t) => {
      const plan = t.budget?.plan ?? "solo";
      const revenue = planPriceCents(plan);
      const periodStart = (
        t.budget?.currentPeriodStart ?? new Date(nowMs - 30 * dayMs)
      ).getTime();

      const tUsage = usageByTenant.get(t.id) ?? [];
      const llmCost = tUsage.reduce((a, u) => (u.at >= periodStart ? a + u.cost : a), 0);
      const llmCost24h = tUsage.reduce((a, u) => (nowMs - u.at < dayMs ? a + u.cost : a), 0);
      const scans = (scanAtByTenant.get(t.id) ?? []).filter((at) => at >= periodStart).length;

      return {
        tenantId: t.id,
        tenantName: t.name,
        plan: plan as MockUsageSummary["plan"],
        monthlyCreditsIncluded: t.budget?.monthlyCreditsIncluded ?? 10,
        creditsUsedThisPeriod: t.budget?.creditsUsedThisPeriod ?? 0,
        spendThisPeriodUsdCents: revenue,
        spendLast24hUsdCents: Math.round(revenue / 30),
        llmCostThisPeriodUsdCents: llmCost,
        llmCostLast24hUsdCents: llmCost24h,
        scansThisPeriod: scans,
        avgCostPerScanUsdCents: Math.round(llmCost / Math.max(scans, 1)),
        margin: revenue > 0 ? (revenue - llmCost) / revenue : 0,
      };
    });

    // 14-day daily trend: llm cost from usage; revenue = flat monthly/30.
    const totalRevenue = summaries.reduce((a, s) => a + s.spendThisPeriodUsdCents, 0);
    const dailyRevenue = Math.round(totalRevenue / 30);
    const buckets = new Map<string, number>();
    for (let d = 13; d >= 0; d--) {
      const key = new Date(nowMs - d * dayMs).toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const u of usage) {
      const key = u.occurredAt.toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + u.costUsdCents);
    }
    const dailyTrend = Array.from(buckets.entries()).map(([date, llmCostCents]) => ({
      date,
      revenueCents: dailyRevenue,
      llmCostCents,
    }));

    return { summaries, dailyTrend };
  });
}

// -------------------------------------------------------------
// Skills + agent config (operator)
// -------------------------------------------------------------
type SkillVersionRow = {
  versionNumber: number;
  name: string;
  description: string;
  triggers: string;
  antiTriggers: string;
  systemPrompt: string;
  classifyPrompt: string | null;
  payloadSets: unknown;
  severityMap: unknown;
  confidenceThreshold: number;
  modelChoice: string;
  maxCostUsdCents: number;
  safety: unknown;
  publishedAt: Date | null;
  createdById: string | null;
};
type SkillRow = {
  id: string;
  key: string;
  altitude: string;
  category: string;
  enabled: boolean;
  currentVersion: SkillVersionRow | null;
  _count: { versions: number };
};

// createdById is a scalar (no relation in the schema), so the creator name
// is resolved separately and passed in.
function mapSkill(s: SkillRow, creatorName: string): MockSkill {
  const v = s.currentVersion;
  return {
    id: s.id,
    key: s.key,
    altitude: s.altitude as SkillAltitude,
    category: s.category,
    enabled: s.enabled,
    currentVersion: {
      versionNumber: v?.versionNumber ?? 1,
      name: v?.name ?? s.key,
      description: v?.description ?? "",
      triggers: v?.triggers ?? "",
      antiTriggers: v?.antiTriggers ?? "",
      systemPrompt: v?.systemPrompt ?? "",
      classifyPrompt: v?.classifyPrompt ?? undefined,
      payloadSets: (v?.payloadSets ?? {}) as Record<string, unknown>,
      severityMap: (v?.severityMap ?? {}) as Record<string, Severity>,
      confidenceThreshold: v?.confidenceThreshold ?? 0.7,
      modelChoice: v?.modelChoice ?? "vaptbooster-default",
      maxCostUsdCents: v?.maxCostUsdCents ?? 0,
      safety: (v?.safety ?? {}) as Record<string, unknown>,
      publishedAt: (v?.publishedAt ?? new Date()).toISOString(),
      createdBy: creatorName,
    },
    totalVersions: s._count.versions,
    // Per-skill metrics are not tracked in the schema yet — surfaced as 0
    // until the real agent pipeline records them (post-Phase-4).
    metrics: { callsLast30d: 0, avgCostUsdCents: 0, avgLatencyMs: 0, falsePositiveRate: 0 },
  };
}

const SKILL_INCLUDE = {
  currentVersion: true,
  _count: { select: { versions: true } },
} as const;

export async function getSkillCatalog(): Promise<MockSkill[]> {
  return withOperator(async (db) => {
    const [rows, users] = await Promise.all([
      db.skill.findMany({ include: SKILL_INCLUDE, orderBy: { key: "asc" } }),
      db.user.findMany({ select: { id: true, name: true } }),
    ]);
    const nameById = new Map(users.map((u) => [u.id, u.name ?? "—"]));
    return (rows as unknown as SkillRow[]).map((s) =>
      mapSkill(
        s,
        s.currentVersion?.createdById
          ? nameById.get(s.currentVersion.createdById) ?? "—"
          : "—"
      )
    );
  });
}

export async function getSkillByKey(key: string): Promise<MockSkill | null> {
  return withOperator(async (db) => {
    const row = await db.skill.findUnique({ where: { key }, include: SKILL_INCLUDE });
    if (!row) return null;
    const s = row as unknown as SkillRow;
    let creator = "—";
    if (s.currentVersion?.createdById) {
      const u = await db.user.findUnique({
        where: { id: s.currentVersion.createdById },
        select: { name: true },
      });
      creator = u?.name ?? "—";
    }
    return mapSkill(s, creator);
  });
}

export async function getAgentConfig(): Promise<MockAgentConfig> {
  return withOperator(async (db) => {
    const c = await db.agentConfig.findUnique({
      where: { id: "global" },
    });
    const updatedBy = c?.updatedById
      ? await db.user.findUnique({ where: { id: c.updatedById }, select: { name: true } })
      : null;
    return {
      defaultCeilingUsdCents: c?.defaultCeilingUsdCents ?? 2500,
      stepConcurrency: c?.stepConcurrency ?? 1,
      maxReconDepth: c?.maxReconDepth ?? 3,
      maxChainDepth: c?.maxChainDepth ?? 4,
      aggressivenessLevel: (c?.aggressivenessLevel ?? "standard") as MockAgentConfig["aggressivenessLevel"],
      stopOnFirstCritical: c?.stopOnFirstCritical ?? false,
      defaultFastModel: c?.defaultFastModel ?? "vaptbooster-fast",
      defaultStandardModel: c?.defaultStandardModel ?? "vaptbooster-default",
      defaultDeepModel: c?.defaultDeepModel ?? "vaptbooster-deep",
      plannerSystemPrompt: c?.plannerSystemPrompt ?? "",
      updatedAt: (c?.updatedAt ?? new Date()).toISOString(),
      updatedBy: updatedBy?.name ?? "—",
    };
  });
}

// -------------------------------------------------------------
// Workspace settings — tenant profile, members, pending invites, plan usage.
// -------------------------------------------------------------
export async function getWorkspaceSettings(tenantId: string, currentUserId: string) {
  return withTenant(tenantId, async (db) => {
    const [tenant, members, invites, usage] = await Promise.all([
      db.tenant.findFirst(),
      db.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, role: true, lastLogin: true, createdAt: true },
      }),
      db.invite.findMany({
        where: { tenantId, acceptedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, createdAt: true, expiresAt: true },
      }),
      getPlanUsage(db, tenantId),
    ]);

    const now = Date.now();
    return {
      tenant: {
        name: tenant?.name ?? "",
        slug: tenant?.slug ?? "",
        industry: tenant?.industry ?? "",
        country: tenant?.country ?? "",
        createdAt: (tenant?.createdAt ?? new Date()).toISOString(),
      },
      members: members.map((m) => ({
        id: m.id,
        name: m.name ?? "",
        email: m.email,
        role: String(m.role),
        lastLogin: m.lastLogin ? m.lastLogin.toISOString() : null,
        joinedAt: m.createdAt.toISOString(),
        isYou: m.id === currentUserId,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() < now,
      })),
      usage,
    };
  });
}
