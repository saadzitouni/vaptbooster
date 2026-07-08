// =============================================================
// Report domain types + PWNTROL brand-spec constants.
//
// Shared by the query layer, server actions, the editor, and the
// printable document. No React / Prisma imports here so it can be used
// from both client and server components.
// =============================================================

export type ReportSeverity = "critical" | "high" | "medium" | "low" | "info";

// A finding as embedded in a report — a point-in-time snapshot, editable
// independently of the live Finding row it may have been imported from.
export type ReportFinding = {
  id: string;
  title: string;
  severity: ReportSeverity;
  cwe: string;
  location: string;
  description: string;
  remediation: string;
};

// The full editable document (view-model; ISO-string dates).
export type ReportDoc = {
  id: string;
  tenantId: string;
  tenantName: string;
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
  findings: ReportFinding[];
  status: string; // "draft" | "final"
  confidential: boolean;
  generatedAt: string;
  updatedAt: string;
};

// Summary row for list views.
export type ReportListItem = {
  id: string;
  title: string;
  clientName: string;
  status: string;
  findingCount: number;
  tenantName?: string; // operator list only
  updatedAt: string;
};

// -------------------------------------------------------------
// Brand spec — SIGNAL palette (severity encoding ONLY, never decoration)
// -------------------------------------------------------------
export const SIGNAL: Record<ReportSeverity, string> = {
  critical: "#B4231C",
  high: "#C46A17",
  medium: "#8B7A2E",
  low: "#5A6B4A",
  info: "#5A6070",
};

export const SEVERITY_ACTION: Record<ReportSeverity, string> = {
  critical: "immediate action",
  high: "this sprint",
  medium: "this quarter",
  low: "best practice",
  info: "no action",
};

export const SEVERITY_ORDER: ReportSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

// Brand neutrals — the workhorses.
export const PALETTE = {
  ink: "#0A0A0A",
  ink2: "#101010",
  graphite: "#1F1F1F",
  bone: "#EDEDED",
  paper: "#FAFAF7",
  paper2: "#F2F1EC",
  slate: "#4A4A4A",
  stone: "#8A8A85",
} as const;

// Logo upload guards (enforced client + server).
export const LOGO_MAX_BYTES = 512 * 1024; // 512 KB — keeps the DB row small
export const LOGO_MIME = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

// -------------------------------------------------------------
// Normalizers — coerce untrusted JSON (DB column / client payload) into
// well-formed ReportFinding[]. Never throws; drops malformed entries.
// -------------------------------------------------------------
const SEVERITIES: ReportSeverity[] = ["critical", "high", "medium", "low", "info"];

function asSeverity(v: unknown): ReportSeverity {
  return SEVERITIES.includes(v as ReportSeverity) ? (v as ReportSeverity) : "info";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function normalizeFindings(raw: unknown): ReportFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === "object")
    .map((f, i) => {
      const o = f as Record<string, unknown>;
      return {
        id: str(o.id) || `f${i}`,
        title: str(o.title),
        severity: asSeverity(o.severity),
        cwe: str(o.cwe),
        location: str(o.location),
        description: str(o.description),
        remediation: str(o.remediation),
      };
    });
}

export function sortFindingsBySeverity(findings: ReportFinding[]): ReportFinding[] {
  const rank = (s: ReportSeverity) => SEVERITY_ORDER.indexOf(s);
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

export function countBySeverity(
  findings: ReportFinding[]
): Record<ReportSeverity, number> {
  const c: Record<ReportSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) c[f.severity]++;
  return c;
}
