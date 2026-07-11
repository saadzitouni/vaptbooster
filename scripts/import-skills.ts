#!/usr/bin/env tsx
// =============================================================
// import-skills.ts — load the markdown skill playbooks under
// prisma/strix-skills/ into the DB agent skill catalog.
//
// Each .md becomes a skill: methodology/ → strategic (injected every scan),
// everything else → tactical (advertised in the catalog, pulled on demand via
// the load_skill tool). Idempotent + version-bumping like seed-skills.ts, so
// re-running only publishes a new version when a file's content changed.
//
// Also DISABLES the legacy shallow skills so the catalog is the imported set.
//
//   npx tsx scripts/import-skills.ts            (auto-loads .env)
// =============================================================
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { PrismaClient, SkillAltitude } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  try {
    const txt = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}

const SKILLS_DIR = join(process.cwd(), "prisma", "strix-skills");

// Legacy shallow skills (from the first seed) superseded by the imported set.
// NOTE: only keys with NO Strix equivalent — the overlapping keys
// (sql_injection, xss, ssrf, business_logic) are re-imported with the deeper
// Strix content under the SAME key, so they must stay enabled.
const LEGACY_KEYS = [
  "web_app_testing", "recon_mapping", "authn_session", "access_control",
  "injection_advanced", "file_and_path", "api_and_graphql", "info_disclosure_headers",
];

const CATEGORY: Record<string, string> = {
  vulnerabilities: "vulnerability",
  tooling: "tooling",
  protocols: "protocol",
  technologies: "technology",
  frameworks: "framework",
  cloud: "cloud",
  methodology: "methodology",
};

type Parsed = { name: string; description: string; body: string };

function parseMd(md: string): Parsed {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const fm = m ? m[1] : "";
  const body = (m ? m[2] : md).trim();
  const fmName = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  // Prefer the first "# Heading" as the display name; fall back to frontmatter.
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  return { name: heading || fmName, description, body };
}

function collect(dir: string): { key: string; category: string; altitude: string; parsed: Parsed }[] {
  const out: { key: string; category: string; altitude: string; parsed: Parsed }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const category = CATEGORY[entry] ?? entry;
      const altitude = entry === "methodology" ? "strategic" : "tactical";
      for (const file of readdirSync(full)) {
        if (!file.endsWith(".md")) continue;
        let key = file.replace(/\.md$/, "");
        if (entry === "methodology") key = "assessment_methodology";
        const parsed = parseMd(readFileSync(join(full, file), "utf8"));
        if (!parsed.body.trim()) continue;
        out.push({ key, category, altitude, parsed });
      }
    }
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const items = collect(SKILLS_DIR);
  let added = 0, upgraded = 0, unchanged = 0;

  for (const it of items) {
    const altitude = it.altitude === "strategic" ? SkillAltitude.strategic : SkillAltitude.tactical;
    const name = it.parsed.name || it.key;
    const description = it.parsed.description || name;
    const systemPrompt = it.parsed.body;

    const skill = await prisma.skill.upsert({
      where: { key: it.key },
      create: { key: it.key, altitude, category: it.category, enabled: true },
      update: { altitude, category: it.category, enabled: true },
      include: { currentVersion: true },
    });

    const cur = skill.currentVersion;
    const same = cur && cur.name === name && cur.description === description && cur.systemPrompt === systemPrompt;
    if (same) { unchanged++; continue; }

    const maxVer = await prisma.skillVersion.aggregate({ where: { skillId: skill.id }, _max: { versionNumber: true } });
    const nextVer = (maxVer._max.versionNumber ?? 0) + 1;
    const version = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        versionNumber: nextVer,
        name,
        description,
        triggers: description,
        antiTriggers: "",
        systemPrompt,
        payloadSets: {},
        severityMap: {},
        confidenceThreshold: 0.7,
        modelChoice: "vaptbooster-default",
        maxCostUsdCents: 2000,
        safety: { writeMode: false },
        publishedAt: new Date(),
      },
    });
    await prisma.skill.update({ where: { id: skill.id }, data: { currentVersionId: version.id, enabled: true } });
    if (cur) { upgraded++; console.log(`  ↑ ${it.key} (${it.altitude}) v${cur.versionNumber}→v${nextVer}`); }
    else { added++; console.log(`  + ${it.key} (${it.altitude}) v${nextVer}`); }
  }

  const dep = await prisma.skill.updateMany({ where: { key: { in: LEGACY_KEYS }, enabled: true }, data: { enabled: false } });

  console.log(`\ndone — ${added} added, ${upgraded} upgraded, ${unchanged} unchanged; disabled ${dep.count} legacy skill(s).`);
  console.log("edit or roll back any skill at /operator/skills");
  await prisma.$disconnect();
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
