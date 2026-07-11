# syntax=docker/dockerfile:1
# =============================================================
# VAPTBOOSTER autonomous agent sandbox — WEAPONIZED (Kali web arsenal).
#
# One ephemeral container per scan. It carries a full command-line web-pentest
# toolbox and — critically — locks network egress to ONLY the scan's authorized
# target via iptables. The agent "brain" runs on the runner/worker and executes
# every command INSIDE this box via `docker exec`, so even a mis-driven agent
# can never reach an out-of-scope host: the network boundary holds below the app.
#
# GUI tools (Burp, ZAP, dirbuster) are intentionally NOT installed — a headless,
# LLM-driven box can't use them; they would only bloat the image.
#
# The sandbox has NO internet at runtime (egress-locked to the target), so
# everything a tool needs — nuclei templates, wordlists — is baked in here.
# =============================================================
FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/root

# iptables = the egress firewall. The rest is the offensive arsenal.
RUN apt-get update && apt-get install -y --no-install-recommends \
      iptables ca-certificates \
      curl wget jq git bash coreutils grep sed gawk openssl dnsutils netcat-traditional \
      python3 python3-pip python3-requests \
      nmap nikto sqlmap wpscan whatweb commix wfuzz ffuf gobuster dirb feroxbuster \
      sslscan wafw00f wapiti xsser nuclei \
      seclists wordlists \
    && rm -rf /var/lib/apt/lists/*

# Force legacy iptables so the entrypoint's egress lock behaves exactly like the
# previous sandbox and matches the host Docker firewall (Kali defaults to nft).
RUN update-alternatives --set iptables  /usr/sbin/iptables-legacy  || true; \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true

# Bake nuclei templates at BUILD time — no internet at runtime to fetch them.
RUN nuclei -update-templates -silent || nuclei -ut || true

WORKDIR /app
COPY entrypoint.sh ./
COPY skills ./skills
RUN chmod +x entrypoint.sh && mkdir -p /work

# Run with --cap-add=NET_ADMIN so the entrypoint can set the firewall, then it
# idles (sleep) while the runner drives it via `docker exec`.
ENTRYPOINT ["/app/entrypoint.sh"]
