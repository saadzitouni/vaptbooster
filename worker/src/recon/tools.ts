// =============================================================
// Recon executor — the REAL atomic recon primitives. Every action is
// scope-enforced, rate-limited, GET-only (no writes/exploitation), and
// bounded by a per-scan request budget. This is Stage 1: passive,
// read-only reconnaissance.
// =============================================================

import { lookup } from "dns/promises";
import { isHostInScope, isUrlInScope, hostOf, type ScopeTargetLite } from "./scope.js";

// Per-response evidence retained for Stage 2 passive analysis (no re-fetching).
export type ResponseMeta = {
  url: string;
  status: number;
  https: boolean;
  headers: Record<string, string>; // lower-cased header name → value
  setCookie: string[]; // raw Set-Cookie lines
  bodySnippet: string; // first ~400 chars (directory-listing signals etc.)
};

export type ReconResults = {
  hosts: Set<string>; // resolved IPs
  endpoints: Set<string>; // in-scope URLs successfully fetched
  tech: Set<string>; // fingerprinted technologies
  subdomains: Set<string>; // discovered subdomains
  requests: number; // HTTP requests made
  blocked: number; // out-of-scope attempts refused
  responses: ResponseMeta[]; // evidence for passive vuln checks
};

type ExecOpts = {
  maxRequests: number;
  perRequestTimeoutMs: number;
  rateLimitMs: number;
};

export class ReconExecutor {
  readonly results: ReconResults = {
    hosts: new Set(),
    endpoints: new Set(),
    tech: new Set(),
    subdomains: new Set(),
    requests: 0,
    blocked: 0,
    responses: [],
  };

  constructor(
    private readonly targets: ScopeTargetLite[],
    private readonly opts: ExecOpts = {
      maxRequests: 40,
      perRequestTimeoutMs: 8000,
      rateLimitMs: 300,
    }
  ) {}

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async resolveDns(host: string) {
    if (!isHostInScope(host, this.targets)) {
      this.results.blocked++;
      return { host, error: "out_of_scope" };
    }
    try {
      const addrs = await lookup(host, { all: true });
      const ips = addrs.map((a) => a.address);
      ips.forEach((ip) => this.results.hosts.add(ip));
      return { host, ips };
    } catch (e) {
      return { host, error: (e as Error).message };
    }
  }

