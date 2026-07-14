// =============================================================
// scan-worker — consumes 'scan' jobs from BullMQ, runs the agent
// loop, enforces the per-scan cost ceiling, and writes findings.
//
// Job payload (enqueued by Next.js when operator approves a scan):
//   { scanId: string, tenantId: string }
//
// What this worker does on each step:
//   1. Fetch current scan + tenant + remaining budget
//   2. Run one agent step (recon / fuzz / exploit / validate)
//   3. Call LLM through llmCall() — which writes a usage_record
//   4. Update scan.spentUsdCents from the call cost
//   5. Check ceiling: if spent > ceiling → pause scan, alert operator
//   6. Otherwise commit progress + persist any new findings
//   7. Sleep briefly to avoid hammering the proxy, repeat until done
//
// Ceiling logic is intentionally redundant with LiteLLM's tenant
// budget guard: LiteLLM protects the monthly tenant cap; the
// in-worker check protects this individual scan from runaway loops.
// =============================================================

import { Worker, Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PrismaClient, ScanStatus, Severity, FindingStatus } from "@prisma/client";
import { runRecon } from "./recon/agent.js";
import type { ReconResults } from "./recon/tools.js";
import { runPassiveChecks, type PassiveFinding } from "./passive/checks.js";
import { runActiveChecks, type ActiveFinding } from "./active/checks.js";
import { runFormChecks } from "./active/forms.js";
import { runApiTests } from "./active/api.js";
import { runAutonomousScan } from "./autonomous/runner.js";
import { logger } from "./logger.js";

const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SIMULATE = process.env.SIMULATE_LLM === "true";

const QUEUE_NAME = "scans";

