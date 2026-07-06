// =============================================================
// View-model types shared by the query layer (lib/queries.ts) and the
// UI components. These mirror the Prisma models but use ISO-string dates
// and computed aggregates shaped for rendering.
//
// (Formerly held mock data; the app now reads live data from Postgres via
// lib/queries.ts, so only the types remain.)
// =============================================================

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type ScanStatus =
  | "draft"
  | "pending_approval"
  | "queued"
  | "running"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused_ceiling";
export type FindingStatus = "open" | "triaged" | "fixed" | "wontfix" | "duplicate";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  industry: string;
  country: string;
  createdAt: string;
  lastActivityAt: string;
  scopeCount: number;
  scanCount: number;
  openCriticals: number;
};

export type ScopeTarget = {
  id: string;
  tenantId: string;
  type: "domain" | "url" | "ip" | "repo";
  value: string;
  verifiedAt: string | null;
  addedAt: string;
};

export type Scan = {
  id: string;
  tenantId: string;
  targetId: string;
  targetValue: string;
  status: ScanStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: number; // 0..100
  currentStep: string | null;
  requesterName: string;
  notes?: string;
  findingCounts: Record<Severity, number>;
};

export type Finding = {
  id: string;
  tenantId: string;
  scanId: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  cwe?: string;
  location: string;
  discoveredAt: string;
  reproducedBy?: string; // operator name
  summary: string;
};