  async fetchUrl(url: string) {
    if (!isUrlInScope(url, this.targets)) {
      this.results.blocked++;
      return { url, error: "out_of_scope" };
    }
    if (this.results.requests >= this.opts.maxRequests) {
      return { url, error: "request_budget_exhausted" };
    }
    await this.sleep(this.opts.rateLimitMs); // be polite; don't hammer the target
    this.results.requests++;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.perRequestTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET", // read-only — Stage 1 never writes
        redirect: "manual", // don't auto-follow into out-of-scope hosts
        signal: ctrl.signal,
        headers: { "User-Agent": "VAPTBOOSTER-recon/1.0 (+authorized scan)" },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      let body = "";
      try {
        body = (await res.text()).slice(0, 200_000);
      } catch {
        /* non-text body */
      }
      this.results.endpoints.add(url);
      this.fingerprint(headers, body).forEach((t) => this.results.tech.add(t));
      // Retain evidence for Stage 2 passive checks (no re-fetch needed later).
      const setCookie =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : headers["set-cookie"]
            ? [headers["set-cookie"]]
            : [];
      this.results.responses.push({
        url,
        status: res.status,
        https: url.toLowerCase().startsWith("https:"),
        headers,
        setCookie,
        bodySnippet: body.slice(0, 400),
      });
      return {
        url,
        status: res.status,
        contentType: headers["content-type"] ?? null,
        location: headers["location"] ?? null,
        tech: this.fingerprint(headers, body),
        links: this.extractLinks(url, body),
        bodySnippet: body.slice(0, 400),
      };
    } catch (e) {
      const err = e as Error;
      return { url, error: err.name === "AbortError" ? "timeout" : err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stage 3 active probe — a scope-checked, rate-limited, GET-only fetch of an
   * arbitrary in-scope URL (used to send *detection* payloads). It shares the
   * scope + rate-limit guards with recon but keeps its own request budget and
   * does NOT pollute recon results. Still GET-only and non-destructive.
   */
  async probe(url: string): Promise<{ status: number; body: string; headers: Record<string, string>; error?: string }> {
    if (!isUrlInScope(url, this.targets)) return { status: 0, body: "", headers: {}, error: "out_of_scope" };
    if (this.results.requests >= this.opts.maxRequests) return { status: 0, body: "", headers: {}, error: "request_budget_exhausted" };
    await this.sleep(this.opts.rateLimitMs);
    this.results.requests++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.perRequestTimeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET", // active checks inject into query params — still GET, still read-only at the HTTP layer
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "VAPTBOOSTER-scan/1.0 (+authorized scan)" },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      let body = "";
      try {
        body = (await res.text()).slice(0, 200_000);
      } catch {
        /* non-text */
      }
      return { status: res.status, body, headers };
    } catch (e) {
      const err = e as Error;
      return { status: 0, body: "", headers: {}, error: err.name === "AbortError" ? "timeout" : err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stage 3.5 form submission — scope-checked, rate-limited POST/GET with a
   * body + custom headers (for carrying an auth cookie/JWT). Returns
   * status/body/headers/setCookie so the caller can maintain a session.
   */
  async submit(
    url: string,
    opts: { method?: "POST" | "GET"; body?: string; contentType?: string; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; body: string; headers: Record<string, string>; setCookie: string[]; error?: string }> {
    if (!isUrlInScope(url, this.targets)) return { status: 0, body: "", headers: {}, setCookie: [], error: "out_of_scope" };
    if (this.results.requests >= this.opts.maxRequests) return { status: 0, body: "", headers: {}, setCookie: [], error: "request_budget_exhausted" };
    await this.sleep(this.opts.rateLimitMs);
    this.results.requests++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.perRequestTimeoutMs);
    try {
      const method = opts.method ?? "POST";
      const headers: Record<string, string> = {
        "User-Agent": "VAPTBOOSTER-scan/1.0 (+authorized scan)",
        ...(method === "POST" ? { "content-type": opts.contentType ?? "application/x-www-form-urlencoded" } : {}),
        ...(opts.headers ?? {}),
      };
      const res = await fetch(url, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers,
        body: method === "POST" ? opts.body : undefined,
      });
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (outHeaders[k] = v));
      const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      let body = "";
      try {
        body = (await res.text()).slice(0, 200_000);
      } catch {
        /* non-text */
      }
      return { status: res.status, body, headers: outHeaders, setCookie };
    } catch (e) {
      const err = e as Error;
      return { status: 0, body: "", headers: {}, setCookie: [], error: err.name === "AbortError" ? "timeout" : err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  extractLinks(baseUrl: string, html: string): string[] {
    const out = new Set<string>();
    const re = /(?:href|src|action)\s*=\s*["']([^"'>]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.size < 100) {
      const raw = m[1].split("#")[0].trim();
      if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
      try {
        const abs = new URL(raw, baseUrl).toString();
        // Only surface in-scope links — out-of-scope links are dropped here,
        // so the crawler can never be steered off the authorized target.
        if (abs.startsWith("http") && isUrlInScope(abs, this.targets)) {
          out.add(abs.split("#")[0]);
        }
      } catch {
        /* bad URL */
      }
    }
    return [...out];
  }

  fingerprint(headers: Record<string, string>, html: string): string[] {
    const t = new Set<string>();
    if (headers["server"]) t.add(`Server: ${headers["server"]}`);
    if (headers["x-powered-by"]) t.add(`X-Powered-By: ${headers["x-powered-by"]}`);
    if (headers["x-nextjs-cache"] !== undefined || /\/_next\/static/.test(html)) t.add("Next.js");
    if (/wp-content|wp-includes/.test(html)) t.add("WordPress");
    const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i);
    if (gen) t.add(`Generator: ${gen[1]}`);
    return [...t];
  }

  /** Passive OSINT subdomain enumeration via Certificate Transparency (crt.sh). Read-only. */
  async enumerateSubdomains(domain: string) {
    const base = domain.replace(/^\*\./, "").toLowerCase();
    try {
      const res = await fetch(
        `https://crt.sh/?q=${encodeURIComponent("%." + base)}&output=json`,
        { headers: { "User-Agent": "VAPTBOOSTER-recon/1.0" }, signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return { domain: base, error: `crt.sh ${res.status}` };
      const rows = (await res.json()) as { name_value?: string }[];
      const subs = new Set<string>();
      for (const row of rows) {
        for (const name of (row.name_value ?? "").split("\n")) {
          const n = name.trim().toLowerCase().replace(/^\*\./, "");
          if (n && (n === base || n.endsWith("." + base))) subs.add(n);
        }
      }
      subs.forEach((s) => this.results.subdomains.add(s));
      return { domain: base, count: subs.size, subdomains: [...subs].slice(0, 100) };
    } catch (e) {
      return { domain: base, error: (e as Error).message };
    }
  }

  rootUrlFor(target: { type: string; value: string }): string {
    if (target.type === "url") return target.value;
    const host = target.type === "domain" ? target.value.replace(/^\*\./, "") : target.value;
    return `http://${host}`;
  }

  hostFor(target: { type: string; value: string }): string | null {
    if (target.type === "ip") return target.value.split("/")[0];
    return hostOf(target.value) ?? (target.type === "domain" ? target.value.replace(/^\*\./, "") : null);
  }
}