// =============================================================
// Process one scan from start to finish. Stage 1 runs real,
// read-only reconnaissance via the recon agent (worker/src/recon).
// =============================================================
async function processScan(job: Job<{ scanId: string; tenantId: string; active?: boolean; resume?: boolean }>) {
  const { scanId, tenantId, active } = job.data;
  const log = logger.child({ scanId, tenantId });

  // Load scan + tenant (system context — no RLS here, this is the worker)
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { tenant: true, target: true },
  });
  if (!scan) throw new Error(`Scan ${scanId} not found`);
  if (scan.status !== ScanStatus.queued) {
    log.warn({ status: scan.status }, "Scan not in queued state, skipping");
    return;
  }

  // Scope authorization (defense in depth): a pentest agent must never touch
  // a target the tenant hasn't proven they own, nor a value that drifted from
  // the current in-scope target. requestScan already blocks unverified
  // targets, but the worker is the thing that makes network calls, so it
  // verifies independently.
  if (!scan.target || !scan.target.verifiedAt) {
    await failScan(scanId, "Target is not verified — refusing to scan");
    log.warn("scan_refused_unverified_target");
    return;
  }
  if (scan.target.value !== scan.targetValue) {
    await failScan(scanId, "Scope target changed since request — refusing to scan");
    log.warn("scan_refused_scope_mismatch");
    return;
  }

  // Get the tenant's virtual key. In production this comes from a
  // secrets manager (Vault, AWS Secrets, Doppler) keyed by
  // tenant.litellmKeyId. For dev we read from env.
  const virtualKey = SIMULATE ? "sim-key" : await loadTenantVirtualKey(tenantId);
  if (!virtualKey) {
    await failScan(
      scanId,
      "Missing tenant LiteLLM virtual key — run scripts/provision-tenant-key.ts"
    );
    return;
  }

  // Retest scans carry kind="retest" + the finding ids to re-verify. Read via
  // raw SQL — the worker's generated client predates these columns.
  let scanKind = "assessment";
  let retestIds: string[] = [];
  try {
    const rows = await prisma.$queryRawUnsafe<
      { kind: string | null; retestFindingIds: string[] | null }[]
    >('SELECT kind, "retestFindingIds" FROM scans WHERE id = $1', scanId);
    if (rows[0]) {
      scanKind = rows[0].kind ?? "assessment";
      retestIds = rows[0].retestFindingIds ?? [];
    }
  } catch {
    /* columns absent on an un-migrated DB — treat as a normal assessment */
  }
  const isRetest = scanKind === "retest";

  // ---- Autonomous skilled-agent mode ----
  // Opt-in via AGENT_MODE=autonomous, OR forced for a retest (re-verification is
  // inherently agent-driven). Drives the egress-locked sandbox using the DB
  // skill catalog. Needs a real virtual key (gated on !SIMULATE) and Docker
  // access in this container (socket mount + docker CLI + the sandbox image).
  if ((process.env.AGENT_MODE === "autonomous" || isRetest) && !SIMULATE) {
    const resume = job.data.resume === true;
    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: ScanStatus.running,
        progress: 5,
        currentStep: resume
          ? "resuming autonomous agent"
          : isRetest
          ? "re-testing prior findings"
          : "launching autonomous agent",
        // Preserve the original start time when resuming.
        ...(resume ? {} : { startedAt: new Date() }),
      },
    });

    // Load the prior findings to re-verify. Preserve retestIds order so the
    // agent's [F#] handles line up with the originals during reconciliation.
    let retestTargets:
      | { id: string; title: string; severity: string; location: string; summary: string }[]
      | undefined;
    if (isRetest && retestIds.length) {
      const rows = await prisma.finding.findMany({
        where: { id: { in: retestIds } },
        select: { id: true, title: true, severity: true, location: true, summary: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      retestTargets = retestIds
        .map((id) => byId.get(id))
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
        .map((f) => ({
          id: f.id,
          title: f.title,
          severity: String(f.severity),
          location: f.location,
          summary: f.summary,
        }));
    }

    log.info({ resume, isRetest }, "autonomous_agent_start");
    const result = await runAutonomousScan({
      prisma,
      scanId,
      tenantId,
      targetUrl: scan.target.value,
      fallbackLocation: scan.targetValue,
      virtualKey,
      // Cap the autonomous run so cost can't silently climb (input tokens
      // dominate). Default $6; raise via AGENT_MAX_BUDGET_USD. Still bounded by
      // the scan's own ceiling.
      budgetCents: Math.min(
        scan.ceilingUsdCents,
        Math.round((Number(process.env.AGENT_MAX_BUDGET_USD) || 6) * 100)
      ),
      model: "vaptbooster-default",
      resume,
      kind: scanKind,
      retestTargets,
    });
    if (result.status === "completed") {
      if (isRetest && retestTargets?.length) {
        // Regression verdict: mark each prior finding fixed vs still-present.
        // Retests are a courtesy re-check — they do NOT consume a plan scan.
        const outcome = await reconcileRetest(scanId, retestTargets);
        await notifyScanRequester(
          scanId,
          "scan_completed",
          `Retest complete — ${outcome.fixed} fixed, ${outcome.present} still present`,
          scan.targetValue
        );
      } else {
        await prisma.tenantBudget
          .update({ where: { tenantId }, data: { creditsUsedThisPeriod: { increment: 1 } } })
          .catch(() => {});
        await notifyScanRequester(
          scanId,
          result.totalFindings > 0 ? "finding_critical" : "scan_completed",
          `Scan completed — ${result.totalFindings} finding${result.totalFindings === 1 ? "" : "s"}`,
          scan.targetValue
        );
      }
    } else {
      await notifyScanRequester(scanId, "scan_failed", "Scan failed", result.error ?? "autonomous agent error");
    }
    await notifyOperatorsOfScanFindings(scanId, scan.target.value);
    log.info(
      { status: result.status, findings: result.totalFindings, spentUsdCents: result.spentCents, resume, isRetest },
      "autonomous_agent_done"
    );
    return;
  }

  // Mark running
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: ScanStatus.running,
      startedAt: new Date(),
      progress: 0,
      currentStep: "Starting up…",
    },
  });

  log.info("scan_started");

  // Live agent transcript — accumulated in memory, flushed to scans.agentLog
  // via raw SQL (the worker's generated client predates this column). This is
  // what the scan page renders as the live "agent ↔ AI" log.
  const agentEvents: { ts: string; actor: string; level: string; msg: string }[] = [];
  const logEvent = async (e: { actor: string; level: string; msg: string }) => {
    agentEvents.push({ ts: new Date().toISOString(), ...e });
    await prisma.$executeRawUnsafe(
      'UPDATE scans SET "agentLog" = $1::jsonb WHERE id = $2',
      JSON.stringify(agentEvents),
      scanId
    );
  };
  const sevLevel = (s: string) =>
    s === "critical" || s === "high" ? "crit" : s === "medium" ? "warn" : "info";

  await logEvent({ actor: "system", level: "info", msg: `scan acquired · target ${scan.target.value}` });
  await logEvent({
    actor: "system",
    level: "info",
    msg: `Stage 1 · reconnaissance — planner: ${SIMULATE ? "deterministic (simulate)" : "Claude (vaptbooster-default)"}`,
  });

  const ceiling = scan.ceilingUsdCents;
  // The recon executor may only touch THIS scan's target (tighter than the
  // tenant's full scope). Domain targets allow their subdomains; url targets
  // are pinned to the single host.
  const scopeAllowlist = [{ type: scan.target.type, value: scan.target.value }];

  // ---- Stage 1: real, read-only reconnaissance ----
  let recon;
  try {
    recon = await runRecon(
      { type: scan.target.type, value: scan.target.value },
      scopeAllowlist,
      {
        tenantId,
        scanId,
        virtualKey,
        model: "vaptbooster-default",
        db: prisma,
        costCeilingCents: ceiling,
        onProgress: async (pct, step) => {
          await prisma.scan.update({
            where: { id: scanId },
            data: { progress: pct, currentStep: step },
          });
        },
        onEvent: logEvent,
      }
    );
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/budget/i.test(msg) || (err as { status?: number }).status === 429) {
      log.warn("tenant budget exceeded — pausing scan");
      await pauseScan(scanId, "tenant_budget_exceeded");
      return;
    }
    await failScan(scanId, `Recon failed: ${msg.slice(0, 120)}`);
    return;
  }

  const spent = scan.spentUsdCents + recon.spentCents;
  await prisma.scan.update({ where: { id: scanId }, data: { spentUsdCents: spent } });

  if (spent > ceiling) {
    log.warn({ spentUsdCents: spent, ceilingUsdCents: ceiling }, "per-scan cost ceiling exceeded");
    await pauseScan(scanId, "cost_ceiling_hit");
    return;
  }

  // ---- Persist recon findings (info severity) ----
  await persistReconFindings(tenantId, scanId, scan.targetValue, recon.results, recon.summary);

  // ---- Stage 2: passive vulnerability detection (deterministic, no LLM) ----
  await prisma.scan.update({
    where: { id: scanId },
    data: { progress: 95, currentStep: "passive vulnerability analysis" },
  });
  await logEvent({
    actor: "system",
    level: "info",
    msg: `Stage 2 · passive vulnerability analysis (deterministic) over ${recon.results.responses.length} responses`,
  });
  const passive = runPassiveChecks(recon.results.responses);
  await persistPassiveFindings(tenantId, scanId, scan.targetValue, passive);
  for (const f of passive) {
    await logEvent({ actor: "system", level: sevLevel(f.severity), msg: `[${f.severity.toUpperCase()}] ${f.title}` });
  }

  // ---- Stage 3: active vulnerability testing (OPT-IN — only with --active) ----
  let activeFindings: ActiveFinding[] = [];
  if (active) {
    await prisma.scan.update({
      where: { id: scanId },
      data: { progress: 98, currentStep: "active vulnerability testing" },
    });
    const scopeLite = [{ type: scan.target.type, value: scan.target.value }];

    // Stage 3 — GET parameter injection (XSS / SQLi).
    activeFindings = await runActiveChecks(scopeLite, [...recon.results.endpoints], {
      onEvent: logEvent,
      maxPoints: 12,
    });

    // Stage 3.5 — POST / form + login testing on likely form pages.
    const formCandidates = [...recon.results.endpoints]
      .filter((u) =>
        /login|signin|sign-in|register|signup|sign-up|forgot|reset|search|contact|feedback|comment|subscribe|account|profile|merchant/i.test(u)
      )
      .slice(0, 10);
    await logEvent({
      actor: "system",
      level: "info",
      msg: `Stage 3.5 · form/auth testing — ${formCandidates.length} candidate page(s)`,
    });
    const formFindings = await runFormChecks(scopeLite, formCandidates, { onEvent: logEvent, maxForms: 8 });

    // Stage 3.6 — JSON API + JWT authenticated testing (broken auth, IDOR, SQLi).
    const apiFindings = await runApiTests(scopeLite, [...recon.results.endpoints], { onEvent: logEvent });

    activeFindings = [...activeFindings, ...formFindings, ...apiFindings];

    // ActiveFinding is structurally identical to PassiveFinding — same persister.
    await persistPassiveFindings(tenantId, scanId, scan.targetValue, activeFindings);
    for (const f of activeFindings) {
      await logEvent({ actor: "system", level: sevLevel(f.severity), msg: `[${f.severity.toUpperCase()}] ${f.title}` });
    }
  }

  const totalVulns = passive.length + activeFindings.length;
  await logEvent({
    actor: "system",
    level: "ok",
    msg: `scan complete · ${totalVulns} vuln findings${active ? " (incl. active)" : ""} · $${((scan.spentUsdCents + recon.spentCents) / 100).toFixed(2)}`,
  });

  // Done — mark completed. Stages 1–2 are read-only; Stage 3 (active) runs only
  // when the scan is launched with --active.
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: ScanStatus.completed,
      completedAt: new Date(),
      progress: 100,
      currentStep: null,
      creditsConsumed: 1,
    },
  });
  await prisma.tenantBudget.update({
    where: { tenantId },
    data: { creditsUsedThisPeriod: { increment: 1 } },
  });

  const bySeverity = passive.reduce<Record<string, number>>((a, f) => {
    a[f.severity] = (a[f.severity] ?? 0) + 1;
    return a;
  }, {});
  log.info(
    {
      spentUsdCents: spent,
      endpoints: recon.results.endpoints.size,
      blocked: recon.results.blocked,
      vulnFindings: passive.length,
      bySeverity,
    },
    "scan_completed"
  );

  await notifyScanRequester(
    scanId,
    totalVulns > 0 ? "finding_critical" : "scan_completed",
    `Scan completed — ${totalVulns} finding${totalVulns === 1 ? "" : "s"}`,
    scan.targetValue
  );
  await notifyOperatorsOfScanFindings(scanId, scan.targetValue);
}

