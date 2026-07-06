// =============================================================
// Stage 3.6 — JSON API + JWT authenticated testing.
//
// Modern apps (SPAs) hide their real surface behind a JSON API + a bearer
// token. This stage:
//   1. acquires a session — registers a throwaway test account, then logs in
//      via the JSON API and captures the JWT / session cookie
//   2. tests the AUTHENTICATED API for the bugs a bank app actually has:
//        · broken authentication (data served with no / forged token)
//        · IDOR (object-level authz missing — read other users' records)
//        · SQL injection in API parameters
//
// SAFETY: every test request is a GET except the register/login POSTs needed to
// authenticate. No transfers, deletes, or destructive writes.
// =============================================================

import { ReconExecutor } from "../recon/tools.js";
import type { ScopeTargetLite } from "../recon/scope.js";
import { SQL_ERRORS, hash, short, type ActiveFinding, type ActiveEvent } from "./checks.js";

type Auth = { headers: Record<string, string>; jwt?: string; via: string } | null;

const REGISTER_PATHS = ["/api/register", "/api/auth/register", "/api/signup", "/api/v1/register", "/api/users", "/register"];
const LOGIN_PATHS = ["/api/login", "/api/auth/login", "/api/signin", "/api/token", "/api/v1/login", "/login"];
const BANK_RESOURCES = ["accounts", "account", "users", "user", "transactions", "transfers", "cards", "profile", "beneficiaries"];

function originOf(scope: ScopeTargetLite[]): string | null {
  for (const s of scope) {
    try {
      if (/^https?:/i.test(s.value)) return new URL(s.value).origin;
    } catch {
      /* */
    }
  }
  for (const s of scope) if (s.value) return `https://${s.value.replace(/^https?:\/\//i, "").split("/")[0]}`;
  return null;
}

function extractToken(body: string, setCookie: string[]): string | undefined {
  try {
    const j = JSON.parse(body) as Record<string, any>;
    const flat = [
      j.token, j.access_token, j.accessToken, j.jwt, j.id_token,
      j.data?.token, j.data?.accessToken, j.data?.access_token, j.data?.jwt,
    ].find((v) => typeof v === "string" && v.length > 20);
    if (flat) return flat as string;
  } catch {
    /* not JSON */
  }
  for (const c of setCookie) {
    const m = /(?:token|jwt|access_token|auth)=([^;]+)/i.exec(c);
    if (m && m[1].length > 20) return m[1];
  }
  return undefined;
}

function looksLikeData(body: string): boolean {
  const t = body.trim();
  if (t.length < 5 || !(t.startsWith("{") || t.startsWith("["))) return false;
  if (/unauthor|forbidden|invalid token|token.*(expired|invalid)|authentication required|not authenticated/i.test(t.slice(0, 200))) return false;
  return true;
}
function looksLikeObject(body: string): boolean {
  const t = body.trim();
  return t.startsWith("{") && t.length > 5 && !/unauthor|forbidden|invalid token|not found|"error"/i.test(t.slice(0, 160));
}
// True only when two responses carry effectively the SAME record — used for
// broken-auth (data served identically with/without a valid token). Compares
// content, not just length, so two different-but-same-size objects aren't
// mistaken for one another.
function sameData(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const min = Math.min(a.length, b.length),
    max = Math.max(a.length, b.length);
  return max > 0 && min / max > 0.9 && a.slice(0, 80) === b.slice(0, 80);
}

async function acquireAuth(
  base: string,
  exec: ReconExecutor,
  seed: number,
  onEvent?: (e: ActiveEvent) => Promise<void> | void
): Promise<Auth> {
  const u = `vbt${seed}`;
  const ident = { username: u, email: `${u}@example.com`, password: "VbTest1234!", name: u };
  const jsonPost = (path: string, obj: unknown) =>
    exec.submit(base + path, { method: "POST", body: JSON.stringify(obj), contentType: "application/json" });

  await onEvent?.({ actor: "claude", level: "info", msg: "→ acquire_session (register + login via JSON API)" });

  // Register a throwaway account (best-effort — needed to obtain a session).
  for (const path of REGISTER_PATHS) {
    for (const b of [ident, { username: ident.username, password: ident.password }, { email: ident.email, password: ident.password }]) {
      const r = await jsonPost(path, b);
      if (!r.error && (r.status === 200 || r.status === 201)) {
        await onEvent?.({ actor: "tool", level: "ok", msg: `registered test account via ${path}` });
        break;
      }
    }
  }

  // Log in and capture the token / session.
  for (const path of LOGIN_PATHS) {
    for (const b of [{ username: ident.username, password: ident.password }, { email: ident.email, password: ident.password }]) {
      const r = await jsonPost(path, b);
      if (r.error) continue;
      const tok = extractToken(r.body, r.setCookie);
      if (tok) {
        await onEvent?.({ actor: "claude", level: "ok", msg: `✓ authenticated via ${path} — JWT captured` });
        return { headers: { Authorization: `Bearer ${tok}` }, jwt: tok, via: path };
      }
      const cookie = r.setCookie.find((c) => /token|jwt|sess|auth/i.test(c));
      if (r.status >= 200 && r.status < 300 && cookie) {
        await onEvent?.({ actor: "claude", level: "ok", msg: `✓ authenticated via ${path} — session cookie` });
        return { headers: { Cookie: cookie.split(";")[0] }, via: path };
      }
    }
  }
  await onEvent?.({ actor: "tool", level: "info", msg: "no session obtained (no standard register/login shape matched)" });
  return null;
}

