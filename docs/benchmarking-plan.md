# VAPTBOOSTER — Benchmarking Methodology (investor / marketing grade)

Status: PLAN. Purpose: produce **defensible, reproducible** performance claims about the
autonomous agent that survive technical due diligence. The fastest way to destroy a
benchmark's value is to look rigged — so honesty guardrails are built into the method,
not bolted on.

---

## 0. Headline claims we want to substantiate

Design the whole benchmark backward from the claims we're willing to defend. Templates:

- **Coverage**: "Finds **N%** of known web vulnerabilities across the OWASP Top-10 classes."
- **Precision**: "**P%** of reported findings are true positives (**1 − P** false-positive rate)."
- **Efficiency**: "**$X** and **Y minutes** per target — **F findings per dollar**."
- **Comparative**: "Higher recall than *ZAP/nuclei* at a **lower** false-positive rate on identical targets."
- **Gray-box**: "With client test credentials, recall on access-control/IDOR/business-logic rises from A% to B%."

Every number below feeds one of these. If a metric doesn't support a claim, cut it.

---

## 1. Metrics & definitions (be precise — DD will probe these)

Per target, per run, classify each ground-truth vuln and each reported finding:

- **TP** — a reported finding that maps to a real (planted/known) vuln.
- **FP** — a reported finding that maps to no real vuln.
- **FN** — a real vuln the agent did not report.
- **Recall** = TP / (TP + FN) — *coverage*.
- **Precision** = TP / (TP + FP) — *trust*. **This is the headline metric for a product.**
- **F1** = harmonic mean(recall, precision).
- Report all three **per OWASP class** (SQLi, XSS, IDOR/BOLA, SSRF, auth, access control, …), not just aggregate — aggregates hide weak classes.
- **Cost** = `usage_records` sum per scan (USD). **Time** = `startedAt → completedAt`.
- **Findings-per-dollar** = confirmed TP / cost.
- **Consistency** = mean ± 95% CI of recall/precision across the N repeats.

**Matching rule (decide up front, write it down):** a reported finding matches a
ground-truth vuln when it identifies the **same class at the same location/parameter**.
Class-right but location-wrong = *not* a TP (counts as FP + FN). Document borderline
calls; they are where benchmarks get gamed.

---

## 2. Target corpus (self-hosted → works in the egress-locked sandbox)

All targets self-hosted so scans stay in-scope and reproducible. **Split into TUNING and
HELD-OUT sets. Never tune skills against the held-out set** — this is the credibility
linchpin.

**Tuning set** (used to develop/iterate skills — results NOT published as the benchmark):
- OWASP Juice Shop, DVWA — iterate here freely.

**Held-out benchmark set** (the published numbers come from here; frozen, untouched during tuning):

| Target | Surface | Ground-truth source |
|---|---|---|
| **OWASP Juice Shop** (fresh instance) | Broad OWASP, ~100 challenges | Official scoreboard/challenge JSON |
| **DVWA** (low / medium / high) | Core classes at 3 hardening levels → **bypass depth** | Documented per level |
| **crAPI** and/or **VAmPI** | API: BOLA/IDOR, mass-assignment, JWT | Documented |
| **Damn Vulnerable GraphQL** | GraphQL | Documented |
| **Real app + known CVE** (e.g. pinned old WordPress + a vulnerable plugin, old GitLab) | n-day realism | The CVE advisory |
| **`vulnbank` / `striggers`** (your own) | Your planted bugs | Your curated list |

> If you use Juice Shop in BOTH tuning and held-out, use a *different frozen version pin*
> for held-out and document it. Cleanest is to not reuse the app family across the split.

**Ground truth** for each target is a machine-readable manifest: `[{id, class, location,
param, severity, source}]`. This becomes `benchmarks/<target>/ground-truth.json` when we
build the harness.

---

## 3. Baselines (numbers mean nothing alone)

Run the **same held-out targets** through, with configs documented and published:
- **nuclei** (templated) — the automated-scanner floor.
- **OWASP ZAP baseline scan** — the DAST floor.
- *(Optional, high-value)* one **human pentester** timed pass — the human ceiling + cost anchor.

Comparative claims cite these. Never compare against a strawman config; use each tool's
recommended settings and disclose them.

---