// Persist Stage 2 passive findings (real severities, CWE, remediation).
async function persistPassiveFindings(
  tenantId: string,
  scanId: string,
  fallbackLocation: string,
  findings: PassiveFinding[]
) {
  for (const f of findings) {
    await prisma.finding.create({
      data: {
        tenantId,
        scanId,
        title: f.title,
        summary: f.summary,
        severity: f.severity as Severity,
        status: FindingStatus.open,
        cwe: f.cwe ?? null,
        location: f.location || fallbackLocation,
        remediation: f.remediation ?? null,
        discoveredAt: new Date(),
      },
    });
  }
}

// Persist recon output as info-severity findings (surfaced in the findings UI).
async function persistReconFindings(
  tenantId: string,
  scanId: string,
  location: string,
  r: ReconResults,
  summary: string
) {
  const endpoints = [...r.endpoints];
  const tech = [...r.tech];
  const subs = [...r.subdomains];
  const hosts = [...r.hosts];

  const epList =
    endpoints.slice(0, 25).join("\n") + (endpoints.length > 25 ? `\n… +${endpoints.length - 25} more` : "");
  await prisma.finding.create({
    data: {
      tenantId,
      scanId,
      title: `Reconnaissance completed — ${endpoints.length} endpoints`,
      summary: `${summary}\n\nHosts: ${hosts.join(", ") || "—"}\n\nEndpoints:\n${epList || "—"}`,
      severity: Severity.info,
      status: FindingStatus.open,
      location,
      discoveredAt: new Date(),
    },
  });

  if (tech.length) {
    await prisma.finding.create({
      data: {
        tenantId,
        scanId,
        title: `Technology fingerprint (${tech.length})`,
        summary: tech.join("\n"),
        severity: Severity.info,
        status: FindingStatus.open,
        location,
        discoveredAt: new Date(),
      },
    });
  }

  if (subs.length) {
    await prisma.finding.create({
      data: {
        tenantId,
        scanId,
        title: `Subdomains discovered (${subs.length})`,
        summary: subs.slice(0, 50).join("\n"),
        severity: Severity.info,
        status: FindingStatus.open,
        location,
        discoveredAt: new Date(),
      },
    });
  }
}

