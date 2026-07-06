// =============================================================
// Mock skills + agent config — for the super-admin UI before
// the backend lands. Mirrors prisma/schema.prisma exactly.
// =============================================================

export type SkillAltitude = "atomic" | "tactical" | "strategic";

export type MockSkill = {
  id: string;
  key: string;
  altitude: SkillAltitude;
  category: string;
  enabled: boolean;
  currentVersion: {
    versionNumber: number;
    name: string;
    description: string;
    triggers: string;
    antiTriggers: string;
    systemPrompt: string;
    classifyPrompt?: string;
    payloadSets: Record<string, unknown>;
    severityMap: Record<string, "critical" | "high" | "medium" | "low" | "info">;
    confidenceThreshold: number;
    modelChoice: string;
    maxCostUsdCents: number;
    safety: Record<string, unknown>;
    publishedAt: string;
    createdBy: string;
  };
  totalVersions: number;
  metrics: {
    callsLast30d: number;
    avgCostUsdCents: number;
    avgLatencyMs: number;
    falsePositiveRate: number; // 0..1, from operator triage
  };
};

export const MOCK_SKILLS: MockSkill[] = [
  // ---- Strategic ----
  {
    id: "sk_01",
    key: "recon_target",
    altitude: "strategic",
    category: "recon",
    enabled: true,
    currentVersion: {
      versionNumber: 7,
      name: "Recon target",
      description: "Maps the application's attack surface: routes, parameters, auth flow, third-party deps.",
      triggers: "- New scan starts and no prior recon exists\n- Scope target was added in the last 7 days\n- Operator forces re-recon",
      antiTriggers: "- Recon was completed within the last 24h (use cached map)\n- Target is unreachable",
      systemPrompt: "You are a reconnaissance planner. Your goal is to enumerate every entry point an attacker could probe. You delegate to atomic skills (fetch_url, extract_endpoints, enumerate_subdomains) and never make HTTP requests directly.",
      payloadSets: {},
      severityMap: { confirmed: "info" }, // recon produces info findings only
      confidenceThreshold: 0.9,
      modelChoice: "vaptbooster-default",
      maxCostUsdCents: 300,
      safety: { requiresScopeMatch: true, rateLimit: { perTarget: 60, perSecond: 5 } },
      publishedAt: "2026-06-28T14:00:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 7,
    metrics: { callsLast30d: 412, avgCostUsdCents: 280, avgLatencyMs: 18400, falsePositiveRate: 0.02 },
  },
  {
    id: "sk_02",
    key: "audit_authorization",
    altitude: "strategic",
    category: "authorization",
    enabled: true,
    currentVersion: {
      versionNumber: 3,
      name: "Audit authorization",
      description: "Composes IDOR, privilege-escalation, and missing-auth tactical skills across the discovered surface.",
      triggers: "- Recon found endpoints requiring auth\n- Two or more user contexts available",
      antiTriggers: "- App has no auth flow\n- Only one user context (cannot test cross-user)",
      systemPrompt: "You are an authorization auditor. Pick which tactical skill to apply to each endpoint based on its method, parameters, and response shape.",
      payloadSets: {},
      severityMap: { confirmed: "high", confirmed_admin_takeover: "critical" },
      confidenceThreshold: 0.8,
      modelChoice: "vaptbooster-deep",
      maxCostUsdCents: 500,
      safety: { requiresScopeMatch: true, requiresWritePermission: false },
      publishedAt: "2026-06-25T11:30:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 3,
    metrics: { callsLast30d: 187, avgCostUsdCents: 420, avgLatencyMs: 22100, falsePositiveRate: 0.08 },
  },

  // ---- Tactical ----
  {
    id: "sk_03",
    key: "test_for_idor",
    altitude: "tactical",
    category: "authorization",
    enabled: true,
    currentVersion: {
      versionNumber: 12,
      name: "Test for IDOR",
      description: "Tests an authenticated endpoint for Insecure Direct Object References by swapping resource IDs across two user contexts.",
      triggers: "- Endpoint has an ID-like parameter (numeric or UUID)\n- Endpoint returns user-owned data (orders, invoices, profiles)\n- Two distinct authenticated sessions available",
      antiTriggers: "- Endpoint is unauthenticated\n- Parameter is a server-generated CSRF token, not a resource ID\n- Endpoint already tested in this scan",
      systemPrompt: "You are an IDOR detector. You will receive two HTTP responses (one from each user). Classify whether the second response leaked the first user's data.",
      classifyPrompt: "Given the baseline response and the probe response, answer with one token: confirmed_idor, properly_denied, ambiguous, or different_endpoint_behavior.",
      payloadSets: {
        idLikePatterns: ["^[0-9]+$", "^[0-9a-f]{8}-[0-9a-f]{4}", "/users/", "/orders/", "/invoices/"],
      },
      severityMap: { confirmed_idor: "high", ambiguous: "info" },
      confidenceThreshold: 0.85,
      modelChoice: "vaptbooster-default",
      maxCostUsdCents: 30,
      safety: { requiresScopeMatch: true, requiresWritePermission: false, maxRetries: 1, rateLimit: { perTarget: 10, perSecond: 2 } },
      publishedAt: "2026-06-29T09:14:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 12,
    metrics: { callsLast30d: 1840, avgCostUsdCents: 22, avgLatencyMs: 3400, falsePositiveRate: 0.04 },
  },
  {
    id: "sk_04",
    key: "test_for_ssrf",
    altitude: "tactical",
    category: "injection",
    enabled: true,
    currentVersion: {
      versionNumber: 8,
      name: "Test for SSRF",
      description: "Tests a URL-accepting parameter for Server-Side Request Forgery by probing internal/metadata endpoints inside a sandbox.",
      triggers: "- Parameter value looks like a URL\n- Parameter name matches /url|src|callback|webhook|redirect|fetch/i\n- Endpoint method is POST or PUT",
      antiTriggers: "- Parameter is on an unauthenticated public page\n- Target's WAF clearly blocks all URL-like input",
      systemPrompt: "You are an SSRF detector. Probe the parameter with internal-only URLs and judge whether the server fetched them.",
      classifyPrompt: "Did the server-side request reach our canary URL? Answer: confirmed_ssrf, blocked, ambiguous.",
      payloadSets: {
        canaryHosts: ["http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/", "http://localhost:6379/"],
        outOfBandHost: "{{tenant_oob_subdomain}}.oob.vaptbooster.pwntrol.com",
      },
      severityMap: { confirmed_ssrf: "critical", blocked: "info" },
      confidenceThreshold: 0.9,
      modelChoice: "vaptbooster-default",
      maxCostUsdCents: 60,
      safety: { requiresScopeMatch: true, requiresWritePermission: true, maxRetries: 2, rateLimit: { perTarget: 5, perSecond: 1 } },
      publishedAt: "2026-06-27T16:20:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 8,
    metrics: { callsLast30d: 624, avgCostUsdCents: 48, avgLatencyMs: 8200, falsePositiveRate: 0.11 },
  },
  {
    id: "sk_05",
    key: "test_for_sqli",
    altitude: "tactical",
    category: "injection",
    enabled: true,
    currentVersion: {
      versionNumber: 15,
      name: "Test for SQL injection",
      description: "Tests for time-based blind, boolean-based blind, and error-based SQL injection in user-controllable parameters.",
      triggers: "- String parameter reaches the database (heuristic: name in /query|search|filter|sort|order|id/i)\n- Endpoint returns 200 with variable body length",
      antiTriggers: "- Parameter is parsed strictly as enum/int by the framework\n- Endpoint enforces NoSQL backing store (separate skill)",
      systemPrompt: "You are a SQL injection detector. You inject canary payloads and detect deviations from baseline timing or body content.",
      classifyPrompt: "Given the baseline and the probe response timings/bodies, is this SQLi? Answer: confirmed_sqli, false_positive, ambiguous.",
      payloadSets: {
        timeBasedPayloads: ["'; WAITFOR DELAY '0:0:3'--", "' OR pg_sleep(3)--", "' AND SLEEP(3)--"],
        booleanPayloads: ["' OR 1=1--", "' OR 1=0--"],
      },
      severityMap: { confirmed_sqli: "critical", ambiguous: "low" },
      confidenceThreshold: 0.9,
      modelChoice: "vaptbooster-deep",
      maxCostUsdCents: 80,
      safety: { requiresScopeMatch: true, requiresWritePermission: false, maxRetries: 1, rateLimit: { perTarget: 6, perSecond: 1 } },
      publishedAt: "2026-06-30T05:42:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 15,
    metrics: { callsLast30d: 2104, avgCostUsdCents: 68, avgLatencyMs: 12400, falsePositiveRate: 0.06 },
  },
  {
    id: "sk_06",
    key: "test_for_open_redirect",
    altitude: "tactical",
    category: "redirect",
    enabled: true,
    currentVersion: {
      versionNumber: 4,
      name: "Test for open redirect",
      description: "Tests redirect-style parameters for open redirect vulnerabilities.",
      triggers: "- Parameter name matches /redirect|return|continue|next|url|destination/i",
      antiTriggers: "- Server-side redirect path is hardcoded",
      systemPrompt: "You are an open redirect detector.",
      payloadSets: {
        redirectTargets: ["https://evil.example.com", "//evil.example.com", "https:evil.example.com"],
      },
      severityMap: { confirmed: "low" },
      confidenceThreshold: 0.8,
      modelChoice: "vaptbooster-fast",
      maxCostUsdCents: 15,
      safety: { requiresScopeMatch: true, rateLimit: { perTarget: 20, perSecond: 4 } },
      publishedAt: "2026-06-18T10:00:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 4,
    metrics: { callsLast30d: 718, avgCostUsdCents: 11, avgLatencyMs: 1800, falsePositiveRate: 0.18 },
  },
  {
    id: "sk_07",
    key: "test_for_jwt_alg_confusion",
    altitude: "tactical",
    category: "authentication",
    enabled: false, // DISABLED — under review
    currentVersion: {
      versionNumber: 2,
      name: "Test for JWT alg confusion",
      description: "Tests JWT-using endpoints for algorithm confusion vulnerabilities (RS256→HS256, alg=none).",
      triggers: "- Endpoint accepts an Authorization: Bearer token\n- Token decodes to a valid JWT",
      antiTriggers: "- Endpoint uses opaque tokens (non-JWT)",
      systemPrompt: "You are a JWT vulnerability detector.",
      payloadSets: { algorithms: ["none", "HS256-with-public-key"] },
      severityMap: { confirmed: "critical" },
      confidenceThreshold: 0.95,
      modelChoice: "vaptbooster-default",
      maxCostUsdCents: 25,
      safety: { requiresScopeMatch: true, requiresWritePermission: false },
      publishedAt: "2026-06-12T08:00:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 2,
    metrics: { callsLast30d: 0, avgCostUsdCents: 19, avgLatencyMs: 2400, falsePositiveRate: 0.32 },
  },

  // ---- Atomic ----
  {
    id: "sk_08",
    key: "fetch_url",
    altitude: "atomic",
    category: "primitive",
    enabled: true,
    currentVersion: {
      versionNumber: 1,
      name: "Fetch URL",
      description: "Makes an HTTP request and returns the response. Deterministic; no LLM call.",
      triggers: "- Any other skill needs to make an HTTP request",
      antiTriggers: "- URL is outside the tenant's authorized scope",
      systemPrompt: "(deterministic — no LLM)",
      payloadSets: {},
      severityMap: {},
      confidenceThreshold: 1,
      modelChoice: "none",
      maxCostUsdCents: 0,
      safety: { requiresScopeMatch: true, rateLimit: { perTarget: 120, perSecond: 10 } },
      publishedAt: "2026-05-01T00:00:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 1,
    metrics: { callsLast30d: 84200, avgCostUsdCents: 0, avgLatencyMs: 220, falsePositiveRate: 0 },
  },
  {
    id: "sk_09",
    key: "enumerate_subdomains",
    altitude: "atomic",
    category: "primitive",
    enabled: true,
    currentVersion: {
      versionNumber: 5,
      name: "Enumerate subdomains",
      description: "Discovers subdomains of a domain via CT logs, DNS bruteforce, and search engine pivoting.",
      triggers: "- Scope target type is 'domain'\n- Recon phase",
      antiTriggers: "- Target is a single hostname (no subdomain expansion needed)",
      systemPrompt: "(deterministic — no LLM)",
      payloadSets: {
        wordlistSize: "medium-5000",
        sources: ["crt.sh", "subfinder", "amass-passive"],
      },
      severityMap: {},
      confidenceThreshold: 1,
      modelChoice: "none",
      maxCostUsdCents: 0,
      safety: { requiresScopeMatch: true },
      publishedAt: "2026-06-20T12:00:00Z",
      createdBy: "Saad Zitouni",
    },
    totalVersions: 5,
    metrics: { callsLast30d: 412, avgCostUsdCents: 0, avgLatencyMs: 8200, falsePositiveRate: 0 },
  },
];

// =============================================================
// Agent config (singleton)
// =============================================================
export type MockAgentConfig = {
  defaultCeilingUsdCents: number;
  stepConcurrency: number;
  maxReconDepth: number;
  maxChainDepth: number;
  aggressivenessLevel: "conservative" | "standard" | "aggressive";
  stopOnFirstCritical: boolean;
  defaultFastModel: string;
  defaultStandardModel: string;
  defaultDeepModel: string;
  plannerSystemPrompt: string;
  updatedAt: string;
  updatedBy: string;
};

export const MOCK_AGENT_CONFIG: MockAgentConfig = {
  defaultCeilingUsdCents: 2500,
  stepConcurrency: 2,
  maxReconDepth: 3,
  maxChainDepth: 4,
  aggressivenessLevel: "standard",
  stopOnFirstCritical: false,
  defaultFastModel: "vaptbooster-fast",
  defaultStandardModel: "vaptbooster-default",
  defaultDeepModel: "vaptbooster-deep",
  plannerSystemPrompt: `You are the strategic planner for VAPTBOOSTER, an autonomous web pentest agent.

Your job is to decide which skills to invoke next based on:
1. What's been discovered so far (recon, findings)
2. What budget remains for this scan
3. Which skills' triggers fire on the current state

You do NOT execute attacks yourself. You compose tactical and atomic skills.
You stop when: no new triggers fire, budget is exhausted, or operator cancels.
Prefer skills with the lowest cost-per-finding metric, all else equal.`,
  updatedAt: "2026-06-29T10:00:00Z",
  updatedBy: "Saad Zitouni",
};
