// =============================================================
// Stage 3.5 — authenticated / POST form testing.
//
// Reaches the surface Stage 3 (GET-only) couldn't: HTML <form>s submitted via
// POST (login, register, search, contact). For each non-destructive form it
// runs the same NON-DESTRUCTIVE detection probes — reflection canary for XSS,
// a single quote for SQL errors — plus a SQL-injection auth-bypass check on
// login forms.
//
// SAFETY: forms whose action looks state-changing (transfer/withdraw/delete/
// pay/…) are SKIPPED by default — we detect, we don't move money or destroy data.
// =============================================================

import { ReconExecutor } from "../recon/tools.js";
import type { ScopeTargetLite } from "../recon/scope.js";
import { SQL_ERRORS, hash, short, type ActiveFinding, type ActiveEvent } from "./checks.js";

export type FormField = { name: string; type: string; value: string };
export type ParsedForm = { action: string; method: "GET" | "POST"; fields: FormField[] };

// Actions we must NOT fuzz — they change state / move money.
const DESTRUCTIVE = /transfer|withdraw|delete|remove|\bpay\b|payment|checkout|purchase|wire|topup|top-up|send-money|admin\/(delete|remove)/i;

function attrGet(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs);
  return m ? m[1] : undefined;
}

export function parseForms(html: string, baseUrl: string): ParsedForm[] {
  const forms: ParsedForm[] = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(html))) {
    const attrs = fm[1];
    const inner = fm[2];
    let action: string;
    try {
      action = new URL(attrGet(attrs, "action") || baseUrl, baseUrl).toString();
    } catch {
      continue;
    }
    const method = (attrGet(attrs, "method") ?? "get").toUpperCase() === "POST" ? "POST" : "GET";
    const fields: FormField[] = [];
    const inputRe = /<(input|textarea|select)\b([^>]*)>/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(inner))) {
      const tag = im[1].toLowerCase();
      const iattrs = im[2];
      const name = attrGet(iattrs, "name");
      if (!name) continue;
      const type = (attrGet(iattrs, "type") ?? (tag === "textarea" ? "textarea" : "text")).toLowerCase();
      fields.push({ name, type, value: attrGet(iattrs, "value") ?? "" });
    }
    if (fields.length) forms.push({ action, method, fields });
  }
  return forms;
}

function benignValue(type: string, name: string): string {
  if (type === "email" || /email/i.test(name)) return "vbtest@example.com";
  if (type === "password") return "VbTest1234!";
  if (type === "number") return "1";
  if (type === "hidden") return ""; // leave hidden/CSRF tokens empty-safe
  return "vbtest";
}
function encodeForm(pairs: { name: string; value: string }[]): string {
  return pairs.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join("&");
}

const INJECTABLE_TYPES = new Set(["text", "search", "textarea", "email", "url", "tel", "", "password"]);

