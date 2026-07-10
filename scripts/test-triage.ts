#!/usr/bin/env tsx
// Validates the AI triage flow (mirrors lib/actions/findings.ts analyzeFinding)
// against a real finding: LiteLLM call → JSON parse → persist aiTriage → read back.
//   DATABASE_URL=<owner> LITELLM_BASE_URL=http://localhost:4000 npx tsx scripts/test-triage.ts <findingId>
import { readFileSync } from "fs";
import { join } from "path";

if (!process.env.LITELLM_MASTER_KEY || !process.env.DATABASE_URL) {
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

const TRIAGE_SYSTEM = `You are a senior application-security engineer triaging an AI-produced penetration-test finding. Decide whether it is a real, exploitable vulnerability based ONLY on the evidence provided. Respond with ONLY a JSON object with keys: verdict (true_positive|likely|false_positive), confidence (high|medium|low), severityAssessment, suggestedSeverity (critical|high|medium|low|info), exploitability, howToConfirm, remediation, recommendedAction (confirm|downgrade|duplicate|dismiss), rationale.`;

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const findingId = process.argv[2];
  if (!findingId) throw new Error("usage: test-triage.ts <findingId>");

  const f = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { scan: { select: { targetValue: true, agentLog: true } } },
  });
  if (!f) throw new Error("finding not found");

  const BASE = process.env.LITELLM_BASE_URL || "http://localhost:4000";
  const KEY = process.env.LITELLM_MASTER_KEY!;
  const evidence = JSON.stringify((f.scan as { agentLog?: unknown } | null)?.agentLog ?? []).slice(0, 6000);
  const userPrompt = `Finding: ${f.title}\nSeverity: ${f.severity}\nCWE: ${f.cwe ?? "—"}\nLocation: ${f.location}\nTarget: ${(f.scan as { targetValue?: string } | null)?.targetValue}\n\nEvidence:\n${f.summary}\n\nLog:\n${evidence}`;

  console.log(`→ analyzing "${f.title}" [${f.severity}] via ${BASE}\n`);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "vaptbooster-default",
      messages: [{ role: "system", content: TRIAGE_SYSTEM }, { role: "user", content: userPrompt }],
      temperature: 0.2,
      max_tokens: 900,
    }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content ?? "";

  const match = content.match(/\{[\s\S]*\}/);
  const triage = match ? JSON.parse(match[0]) : { rationale: content };
  triage.model = "vaptbooster-default";
  triage.analyzedAt = new Date().toISOString();

  await prisma.finding.update({ where: { id: findingId }, data: { aiTriage: triage } });

  console.log("VERDICT:      ", triage.verdict, "· confidence", triage.confidence);
  console.log("SUGGESTED SEV:", triage.suggestedSeverity, "(was", f.severity + ")");
  console.log("ACTION:       ", triage.recommendedAction);
  console.log("RATIONALE:    ", triage.rationale);
  console.log("CONFIRM VIA:  ", triage.howToConfirm);

  const back = await prisma.finding.findUnique({ where: { id: findingId }, select: { aiTriage: true } });
  console.log("\npersisted & read back:", !!(back as { aiTriage?: unknown } | null)?.aiTriage ? "OK" : "MISSING");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
