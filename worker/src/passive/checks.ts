// =============================================================
// Stage 2 — passive vulnerability detection.
//
// Deterministic, rule-based checks over the evidence Stage 1 recon already
// collected (response headers, cookies, TLS, tech, bodies). NO new requests,
// NO payloads, NO exploitation — this is the passive layer (ZAP/Nuclei-style).
// Because it's deterministic it needs no LLM and produces precise findings
// with real severities, CWEs, evidence, and remediation.
// =============================================================

import type { ResponseMeta } from "../recon/tools.js";

export type PassiveSeverity = "critical" | "high" | "medium" | "low" | "info";

export type PassiveFinding = {
  title: string;
  severity: PassiveSeverity;
  cwe?: string;
  location: string;
  summary: string;
  remediation?: string;
};

const hdr = (r: ResponseMeta, name: string): string | undefined => r.headers[name.toLowerCase()];

export function runPassiveChecks(responses: ResponseMeta[]): PassiveFinding[] {
  const out: PassiveFinding[] = [];
  if (!responses.length) return out;

  // Representative response for app-wide header checks: prefer a successful
  // HTML page, else the first response we captured.
  const primary =
    responses.find(
      (r) => r.status >= 200 && r.status < 400 && (hdr(r, "content-type") ?? "").includes("html")
    ) ?? responses[0];

  // ---- Missing security response headers (evaluated on the primary page) ----
  const headerChecks: {
    header: string;
    title: string;
    severity: PassiveSeverity;
    cwe: string;
    remediation: string;
    httpsOnly?: boolean;
  }[] = [
    {
      header: "strict-transport-security",
      title: "Missing HSTS header",
      severity: "low",
      cwe: "CWE-319",
      httpsOnly: true,
      remediation: "Set 'Strict-Transport-Security: max-age=31536000; includeSubDomains' on all HTTPS responses.",
    },
    {
      header: "content-security-policy",
      title: "Missing Content-Security-Policy",
      severity: "low",
      cwe: "CWE-693",
      remediation: "Define a restrictive Content-Security-Policy to mitigate XSS and data-injection.",
    },
    {
      header: "x-content-type-options",
      title: "Missing X-Content-Type-Options: nosniff",
      severity: "low",
      cwe: "CWE-693",
      remediation: "Set 'X-Content-Type-Options: nosniff' to prevent MIME-type sniffing.",
    },
    {
      header: "referrer-policy",
      title: "Missing Referrer-Policy",
      severity: "info",
      cwe: "CWE-200",
      remediation: "Set 'Referrer-Policy: strict-origin-when-cross-origin' (or stricter).",
    },
    {
      header: "permissions-policy",
      title: "Missing Permissions-Policy",
      severity: "info",
      cwe: "CWE-693",
      remediation: "Set a Permissions-Policy that disables browser features the site does not use.",
    },
  ];
  for (const c of headerChecks) {
    if (c.httpsOnly && !primary.https) continue;
    if (!hdr(primary, c.header)) {
      out.push({
        title: c.title,
        severity: c.severity,
        cwe: c.cwe,
        location: primary.url,
        summary: `The response from ${primary.url} does not set the '${c.header}' header, leaving clients without this protection.`,
        remediation: c.remediation,
      });
    }
  }

  // ---- Clickjacking: no framing protection at all ----
  const csp = hdr(primary, "content-security-policy") ?? "";
  if (!hdr(primary, "x-frame-options") && !/frame-ancestors/i.test(csp)) {
    out.push({
      title: "No clickjacking protection (framing allowed)",
      severity: "low",
      cwe: "CWE-1021",
      location: primary.url,
      summary: `Neither 'X-Frame-Options' nor a CSP 'frame-ancestors' directive is set on ${primary.url}, so the page can be embedded in a frame by any origin (clickjacking).`,
      remediation: "Set 'X-Frame-Options: DENY' (or SAMEORIGIN) and/or CSP 'frame-ancestors 'self''.",
    });
  }

  // ---- Weak CSP (only if a CSP exists) ----
  if (csp) {
    const weak: string[] = [];
    if (/unsafe-inline/i.test(csp)) weak.push("'unsafe-inline'");
    if (/unsafe-eval/i.test(csp)) weak.push("'unsafe-eval'");
    if (/(?:default|script|style)-src[^;]*\*/i.test(csp)) weak.push("wildcard (*) source");
    if (weak.length) {
      out.push({
        title: "Weak Content-Security-Policy",
        severity: "low",
        cwe: "CWE-693",
        location: primary.url,
        summary: `The CSP weakens its own protection via ${weak.join(", ")}.\n\nCSP: ${csp.slice(0, 400)}`,
        remediation: "Remove 'unsafe-inline'/'unsafe-eval' and wildcard sources; use nonces or hashes instead.",
      });
    }
  }

  // ---- Version / technology disclosure ----
  const server = hdr(primary, "server");
  if (server && /\d/.test(server)) {
    out.push({
      title: "Server version disclosure",
      severity: "low",
      cwe: "CWE-200",
      location: primary.url,
      summary: `The 'Server' header reveals software and version: '${server}'. Version banners let attackers map the target to known CVEs.`,
      remediation: "Suppress or genericise the Server header (remove the version component).",
    });
  }
  const poweredBy = hdr(primary, "x-powered-by");
  if (poweredBy) {
    out.push({
      title: "X-Powered-By technology disclosure",
      severity: "info",
      cwe: "CWE-200",
      location: primary.url,
      summary: `The 'X-Powered-By' header reveals backend technology: '${poweredBy}'.`,
      remediation: "Remove the X-Powered-By header.",
    });
  }

  // ---- Insecure cookies (across all responses; deduped by cookie name) ----
  const cookieIssues = new Map<string, { issues: Set<string>; https: boolean; url: string }>();
  for (const r of responses) {
    for (const line of r.setCookie) {
      const name = line.split("=")[0].trim();
      if (!name) continue;
      const low = line.toLowerCase();
      const entry = cookieIssues.get(name) ?? { issues: new Set<string>(), https: r.https, url: r.url };
      if (r.https && !/;\s*secure(\s|;|$)/i.test(low)) entry.issues.add("Secure");
      if (!/;\s*httponly(\s|;|$)/i.test(low)) entry.issues.add("HttpOnly");
      if (!/;\s*samesite/i.test(low)) entry.issues.add("SameSite");
      if (entry.issues.size) cookieIssues.set(name, entry);
    }
  }
  for (const [name, { issues, url }] of cookieIssues) {
    const flags = [...issues];
    out.push({
      title: `Cookie '${name}' missing ${flags.join(", ")} attribute${flags.length > 1 ? "s" : ""}`,
      severity: issues.has("Secure") ? "medium" : "low",
      cwe: issues.has("Secure") ? "CWE-614" : "CWE-1004",
      location: url,
      summary: `The cookie '${name}' is set without the ${flags.join(", ")} attribute${flags.length > 1 ? "s" : ""}, weakening its protection against theft or CSRF.`,
      remediation: `Set the ${flags.join(", ")} attribute${flags.length > 1 ? "s" : ""} on the '${name}' cookie.`,
    });
  }

  // ---- Permissive CORS (report once) ----
  for (const r of responses) {
    if (hdr(r, "access-control-allow-origin") === "*") {
      const withCreds = (hdr(r, "access-control-allow-credentials") ?? "").toLowerCase() === "true";
      out.push({
        title: "Permissive CORS policy (Access-Control-Allow-Origin: *)",
        severity: withCreds ? "high" : "medium",
        cwe: "CWE-942",
        location: r.url,
        summary: `${r.url} returns 'Access-Control-Allow-Origin: *'${withCreds ? " together with 'Access-Control-Allow-Credentials: true' — a dangerous combination that can expose authenticated data cross-origin" : ""}, allowing any website to read its responses.`,
        remediation: "Restrict Access-Control-Allow-Origin to a trusted allowlist; never pair '*' with credentials.",
      });
      break;
    }
  }

  // ---- Plaintext HTTP transport ----
  const httpUrls = responses.filter((r) => !r.https).map((r) => r.url);
  if (httpUrls.length) {
    out.push({
      title: "Content served over plaintext HTTP",
      severity: "medium",
      cwe: "CWE-319",
      location: httpUrls[0],
      summary: `${httpUrls.length} endpoint(s) served over HTTP without TLS:\n${httpUrls.slice(0, 10).join("\n")}`,
      remediation: "Serve all content over HTTPS, redirect HTTP→HTTPS, and enable HSTS.",
    });
  }

  // ---- Directory listing exposed ----
  for (const r of responses) {
    if (/<title>\s*Index of \//i.test(r.bodySnippet) || /Directory listing for/i.test(r.bodySnippet)) {
      out.push({
        title: "Directory listing enabled",
        severity: "medium",
        cwe: "CWE-548",
        location: r.url,
        summary: `${r.url} returns an auto-generated directory index, exposing file and folder names that should not be public.`,
        remediation: "Disable auto-indexing (nginx 'autoindex off' / Apache 'Options -Indexes').",
      });
    }
  }

  return out;
}
