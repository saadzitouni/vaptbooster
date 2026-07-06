// =============================================================
// Scope guard — the executor's hard authorization boundary. A recon
// action is allowed ONLY if its host is inside the scan's verified scope.
// This is defense-in-depth below the app-level scope check: even if the
// planner (LLM) is tricked or errs, the executor refuses out-of-scope hosts.
// =============================================================

export type ScopeTargetLite = { type: string; value: string };

export function hostOf(u: string): string | null {
  try {
    return new URL(u.includes("://") ? u : `http://${u}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function ipToInt(ip: string): number | null {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr ?? "32");
  const ipI = ipToInt(ip);
  const netI = ipToInt(net);
  if (ipI == null || netI == null || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipI & mask) === (netI & mask);
}

/** True if `host` falls within any of the scan's authorized targets. */
export function isHostInScope(host: string, targets: ScopeTargetLite[]): boolean {
  const h = host.toLowerCase();
  for (const t of targets) {
    if (t.type === "url") {
      const th = hostOf(t.value);
      if (th && th === h) return true;
    } else if (t.type === "domain") {
      // "*.acme.example" or "acme.example" → the apex + any subdomain.
      const base = t.value.replace(/^\*\./, "").toLowerCase();
      if (h === base || h.endsWith("." + base)) return true;
    } else if (t.type === "ip") {
      if (t.value.includes("/")) {
        if (inCidr(h, t.value)) return true;
      } else if (h === t.value.toLowerCase()) return true;
    }
  }
  return false;
}

export function isUrlInScope(url: string, targets: ScopeTargetLite[]): boolean {
  const h = hostOf(url);
  return h ? isHostInScope(h, targets) : false;
}
