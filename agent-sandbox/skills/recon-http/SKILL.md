---
name: recon_http
altitude: strategic
category: recon
description: Map the HTTP attack surface of an in-scope target — endpoints, parameters, and technology fingerprint.
---

# Recon (HTTP)

You are performing **read-only** reconnaissance of the authorized target. Everything
outside the scan's scope is unreachable at the network layer — do not attempt it.

## When to use
- A scan starts and no prior recon exists for this target.

## Steps
1. Fetch the target root. Record status, headers, and technology signals (Server,
   X-Powered-By, meta generator, framework markers).
2. Extract in-scope links (href/src/action) and crawl them, breadth-first, up to the
   request budget. Stay on the target host.
3. For domain targets, enumerate subdomains via Certificate Transparency (passive).

## Rules
- GET only. No writes, no exploitation — this is recon.
- Respect the per-request rate limit and the per-scan request budget.
- Never follow a redirect or link to an out-of-scope host.

## Output
Structured findings: reached endpoints, technology fingerprint, discovered subdomains.
