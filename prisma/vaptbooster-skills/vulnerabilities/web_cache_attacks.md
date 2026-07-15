---
name: web-cache-attacks
description: Web cache poisoning (unkeyed input, fat GET, parameter cloaking) and web cache deception (path confusion) — persist attacker content or expose private data to other users via a shared cache
---

# Web Cache Poisoning & Deception

A shared cache (CDN, reverse proxy, Varnish, Cloudflare/Akamai/Fastly) serves one stored response to many users. If the cache key omits an input that the origin reflects (poisoning), or if path confusion makes the cache store a private page as if it were a public static asset (deception), one request can compromise every subsequent visitor. Both are one-request, cross-trust-boundary bugs — and both confirm ENTIRELY against the target, so they work inside the egress-locked sandbox with no out-of-band callback.

The whole game is the gap between what the **origin uses** to build a response and what the **cache uses** as the key.

## Attack Surface

Caching is in play when responses carry any of:
- `Age`, `X-Cache: hit|miss`, `X-Cache-Hits`, `CF-Cache-Status`, `X-Served-By`/`X-Cache` (Fastly), `Via`, `X-Varnish`, `X-Drupal-Cache`
- `Cache-Control: public`/`s-maxage`, `Expires`, `ETag` + a CDN `Server`/`Via` banner

Prime targets: pages that **reflect input** (into HTML, headers, redirects, or JS config) AND are cacheable — home/landing pages, error pages, `/`, static-ish HTML, anything behind Cloudflare/Akamai/Fastly/Varnish.

## Reconnaissance

1. **Detect the cache + find a cache oracle.** Request a page twice; look for `Age` incrementing and `X-Cache: hit`. That header pair is your hit/miss oracle for the rest of the test.
2. **Use a cache-buster on every probe.** Add a unique unkeyed query param (e.g. `?cb=RANDOM`) so each experiment gets its own cache entry and you never poison the real page during discovery. Vary the value per index/attempt to keep buckets distinct.
3. **Map keyed vs unkeyed inputs.** Send the SAME `?cb=` twice — once with a candidate header, once without — and diff. If the header changes the response but the SECOND (header-less) request to the same `?cb=` still returns the header-influenced response → the header is **unkeyed** and cached = poisonable.

## Key Vulnerabilities

### Cache poisoning via unkeyed headers
Headers are almost always unkeyed. Test each against a reflecting, cacheable page:
- `X-Forwarded-Host`, `X-Host`, `X-Forwarded-Server`, `Forwarded: host=` → reflected into absolute URLs, `<link>`/`<script src>`, redirects, or password-reset links → poison to an attacker host (steal secrets / import a malicious script).
- `X-Forwarded-Scheme: http` / `X-Forwarded-Proto: http` → force a redirect loop or downgrade cached for everyone.
- `X-Forwarded-For`, `X-Original-URL`, `X-Rewrite-URL`, `X-Forwarded-Prefix` → route/path confusion, reflected debug values.
- Discover more unknown headers by fuzzing: `ffuf`/`wfuzz` a header wordlist (`/usr/share/seclists` — e.g. the param-miner headers list) as `-H "FUZZ: cb-value"` and diff response length/reflection against a `?cb=` baseline (Param-Miner-style, done with the CLI).

### Fat GET / request-body & method confusion
Some caches key on method+path but the origin still reads the GET **body** or a duplicate/override param. Send a GET with a body or a second copy of a param and see if it changes (unkeyed) the cached response.

### Parameter cloaking / cache-key normalization
- Duplicate params (`?x=safe&x=evil`) or alternate delimiters (`;`, `&`, `?`) that the cache and origin parse differently.
- Unkeyed query params the origin reflects but the CDN strips from the key (utm_*, gclid, or app-specific).

### Web cache deception (path confusion)
Make the origin serve a PRIVATE authenticated page while the cache stores it as a public static file, then read it unauthenticated as another user:
- Static-suffix append: `/account/settings` → `/account/settings.css` / `.js` / `.jpg` (origin ignores the suffix and serves the account page; the CDN caches `*.css` as public).
- Path-segment / delimiter tricks: `/account/settings/nonexistent.css`, `;.css`, `%2fnonexistent.css`, `%00.css`, `#`/`?` confusion.
- Confirm the cache stored the private body, then fetch the SAME crafted path with NO session and receive the victim's data.

## Sandbox Workflow (in-band confirmation — no OOB)

1. `curl -s -D- "$T/?cb=$(head -c6 /dev/urandom|base64|tr -dc a-z0-9)" -H 'X-Forwarded-Host: attacker.example'` and check the body/redirect for the injected host + `X-Cache: miss`.
2. Immediately re-request the SAME `?cb=` URL WITHOUT the header. `X-Cache: hit` + the injected host still present = **poisoning confirmed** (it was stored across the trust boundary).
3. For deception: authenticate, `curl` the crafted `*.css` path with the session, confirm private content + `Cache-Control: public`/`X-Cache: miss`; then `curl` the same path with NO cookie → private content served = **deception confirmed**.
4. Use python3/curl only against the in-scope target. Never poison the real production key with a live payload — do discovery on `?cb=` buckets and report the primitive; a single benign proof (e.g. a harmless attacker host in a `<link>`) is enough.

## Validation

1. Impact must cross a trust boundary: a **fresh, clean request from a different "user"** (no header / no cookie / different cache-buster that still hits the poisoned entry) receives the attacker-controlled or private content.
2. Capture both transactions: the poisoning request (miss) and the subsequent clean request (hit) showing the payload persisted.
3. Name the exact unkeyed input (header/param) or deception path, and the concrete impact (script import, open-redirect for all users, secret in a reset link, cross-user data read).
4. Reproduce at least twice; account for short cache TTLs (re-poison if it expired).

## False Positives

- Reflection that is **keyed** (the clean re-request returns the normal response) — no persistence, not a finding.
- `Cache-Control: private`/`no-store` or a `Vary` that includes the input — the cache won't serve it cross-user.
- Deception path returns `404`/`no-store`/a login redirect instead of the private body.
- Self-only impact (you poison only your own cache-buster and nobody else is served it).
- `X-Cache` never shows `hit` for the tested URL → it isn't actually cached.

## Impact

- Stored XSS / malicious script import served to every visitor of a cached page.
- Client-side redirect / host header takeover (poisoned reset links, absolute URLs) → account takeover at scale.
- Cross-user / cross-tenant data disclosure via cache deception (session pages served publicly).
- Persistent DoS (cache a broken/oversized response for all users).

## Pro Tips

1. Always work on `?cb=` buckets during discovery — it's how you test safely without poisoning the live page.
2. Headers are the richest source of unkeyed input; fuzz a header wordlist before hand-testing the classics.
3. Chase reflection into a SINK that matters — an unkeyed header echoed into a comment is nothing; echoed into `<script src>` or a redirect is critical.
4. For deception, enumerate which extensions the CDN treats as static (`.css`/`.js`/`.svg`/`.png`) — one usually slips past.
5. A `Vary` header is the defense; if `Authorization`/cookie isn't in `Vary` on a cached authenticated response, deception is likely.
6. Note the exact CDN (from `Server`/`Via`/`CF-*`) — normalization quirks differ per vendor.

## Summary

Web cache attacks turn one request into a persistent, all-users compromise by exploiting the gap between the origin's inputs and the cache's key. Prove persistence across a trust boundary with a clean follow-up request, keep discovery on cache-buster buckets, and chase reflection into a real sink. No callback infrastructure required — it all confirms against the target.
