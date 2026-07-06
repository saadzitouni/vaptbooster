#!/usr/bin/env tsx
// =============================================================
// seed-skills.ts — install the baseline agent skills into the DB.
//
// Skills are DB content (edited via /operator/skills), not code — so a fresh
// deployment has none. This seeds the baseline methodology the autonomous agent
// loads (loadSkillsFromDb). Idempotent: skips a skill that already has a
// published version, so it never clobbers operator edits.
//
//   DATABASE_URL=<owner> npx tsx scripts/seed-skills.ts
// =============================================================
import { PrismaClient, SkillAltitude } from "@prisma/client";

const prisma = new PrismaClient();

const WEB_APP_TESTING = `You are testing a web application / JSON API for common vulnerabilities, non-destructively, from inside the sandbox. Report every confirmed issue with concrete evidence.

Approach:
1. Recon — fetch the root, follow in-scope links, read JS bundles for API paths. Look for an OpenAPI/Swagger spec (/api/docs, /api/docs/swagger.json, /openapi.json, /swagger.json); if one exists, parse it and drive testing from the exact endpoints and parameters it declares.
2. Authenticate — register a throwaway account, log in, and capture the JWT / session cookie; reuse it on protected endpoints.
3. Test each input with baseline-vs-payload comparison:
   - Reflected XSS: inject a unique canary and confirm it comes back unescaped in an HTML response.
   - SQL injection: append a single quote and look for a DB error the baseline lacked; confirm with boolean logic ('1'='1' vs '1'='2').
   - IDOR / BOLA: with your session, change an object id (e.g. /accounts/1 -> /accounts/2) and check whether you can read another user's record.
   - Broken auth: hit protected endpoints with NO token and with a FORGED token; if they still return data, auth/JWT verification is broken.
4. Report each confirmed finding with severity, CWE, the exact request, and remediation.

Rules: only the authorized target is in scope; detection payloads only (never move money, delete/modify real data, or DoS); creating one throwaway account to authenticate is allowed.`;

const SKILLS = [
  {
    key: "web_app_testing",
    altitude: SkillAltitude.strategic,
    category: "web",
    name: "Web application testing",
    description: "End-to-end methodology for testing a web app / API for common vulnerabilities (OpenAPI-first).",
    triggers: "A web application or JSON API is in scope and needs a full assessment.",
    antiTriggers: "Pure network/infrastructure targets with no HTTP surface.",
    systemPrompt: WEB_APP_TESTING,
  },
];

async function main() {
  for (const s of SKILLS) {
    const existing = await prisma.skill.findUnique({ where: { key: s.key }, include: { currentVersion: true } });
    if (existing?.currentVersion) {
      console.log(`  = ${s.key} (already published — skipped)`);
      continue;
    }
    const skill = existing ?? (await prisma.skill.create({ data: { key: s.key, altitude: s.altitude, category: s.category, enabled: true } }));
    const version = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        versionNumber: 1,
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        antiTriggers: s.antiTriggers,
        systemPrompt: s.systemPrompt,
        payloadSets: {},
        severityMap: {},
        confidenceThreshold: 0.7,
        modelChoice: "vaptbooster-default",
        maxCostUsdCents: 1000,
        safety: { writeMode: false },
        publishedAt: new Date(),
      },
    });
    await prisma.skill.update({ where: { id: skill.id }, data: { currentVersionId: version.id, enabled: true } });
    console.log(`  + ${s.key} v1 published`);
  }
  console.log("done — edit further at /operator/skills");
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