// After a retest completes, decide each prior finding's fate: it's still
// present if the agent re-reported it (its [F#] handle appears in a retest-scan
// finding title), otherwise it's verified fixed. Handles map to the targets
// array by position (F1 = targets[0], …).
async function reconcileRetest(
  scanId: string,
  targets: { id: string }[]
): Promise<{ fixed: number; present: number }> {
  const reported = await prisma.finding
    .findMany({ where: { scanId }, select: { title: true } })
    .catch(() => [] as { title: string }[]);
  const stillPresent = new Set<number>();
  for (const f of reported) {
    const m = f.title.match(/\[F(\d+)\]/i);
    if (m) stillPresent.add(Number(m[1]));
  }
  let fixed = 0;
  let present = 0;
  for (let i = 0; i < targets.length; i++) {
    if (stillPresent.has(i + 1)) {
      present++;
      await prisma.finding
        .update({ where: { id: targets[i].id }, data: { status: FindingStatus.open, fixedAt: null } })
        .catch(() => {});
    } else {
      fixed++;
      await prisma.finding
        .update({ where: { id: targets[i].id }, data: { status: FindingStatus.fixed, fixedAt: new Date() } })
        .catch(() => {});
    }
  }
  return { fixed, present };
}

// =============================================================
// Helpers
// =============================================================
async function pauseScan(scanId: string, reason: string) {
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: ScanStatus.paused_ceiling,
      currentStep: reason,
    },
  });
}

