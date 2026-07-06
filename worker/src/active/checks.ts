// =============================================================
// Stage 3 — active vulnerability testing (OPT-IN, per-scan).
//
// Sends *detection* payloads at injectable parameters and looks for tell-tale
// responses. NON-DESTRUCTIVE by design: a reflection canary for XSS and a
// single quote for SQL errors — no DROP/DELETE, no data exfiltration, no DoS.
// GET-only, scope-checked, rate-limited, request-budgeted (via ReconExecutor).
//
// This only runs when a scan is launched with --active, so read-only scans
// (e.g. against a real client site) are never actively attacked by accident.
// =============================================================

import { ReconExecutor } from "../recon/tools.js";
import type { ScopeTargetLite } from "../recon/scope.js";

export type ActiveSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ActiveFinding = {
  title: string;
  severity: ActiveSeverity;
  cwe?: string;
  location: string;
  summary: string;
  remediation?: string;
};

export type ActiveEvent = {
  actor: "system" | "claude" | "tool";
  level: "info" | "ok" | "warn" | "crit";
  msg: string;
};

export type InjectionPoint = { url: string; param: string; value: string };

// Database error signatures (lower-cased) — strong SQLi indicators.
export const SQL_ERRORS = [
  "you have an error in your sql syntax",
  "warning: mysql",
  "mysql_fetch",
  "supplied argument is not a valid mysql",
  "unclosed quotation mark after the character string",
  "quoted string not properly terminated",
  "pg_query()",
  "postgresql query failed",
  "syntax error at or near",
  "sqlite3::",
  "sqlite_error",
  "sqlstate[",
  "ora-01756",
  "ora-00933",
  "microsoft ole db provider for sql server",
  "odbc sql server driver",
  "native client",
];

const COMMON_PARAMS = ["id", "q", "search", "page", "cat", "user", "item"];

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function short(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? "?" : "");
  } catch {
    return url.slice(0, 40);
  }
}
function withParam(url: string, param: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(param, value);
  return u.toString();
}

// Derive injectable (url, param) pairs from discovered endpoints:
//   1) real query parameters seen during recon, then
//   2) a few common params on dynamic-looking endpoints that have none.
export function collectInjectionPoints(endpoints: string[]): InjectionPoint[] {
  const points: InjectionPoint[] = [];
  const seen = new Set<string>();

  for (const ep of endpoints) {
    let u: URL;
    try {
      u = new URL(ep);
    } catch {
      continue;
    }
    for (const [k, v] of u.searchParams) {
      const key = `${u.origin}${u.pathname}?${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ url: ep, param: k, value: v || "1" });
    }
  }

  for (const ep of endpoints) {
    let u: URL;
    try {
      u = new URL(ep);
    } catch {
      continue;
    }
    if (u.search) continue;
    const dynamic =
      /\.(php|asp|aspx|jsp|cgi|do)$/i.test(u.pathname) ||
      /\/(search|product|user|account|item|view|page|profile|news|article)/i.test(u.pathname);
    if (!dynamic) continue;
    for (const p of COMMON_PARAMS.slice(0, 3)) {
      const key = `${u.origin}${u.pathname}?${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ url: `${u.origin}${u.pathname}?${p}=1`, param: p, value: "1" });
    }
  }

  return points;
}

export async function runActiveChecks(
  scope: ScopeTargetLite[],
  endpoints: string[],
  deps: { onEvent?: (e: ActiveEvent) => Promise<void> | void; maxPoints?: number }
): Promise<ActiveFinding[]> {
  const exec = new ReconExecutor(scope, {
    maxRequests: 90,
    perRequestTimeoutMs: 8000,
    rateLimitMs: 300,
  });
  const points = collectInjectionPoints(endpoints).slice(0, deps.maxPoints ?? 12);
  const findings: ActiveFinding[] = [];

  await deps.onEvent?.({
    actor: "system",
    level: "info",
    msg: `Stage 3 · active testing — ${points.length} injection point(s) [detection payloads only]`,
  });
  if (!points.length) {
    await deps.onEvent?.({
      actor: "system",
      level: "info",
      msg: "no injectable parameters discovered — nothing to actively test",
    });
    return findings;
  }

  const seenXss = new Set<string>();
  const seenSqli = new Set<string>();

  for (const pt of points) {
    const baseUrl = withParam(pt.url, pt.param, pt.value);
    const base = await exec.probe(baseUrl);
    if (base.error) continue;
    const dedupeKey = `${short(pt.url)}#${pt.param}`;

    // ---- Reflected XSS: inject a canary tag, check it reflects unescaped ----
    const marker = `vbk${hash(pt.url + pt.param)}`;
    const xssPayload = `${marker}"'><img src=x onerror=${marker}>`;
    await deps.onEvent?.({ actor: "claude", level: "info", msg: `→ xss_probe(${pt.param} @ ${short(pt.url)})` });
    const xr = await exec.probe(withParam(pt.url, pt.param, xssPayload));
    if (!xr.error && xr.body.includes(`<img src=x onerror=${marker}>`)) {
      if (!seenXss.has(dedupeKey)) {
        seenXss.add(dedupeKey);
        findings.push({
          title: `Reflected XSS in '${pt.param}'`,
          severity: "high",
          cwe: "CWE-79",
          location: baseUrl,
          summary: `The '${pt.param}' parameter reflects input into the HTML response WITHOUT encoding. The injected canary tag appeared verbatim in the response, so an attacker-controlled value would execute script in a victim's browser.\n\nPayload: ${xssPayload}`,
          remediation: "Context-encode all user input on output (HTML-encode), and enforce a strict Content-Security-Policy.",
        });
        await deps.onEvent?.({ actor: "tool", level: "crit", msg: `xss: REFLECTED unescaped in '${pt.param}'` });
      }
    } else {
      await deps.onEvent?.({ actor: "tool", level: "ok", msg: `xss: '${pt.param}' not reflected` });
    }

    // ---- Error-based SQLi: a single quote should not surface a DB error ----
    await deps.onEvent?.({ actor: "claude", level: "info", msg: `→ sqli_probe(${pt.param} @ ${short(pt.url)})` });
    const sr = await exec.probe(withParam(pt.url, pt.param, `${pt.value}'`));
    const baseLower = base.body.toLowerCase();
    const sqlLower = sr.body.toLowerCase();
    const hitErr = SQL_ERRORS.find((e) => sqlLower.includes(e) && !baseLower.includes(e));
    if (!sr.error && hitErr) {
      if (!seenSqli.has(dedupeKey)) {
        seenSqli.add(dedupeKey);
        findings.push({
          title: `SQL injection in '${pt.param}'`,
          severity: "critical",
          cwe: "CWE-89",
          location: baseUrl,
          summary: `Appending a single quote to '${pt.param}' surfaced a database error ("${hitErr}") that the baseline response did not contain — a strong indicator of SQL injection.`,
          remediation: "Use parameterized queries / prepared statements; never concatenate user input into SQL.",
        });
        await deps.onEvent?.({ actor: "tool", level: "crit", msg: `sqli: DB error on '${pt.param}' → "${hitErr}"` });
      }
    } else {
      await deps.onEvent?.({ actor: "tool", level: "ok", msg: `sqli: '${pt.param}' no error signature` });
    }
  }

  return findings;
}