export async function runFormChecks(
  scope: ScopeTargetLite[],
  candidateUrls: string[],
  deps: { onEvent?: (e: ActiveEvent) => Promise<void> | void; maxForms?: number }
): Promise<ActiveFinding[]> {
  const exec = new ReconExecutor(scope, { maxRequests: 120, perRequestTimeoutMs: 8000, rateLimitMs: 300 });
  const findings: ActiveFinding[] = [];
  const tested = new Set<string>();
  const maxForms = deps.maxForms ?? 8;
  let count = 0;

  for (const url of candidateUrls) {
    if (count >= maxForms) break;
    const page = await exec.probe(url);
    if (page.error || !page.body) continue;

    for (const form of parseForms(page.body, url)) {
      if (count >= maxForms) break;
      const key = `${form.method} ${form.action}`;
      if (tested.has(key)) continue;

      if (DESTRUCTIVE.test(form.action) || DESTRUCTIVE.test(url)) {
        await deps.onEvent?.({ actor: "tool", level: "warn", msg: `form skipped (state-changing): ${short(form.action)}` });
        tested.add(key);
        continue;
      }
      const injectable = form.fields.filter((f) => INJECTABLE_TYPES.has(f.type));
      if (!injectable.length) continue;
      tested.add(key);
      count++;

      const target = injectable.find((f) => f.type !== "password") ?? injectable[0];
      await deps.onEvent?.({
        actor: "claude",
        level: "info",
        msg: `→ form_probe(${form.method} ${short(form.action)} · field '${target.name}')`,
      });

      const send = (overrides: Record<string, string>) => {
        const pairs = form.fields.map((f) => ({ name: f.name, value: overrides[f.name] ?? benignValue(f.type, f.name) }));
        const body = encodeForm(pairs);
        return form.method === "POST"
          ? exec.submit(form.action, { method: "POST", body })
          : exec.submit(`${form.action}?${body}`, { method: "GET" });
      };

      const base = await send({});
      const baseLower = base.body.toLowerCase();

      // ---- Reflected XSS in a form field ----
      const marker = `vbk${hash(form.action + target.name)}`;
      const xssPayload = `${marker}"'><img src=x onerror=${marker}>`;
      const xr = await send({ [target.name]: xssPayload });
      if (!xr.error && xr.body.includes(`<img src=x onerror=${marker}>`)) {
        findings.push({
          title: `Reflected XSS in form field '${target.name}'`,
          severity: "high",
          cwe: "CWE-79",
          location: form.action,
          summary: `The '${target.name}' field (submitted via ${form.method} to ${form.action}) reflects input into the response WITHOUT encoding.\n\nPayload: ${xssPayload}`,
          remediation: "Context-encode user input on output and enforce a strict Content-Security-Policy.",
        });
        await deps.onEvent?.({ actor: "tool", level: "crit", msg: `xss: form field '${target.name}' reflected unescaped` });
      }

      // ---- Error-based SQLi in a form field ----
      const sr = await send({ [target.name]: `${benignValue(target.type, target.name)}'` });
      const hitErr = SQL_ERRORS.find((e) => sr.body.toLowerCase().includes(e) && !baseLower.includes(e));
      if (!sr.error && hitErr) {
        findings.push({
          title: `SQL injection in form field '${target.name}'`,
          severity: "critical",
          cwe: "CWE-89",
          location: form.action,
          summary: `Submitting a single quote in '${target.name}' (${form.method} ${form.action}) surfaced a database error ("${hitErr}") not present in the baseline response.`,
          remediation: "Use parameterized queries / prepared statements.",
        });
        await deps.onEvent?.({ actor: "tool", level: "crit", msg: `sqli: form field '${target.name}' → "${hitErr}"` });
      }

      // ---- SQLi authentication bypass (login forms only) ----
      const pw = form.fields.find((f) => f.type === "password");
      const userF = injectable.find((f) => f.type !== "password") ?? form.fields.find((f) => /user|email|login|name/i.test(f.name));
      const isLogin = !!pw && /login|signin|sign-in|auth|logon/i.test(form.action + url);
      if (isLogin && pw && userF) {
        await deps.onEvent?.({ actor: "claude", level: "info", msg: `→ login_bypass_probe(${short(form.action)})` });
        const bad = await send({ [userF.name]: `nouser_${marker}`, [pw.name]: `badpass_${marker}` });
        const inj = `' OR '1'='1' -- `;
        const injResp = await send({ [userF.name]: inj, [pw.name]: inj });
        const badRejected = /invalid|incorrect|failed|wrong|denied|unauthor|not found|try again/i.test(bad.body) || bad.status === 401 || bad.status === 403;
        const injSucceeded =
          !injResp.error &&
          ((injResp.status >= 300 && injResp.status < 400) ||
            injResp.setCookie.some((c) => /sess|token|auth|jwt|sid/i.test(c)) ||
            (/dashboard|welcome|logout|log out|success|"token"|account balance/i.test(injResp.body) &&
              !/invalid|incorrect|failed|wrong|denied/i.test(injResp.body)));
        if (badRejected && injSucceeded) {
          findings.push({
            title: "SQL injection authentication bypass on login",
            severity: "critical",
            cwe: "CWE-89",
            location: form.action,
            summary: `A SQL-injection payload ("${inj}") in the login form produced a success-like response (auth cookie / redirect / dashboard) while an invalid login was rejected — indicating authentication bypass via SQL injection.`,
            remediation: "Authenticate with parameterized queries; never concatenate credentials into SQL. Add rate-limiting + generic error messages.",
          });
          await deps.onEvent?.({ actor: "tool", level: "crit", msg: `sqli: LOGIN BYPASS on ${short(form.action)}` });
        } else {
          await deps.onEvent?.({ actor: "tool", level: "ok", msg: `login bypass: not vulnerable (${short(form.action)})` });
        }
      }
    }
  }

  return findings;
}