async function failScan(scanId: string, reason: string) {
  await prisma.scan.update({
    where: { id: scanId },
    data: {
      status: ScanStatus.failed,
      completedAt: new Date(),
      currentStep: reason,
    },
  });
  await notifyScanRequester(scanId, "scan_failed", "Scan failed", reason);
}

// Notify the scan's requester (in-app). Raw SQL — the worker's generated client
// predates the notifications table.
async function notifyScanRequester(scanId: string, type: string, title: string, body: string) {
  try {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      select: { requesterId: true, tenantId: true },
    });
    if (!scan?.requesterId) return;
    await prisma.$executeRawUnsafe(
      'INSERT INTO notifications (id, "userId", "tenantId", type, title, body, link, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7, now())',
      randomUUID(),
      scan.requesterId,
      scan.tenantId,
      type,
      title,
      body.slice(0, 500),
      `/scans/${scanId}`
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "notify_failed");
  }
}

// Notify every operator about every finding a scan produced (in-app bell).
// Operators triage cross-tenant, so they see all of them. Raw SQL — the
// worker's generated client predates the notifications table.
async function notifyOperatorsOfScanFindings(scanId: string, targetValue: string) {
  try {
    const operators = await prisma.user.findMany({
      where: { role: "operator" },
      select: { id: true },
    });
    if (!operators.length) return;
    const findings = await prisma.finding.findMany({
      where: { scanId },
      select: { id: true, tenantId: true, severity: true, title: true },
    });
    if (!findings.length) return;
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      select: { tenant: { select: { name: true } } },
    });
    const tenantName = scan?.tenant?.name ?? "tenant";

    for (const f of findings) {
      const sev = String(f.severity);
      const type = sev === "critical" || sev === "high" ? "finding_critical" : "finding";
      for (const op of operators) {
        await prisma.$executeRawUnsafe(
          'INSERT INTO notifications (id, "userId", "tenantId", type, title, body, link, "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7, now())',
          randomUUID(),
          op.id,
          f.tenantId,
          type,
          `[${sev.toUpperCase()}] ${f.title}`.slice(0, 200),
          `${tenantName} · ${targetValue}`.slice(0, 500),
          `/operator/findings/${f.id}`
        );
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "notify_operators_failed");
  }
}

async function loadTenantVirtualKey(tenantId: string): Promise<string | null> {
  if (process.env.LITELLM_TENANT_KEY) return process.env.LITELLM_TENANT_KEY;
  // Preferred: the key provisioned via the operator UI, stored on the tenant.
  try {
    const rows = await prisma.$queryRawUnsafe<{ litellmKey: string | null }[]>(
      'SELECT "litellmKey" FROM tenants WHERE id = $1',
      tenantId
    );
    if (rows[0]?.litellmKey) return rows[0].litellmKey;
  } catch {
    /* litellmKey column may be absent on an un-migrated DB — fall through */
  }
  // Fallback: the .secrets bridge file (scripts/provision-tenant-key.ts).
  const candidates = [
    process.env.LITELLM_KEYS_FILE,
    "../.secrets/litellm-keys.json",
    ".secrets/litellm-keys.json",
  ].filter(Boolean) as string[];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const bridge = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
      if (bridge[tenantId]) return bridge[tenantId];
    } catch (err) {
      // Distinguish "no key" from "broken bridge file" for ops.
      logger.warn(
        { path, err: (err as Error).message },
        "litellm_keys_bridge_parse_failed"
      );
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================
// BullMQ worker setup
// =============================================================
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const worker = new Worker(QUEUE_NAME, processScan, {
  connection: connection as unknown as ConnectionOptions,
  concurrency: 4, // run up to 4 scans in parallel
});

worker.on("ready", () =>
  logger.info({ simulate: SIMULATE }, "scan_worker_ready")
);
worker.on("active", (job) => logger.info({ jobId: job.id }, "scan_started"));
worker.on("completed", (job) => logger.info({ jobId: job.id }, "job_completed"));
worker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err: err.message }, "job_failed")
);

// Graceful shutdown
const shutdown = async () => {
  logger.info("shutting_down");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
