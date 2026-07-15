---
name: javascript-analysis
description: Client-side JavaScript & source-map analysis — mine bundles and chunks for hidden endpoints/routes, secrets & API keys, client-only auth logic, DOM-XSS sinks, and postMessage handlers to expand the attack surface far beyond what crawling finds
---

# Client-Side JavaScript Analysis

The front-end bundle is the application's blueprint. Everything the app *can* talk to and *can* do is described in the JavaScript the server hands you: API endpoints, hidden and admin routes, feature flags, role checks, parameter names, third-party keys, and business logic. Reading it turns a black box into a map — you stop guessing paths and start requesting the ones the app already knows about. This is pure recon that runs entirely against the in-scope target: no callbacks, no external services.

Rule of thumb: **before fuzzing for endpoints, read the JS — it usually just tells you.**

## Why It Pays Off

- Reveals endpoints and parameters no crawler or wordlist would find (they're only ever called from JS).
- Exposes **client-side-only** security controls you can bypass by calling the API directly.
- Leaks secrets, internal hostnames, and roles hardcoded by developers.
- Maps the DOM data-flow needed to find DOM-based XSS.
- Source maps often hand you the original commented source.

## Collect Everything (sandbox workflow)

1. Fetch the page(s) and extract every script: `curl -s "$T" | grep -oE '<script[^>]+src="[^"]+"' ` plus inline `<script>` blocks.
2. Download all external JS AND its lazy-loaded chunks. Framework hints:
   - **webpack**: the runtime/`main` bundle contains a chunk map (`{chunkId: "hash"}`) → derive every `/static/js/<id>.<hash>.js`.
   - **Next.js**: `/_next/static/chunks/*`, `/_next/static/<build>/_buildManifest.js` + `_ssgManifest.js` (list every page's chunks), and the inline `__NEXT_DATA__` JSON (props, buildId, query, sometimes API base + PII).
   - **Vite**: `manifest.json`, `assets/*.js`, dynamic `import()` graph.
3. Pull **source maps**: for each `bundle.js`, request `bundle.js.map` (and read the `//# sourceMappingURL=` trailer). A present `.map` reconstructs the original TS/JSX.
4. Normalize: pretty-print with `python3` (or `node`) so regex/reading works on minified code; concatenate all JS into one corpus for grepping.

## What To Mine

### Endpoints & API routes
Grep the corpus for: absolute/relative URLs (`https?://`, `"/api/…"`, `"/v[0-9]/…"`), `fetch(`, `axios.` , `XMLHttpRequest`/`.open(`, `$.ajax`, GraphQL operation strings (`query …`/`mutation …`), and route tables (React Router `path:`, Vue `routes:[…]`, Angular `RouterModule`, `loadChildren`). Build the real endpoint inventory + method + param names.

### Hidden / privileged functionality
Search for `admin`, `/internal`, `debug`, `staging`, `beta`, `feature`/`flag`, `isAdmin`, `hasRole`, `permissions`, `role ===`, gated components, and commented-out or dead routes. Client code frequently ships admin UI + endpoints that the server doesn't actually protect.

### Secrets & API keys
Entropy + provider-specific patterns:
- AWS `AKIA[0-9A-Z]{16}`, Google `AIza[0-9A-Za-z_\-]{35}`, Stripe `sk_live_…` (secret!) vs `pk_live_…` (publishable — not a bug), Slack `xox[baprs]-…`, GitHub `ghp_…`, Sentry DSN, Algolia admin key, Mapbox `sk.…`, Firebase config, JWTs (`eyJ…`), private hostnames, basic-auth in URLs (`https://user:pass@`).
- Grep keys like `apiKey`, `secret`, `token`, `password`, `authorization`, `access_key`, `private`.

### Client-side-only security controls
Auth/authorization decided in JS (route guards, `if(!user.isAdmin) hideButton`), client-side input validation, price/quantity computed client-side, "encryption" done in the browser with an embedded key. Every one of these is bypassable by talking to the API directly.

### Parameters & hidden fields
Undocumented query params, feature toggles read from the URL, mass-assignment field names (the full object the client builds before `POST`), and headers the client sets (`X-…`) — all feed IDOR/BFLA/mass-assignment testing.

### DOM XSS: sources → sinks
- **Sources** (attacker-controllable): `location.*` (hash/search/href), `document.referrer`, `document.URL`, `window.name`, `postMessage` data, `localStorage`/`sessionStorage`.
- **Sinks** (execution): `innerHTML`/`outerHTML`, `document.write`, `eval`, `Function(`, `setTimeout("…")`/`setInterval("…")`, `dangerouslySetInnerHTML`, jQuery `.html()/.append()`, `element.src`, `location=`.
- Trace any source that reaches a sink without encoding → craft a DOM-XSS PoC (payload in the URL/hash that the page executes on load).

### postMessage handlers
Grep `addEventListener("message"` / `onmessage`. Flag handlers that **don't validate `event.origin`** and act on `event.data` (write to DOM, navigate, store tokens) — cross-origin message injection / token theft.

## Source Maps (the jackpot)
A reachable `.map` gives you the original source: comments, developer TODOs, variable names, internal API notes, unminified logic. Reconstruct it (`python3` with a sourcemap parser, or read `sourcesContent` in the JSON directly). Prioritize this — it's the fastest path to understanding auth flows and hidden features.

## From Discovery to Exploit
- Discovered endpoint → test authorization (IDOR/BFLA — see [[idor]]/[[broken_function_level_authorization]]) and injection with the real param names.
- Client-only gate → call the "protected" API directly with a low-priv or no session; if it works, that's broken access control.
- Hardcoded secret → assess scope + blast radius (what it unlocks); confirm it's a *secret* not a *publishable* key.
- Mass-assignment field names → add them to a `PATCH`/`POST` and check for privilege fields (`role`, `isAdmin`, `verified`).
- DOM source→sink → deliver the payload via URL/hash/postMessage and prove execution.

## Sandbox Notes (egress-locked)
- All fetching/grepping is against the in-scope target — fully supported. No internet, so **don't** rely on online beautifiers, wayback/gau, or public key-validation services; do everything with `curl` + `python3` + `grep`/`sed` locally.
- You **cannot** verify an exposed third-party key by calling the provider (no external egress). Report it as an exposure with reasoning about impact; the operator can validate out-of-band.
- `nuclei` has exposure/secret templates that also help, but hand-grepping the concatenated corpus catches app-specific keys nuclei misses.

## Validation
1. A discovered endpoint is a finding only when a request to it demonstrates a real issue (missing authz, injection, data leak) — not merely that it exists.
2. A secret is a finding when its format + context show it's a live credential with reach (not a publishable/public-by-design key). Show where it was found and what it unlocks.
3. A DOM-XSS is confirmed when a controllable source reaches a sink and your payload executes (capture the alert/DOM effect).
4. A client-only control is confirmed by performing the gated action via the API without client-side authorization.

## False Positives
- **Publishable / public-by-design keys**: Stripe `pk_…`, Firebase web config, Google Maps browser keys (referrer-restricted), reCAPTCHA site keys, analytics IDs — intended to ship in the client.
- Example/placeholder/dummy values (`YOUR_API_KEY`, `test_…`, `xxxx`), commented-out dead code, mock endpoints for local dev.
- Source maps intentionally published (still useful for recon, but not a vuln by themselves).
- DOM "sinks" fed only by trusted, non-attacker-controlled data.

## Impact
- Full API/route inventory → far larger, more precise attack surface.
- Credential/secret exposure → external compromise or privilege escalation.
- Broken access control via bypassed client-side gates.
- DOM-based XSS and cross-origin postMessage abuse.
- Business-logic and hidden-feature discovery that no black-box crawl would reach.

## Pro Tips
1. Read the JS **first** — it converts blind fuzzing into targeted requests.
2. Chase source maps before anything else; they're the highest-signal artifact.
3. Enumerate lazy chunks from the webpack/`_buildManifest` map — the juicy admin code is usually in a chunk that only loads for privileged users, but it's still downloadable by you.
4. Every `fetch(`/`axios.` is an endpoint + a method + params — inventory them all.
5. Distinguish secret vs publishable keys precisely, or you'll drown in false positives.
6. Client-side auth is not auth — the moment you see a gate in JS, test the underlying API directly.
7. Concatenate all JS into one corpus and grep once; then pivot into per-file reading for context.

## Summary
The client bundle documents the whole application for you. Collect every script, chunk, and source map; mine them for endpoints, secrets, client-only controls, hidden features, and DOM data-flow; then convert those leads into concrete findings by talking to the API directly and proving impact. It's high-yield, entirely target-side recon — ideal for the sandbox.