## 4. Run protocol

- **Fixed** model (record which — the operator model picker) and per-scan budget.
- **Both** unauthenticated AND authenticated (client test creds) runs — gray-box is where
  you separate from dumb scanners; report the delta.
- **N = 5** repeats per target/config (LLM non-determinism → report mean ± CI, never a
  single cherry-picked run).
- **Fresh sandbox** per run (already the default — ephemeral, egress-locked).
- Capture per run: findings (DB), cost (`usage_records`), time, and full transcript
  (`agentLog`) for auditability.

---

## 5. Scoring procedure

1. **LLM-judge pass**: for each run, feed the ground-truth list + the scan's findings to a
   judge model; it labels each ground-truth vuln found/missed and each finding TP/FP by the
   matching rule in §1.
2. **Mandatory human adjudication** of a random sample (≥20%) + **all** disputed/borderline
   items. Report judge↔human agreement (inter-rater reliability); if low, adjudicate all.
3. FPs are counted honestly — including duplicate reports, info-severity noise reported as
   vulns, and "the model said it but didn't prove it."
4. Blind where feasible: the judge shouldn't know which findings came from VAPTBOOSTER vs a
   baseline.

---

## 6. Statistical rigor

- Report **mean ± 95% CI** across the N runs, per metric, per class.
- Do **not** report the best run. Report the distribution.
- State N and the CI method. For comparative claims, state whether the difference vs
  baseline is significant given the variance.

---

## 7. Honesty guardrails (what makes it defensible)

A sophisticated investor / customer security team will look for exactly these. Passing them
IS the marketing asset:

- ✅ **Hold-out** targets never used for tuning.
- ✅ **Fair baselines** with published configs.
- ✅ **Precision reported**, not buried — no hiding the false-positive rate.
- ✅ **Cost + time disclosed** per scan.
- ✅ **Non-determinism disclosed** (mean ± CI, N runs).
- ✅ **Failures disclosed** — the classes we're weak on. (Admitting weakness raises
  credibility more than a suspiciously perfect score.)
- ✅ **Reproducibility package**: target versions/pins, ground-truth manifests, agent
  config (model, budget, skill-catalog version/commit), raw findings, scoring rubric.
- ❌ No train-on-test, no strawman baselines, no single-run screenshots, no
  info-findings padding the recall number.

---

## 8. What the platform already provides (future harness spec)

The measurement infra is mostly glue on top of what exists:
- **Findings** — structured `findings` rows per scan (class≈title, severity, location).
- **Cost** — `usage_records` per scan → $/scan directly.
- **Time** — `scans.startedAt/completedAt`.
- **Trace** — `agentLog` per scan for audit + FP adjudication.
- **Controlled inputs** — fixed model (agent-config picker), per-scan budget/ceiling,
  skill-catalog version (git commit of `prisma/vaptbooster-skills`), auth creds (encrypted).

Harness (to build later): `benchmarks/` manifest + ground-truth JSON per target → a runner
that launches N scans per target/config at fixed model+budget → an LLM-judge scorer reading
the findings DB → a scorecard (per-class recall/precision heatmap, $/scan, run variance),
plus the same runner pointed at nuclei/ZAP for the baseline column.

---

## 9. Phased execution

1. **Corpus** — stand up the held-out targets as verified assets; write ground-truth manifests. Freeze versions/pins.
2. **Harness** — manifest + multi-run runner + LLM-judge scorer + scorecard.
3. **Pilot** — one target end-to-end; sanity-check the judge against human labels; fix the matching rule.
4. **Full run** — all targets × {unauth, auth} × N=5; run baselines on the same set.
5. **Report** — scorecard + reproducibility package + the defensible claim set from §0.

---

## 10. Risks / threats to validity

- **Ground-truth incompleteness** — targets may have unknown bugs; a "FP" might be a real
  0-day. Mitigate: manual review of high-confidence "FPs" before counting.
- **Judge error** — LLM-judge mislabels; mitigate with the human sample + IRR.
- **Overfitting to the corpus** — deliberately-vulnerable apps ≠ real production apps;
  caveat the claims and include the real-app+CVE target to counter it.
- **Cost/latency variance** — target responsiveness affects both; run baselines and
  VAPTBOOSTER in the same window/network conditions.
