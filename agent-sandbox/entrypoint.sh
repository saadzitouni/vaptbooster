#!/bin/sh
# =============================================================
# Sandbox entrypoint: lock network egress to the scan's scope, then idle.
#
# This is the hard multi-tenant boundary — enforced at the network layer,
# BELOW the app-level scope check, so it holds even if the agent (LLM) is
# prompt-injected or errs. The runner drives the box via `docker exec`.
#
# Target hostnames are pinned to their IPs via --add-host (docker run), so no
# DNS is needed and egress stays restricted to ONLY the allowlisted target IPs.
# =============================================================
set -e

echo "[sandbox] locking egress — allowed target IPs: ${ALLOWED_IPS:-<none>}"

lock_ok=1
if iptables -P OUTPUT DROP 2>/dev/null; then
  iptables -A OUTPUT -o lo -j ACCEPT
  iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  for ip in $ALLOWED_IPS; do
    case "$ip" in *:*) continue ;; esac   # IPv6 handled separately below
    if iptables -A OUTPUT -d "$ip" -j ACCEPT 2>/dev/null; then
      echo "[sandbox]   allow → $ip"
    else
      echo "[sandbox]   WARN: could not add rule for $ip (skipped)"
    fi
  done
  echo "[sandbox] IPv4 egress firewall active (default DROP, allowlist only)"
else
  lock_ok=0
  echo "[sandbox] WARNING: iptables unavailable — egress NOT enforced (needs --cap-add=NET_ADMIN)"
fi

# Block ALL IPv6 egress — the target is pinned over IPv4, so nothing should ever
# leave over IPv6. This closes the v6 escape hatch (defense in depth).
if command -v ip6tables >/dev/null 2>&1 && ip6tables -P OUTPUT DROP 2>/dev/null; then
  ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
  echo "[sandbox] IPv6 egress blocked"
fi

echo "[sandbox] ready — idling for agent commands (egress_enforced=$lock_ok)"
exec sleep infinity
