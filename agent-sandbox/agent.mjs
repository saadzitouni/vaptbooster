// =============================================================
// Scan agent (PoC). In production this is the Claude Agent SDK
// (headless Claude Code) with the mounted skill pack + Burp/Browser
// MCP; it plans and runs recon/exploit steps. Here it's a deterministic
// recon so the sandbox + egress lock can be proven without a key.
//
// If ANTHROPIC_API_KEY is present, this is where you'd hand control to
// the Claude Agent SDK (query({ prompt, mcpServers, ... })) instead.
// =============================================================
import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs";

const TARGET = process.env.TARGET_URL ?? "";
const OUT_OF_SCOPE = (process.env.OUT_OF_SCOPE_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const EGRESS_ENFORCED = process.env.EGRESS_ENFORCED === "1";

async function get(url, ms = 2500) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, redirect: "manual" });
    const body = await r.text().catch(() => "");
    const headers = Object.fromEntries(r.headers.entries());
    return { ok: true, status: r.status, headers, body: body.slice(0, 100_000) };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "blocked_timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

function loadSkillPack() {
  const dir = "/app/skills";
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(`${dir}/${d}/SKILL.md`))
    .map((d) => {
      const md = readFileSync(`${dir}/${d}/SKILL.md`, "utf8");
      const name = (md.match(/name:\s*(.+)/) || [])[1]?.trim() || d;
      return { key: d, name };
    });
}

async function main() {
  const skills = loadSkillPack();
  console.log(`[agent] skill pack: ${skills.map((s) => s.key).join(", ") || "(none)"}`);
  console.log(`[agent] scanning in-scope target: ${TARGET}`);

  // --- recon the in-scope target ---
  const root = await get(TARGET);
  const endpoints = [];
  const tech = [];
  if (root.ok) {
    endpoints.push(TARGET);
    if (root.headers.server) tech.push(`Server: ${root.headers.server}`);
    if (root.headers["x-powered-by"]) tech.push(`X-Powered-By: ${root.headers["x-powered-by"]}`);
    const links = [...(root.body || "").matchAll(/href="([^"#]+)"/g)]
      .map((m) => { try { return new URL(m[1], TARGET).toString(); } catch { return null; } })
      .filter((u) => u && u.startsWith(TARGET));
    for (const l of [...new Set(links)].slice(0, 6)) {
      const r = await get(l);
      if (r.ok) endpoints.push(l);
    }
  }

  // --- prove egress containment: try to reach OUT-OF-SCOPE hosts ---
  const egressTests = [];
  for (const u of OUT_OF_SCOPE) {
    const r = await get(u, 2000);
    egressTests.push({ url: u, reachable: r.ok, detail: r.ok ? `REACHED status ${r.status}` : r.error });
  }
  const leaked = egressTests.filter((e) => e.reachable);

  const findings = {
    scanTarget: TARGET,
    egressEnforced: EGRESS_ENFORCED,
    skillPack: skills,
    recon: {
      reachedTarget: root.ok,
      endpoints,
      tech,
    },
    egressContainment: {
      tested: egressTests,
      verdict: leaked.length === 0 ? "CONTAINED — no out-of-scope host reachable" : "LEAK",
    },
    verdict: root.ok && leaked.length === 0 ? "PASS" : leaked.length ? "FAIL_EGRESS_LEAK" : "FAIL_NO_TARGET",
  };

  // Structured output back to the runner (stdout markers) + optional /out mount.
  try { writeFileSync("/out/findings.json", JSON.stringify(findings, null, 2)); } catch { /* no mount */ }
  console.log("===FINDINGS===");
  console.log(JSON.stringify(findings, null, 2));
  console.log("===END===");
}

main().catch((e) => {
  console.error("[agent] error:", e);
  process.exit(1);
});
