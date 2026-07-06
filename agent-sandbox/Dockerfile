# syntax=docker/dockerfile:1
# =============================================================
# VAPTBOOSTER autonomous agent sandbox.
#
# One ephemeral container per scan. It carries a real pentest toolbox and —
# critically — locks network egress to ONLY the scan's authorized target via
# iptables. The agent "brain" runs on the runner (host) and executes every
# command INSIDE this box via `docker exec`, so even a mis-driven agent can
# never reach an out-of-scope host: the network boundary holds below the app.
# =============================================================
FROM node:22-alpine

# iptables = the egress firewall. The rest is the agent's toolbox — enough for
# Claude to do real web recon + testing (curl + python cover almost everything;
# it can write scripts for the rest).
RUN apk add --no-cache \
      iptables ca-certificates \
      curl wget jq \
      python3 py3-pip py3-requests \
      bind-tools bash coreutils openssl grep sed

WORKDIR /app
COPY entrypoint.sh ./
COPY skills ./skills
RUN chmod +x entrypoint.sh && mkdir -p /work

# Run with --cap-add=NET_ADMIN so the entrypoint can set the firewall, then it
# idles (sleep) while the runner drives it via `docker exec`.
ENTRYPOINT ["/app/entrypoint.sh"]