export async function runApiTests(
  scope: ScopeTargetLite[],
  endpoints: string[],
  deps: { onEvent?: (e: ActiveEvent) => Promise<void> | void }
): Promise<ActiveFinding[]> {
  const findings: ActiveFinding[] = [];
  const base = originOf(scope);
  if (!base) return findings;

  const exec = new ReconExecutor(scope, { maxRequests: 160, perRequestTimeoutMs: 8000, rateLimitMs: 300 });
  await deps.onEvent?.({ actor: "system", level: "info", msg: "Stage 3.6 · JSON API + JWT auth testing" });

  const auth = await acquireAuth(base, exec, hash(base) % 100000, deps.onEvent);
  const authHeaders = auth?.headers ?? {};

  // Candidate API resource paths: discovered /api/* paths + common bank resources.
  const apiPaths = new Set<string>();
  for (const ep of endpoints) {
    try {
      const p = new URL(ep).pathname.replace(/\/$/, "");
      if (/\/api\//i.test(p)) apiPaths.add(p);
    } catch {
      /* */
    }
  }
  for (const r of BANK_RESOURCES) apiPaths.add(`/api/${r}`);
  const paths = [...apiPaths].slice(0, 12);

  // ---- Broken authentication: protected data served with no / forged token ----
  for (const p of paths) {
    const url = base + p;
    const withAuth = auth ? await exec.submit(url, { method: "GET", headers: authHeaders }) : null;
    const authOk = withAuth && withAuth.status >= 200 && withAuth.status < 300 && looksLikeData(withAuth.body);
    if (!authOk && !auth) continue;
    if (!authOk) continue;

    const noAuth = await exec.submit(url, { method: "GET" });
    if (noAuth.status >= 200 && noAuth.status < 300 && looksLikeData(noAuth.body) && sameData(noAuth.body, withAuth!.body)) {
      findings.push({
        title: `Missing authentication on ${p}`,
        severity: "critical",
        cwe: "CWE-306",
        location: url,
        summary: `${p} returns protected data with NO authentication token — the endpoint does not require authentication.`,
        remediation: "Require and verify authentication on every protected endpoint.",
      });
      await deps.onEvent?.({ actor: "tool", level: "crit", msg: `broken-auth: ${p} served data with NO token` });
      continue;
    }
    const forged = await exec.submit(url, { method: "GET", headers: { Authorization: "Bearer invalid.invalid.invalid" } });
    if (forged.status >= 200 && forged.status < 300 && looksLikeData(forged.body) && sameData(forged.body, withAuth!.body)) {
      findings.push({
        title: `JWT signature not validated on ${p}`,
        severity: "high",
        cwe: "CWE-345",
        location: url,
        summary: `${p} accepts a forged/invalid bearer token and still returns data — the JWT signature is not being verified server-side.`,
        remediation: "Verify the JWT signature and expiry on every request.",
      });
      await deps.onEvent?.({ actor: "tool", level: "crit", msg: `broken-auth: ${p} accepts a forged token` });
    }
  }

  // ---- IDOR: object-level authorization missing (read other users' records) ----
  for (const p of paths.slice(0, 8)) {
    const r1 = await exec.submit(`${base}${p}/1`, { method: "GET", headers: authHeaders });
    if (!(r1.status >= 200 && r1.status < 300 && looksLikeObject(r1.body))) continue;
    const r2 = await exec.submit(`${base}${p}/2`, { method: "GET", headers: authHeaders });
    if (r2.status >= 200 && r2.status < 300 && looksLikeObject(r2.body) && r1.body !== r2.body) {
      findings.push({
        title: `Possible IDOR on ${p}/{id}`,
        severity: "high",
        cwe: "CWE-639",
        location: `${base}${p}/{id}`,
        summary: `Requesting ${p}/1 and ${p}/2 with the same session returned two different records (both HTTP 200). Object-level authorization appears to be missing — an attacker could read other users' ${p.split("/").pop()} by changing the id.`,
        remediation: "Enforce per-object ownership: the authenticated user may only access their own records.",
      });
      await deps.onEvent?.({ actor: "tool", level: "crit", msg: `idor: ${p}/{id} exposes multiple records` });
    }
  }

  // ---- SQL injection in authenticated API parameters ----
  for (const p of paths.slice(0, 8)) {
    const clean = await exec.submit(`${base}${p}?id=1`, { method: "GET", headers: authHeaders });
    const quoted = await exec.submit(`${base}${p}?id=1'`, { method: "GET", headers: authHeaders });
    const hit = SQL_ERRORS.find((e) => quoted.body.toLowerCase().includes(e) && !clean.body.toLowerCase().includes(e));
    if (hit) {
      findings.push({
        title: `SQL injection in API parameter (${p})`,
        severity: "critical",
        cwe: "CWE-89",
        location: `${base}${p}?id=1`,
        summary: `A single quote in the 'id' parameter of ${p} surfaced a database error ("${hit}").`,
        remediation: "Use parameterized queries / prepared statements.",
      });
      await deps.onEvent?.({ actor: "tool", level: "crit", msg: `sqli: ${short(base + p)}?id → "${hit}"` });
    }
  }

  if (!findings.length) {
    await deps.onEvent?.({ actor: "system", level: "info", msg: "Stage 3.6 · no authenticated API vulnerabilities detected" });
  }
  return findings;
}
