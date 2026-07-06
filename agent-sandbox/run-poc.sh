#!/bin/sh
# =============================================================
# Runner PoC — stands in for the VAPTBOOSTER agent-runner:
#   1. (control plane would) resolve the scan's verified scope → IP allowlist
#   2. launch an ephemeral, egress-locked sandbox scoped to the target
#   3. collect the structured findings
#   4. tear the sandbox down
#
# Demo topology: an in-scope "target" + an out-of-scope "honeypot", so we can
# prove the sandbox reaches the target and NOTHING else.
# =============================================================
set -e
NET=poc-net
IMG=vaptbooster-agent-sandbox:latest
SCRIPT_DIR=$(dirname "$0")

cleanup() { docker rm -f poc-target poc-honeypot poc-agent >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

echo "=== provision in-scope target + out-of-scope honeypot ==="
docker run -d --name poc-target   --network "$NET" nginx:alpine >/dev/null
docker run -d --name poc-honeypot --network "$NET" nginx:alpine >/dev/null
docker cp "$SCRIPT_DIR/target-index.html" poc-target:/usr/share/nginx/html/index.html
sleep 1

# The control plane resolves the scan's verified scope → the egress allowlist.
TARGET_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' poc-target)
HONEY_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' poc-honeypot)
echo "  in-scope target      : $TARGET_IP"
echo "  out-of-scope honeypot: $HONEY_IP   (+ internet: 1.1.1.1)"
echo ""

echo "=== launch ephemeral egress-locked agent sandbox (scope = target only) ==="
docker run --rm --name poc-agent --network "$NET" --cap-add=NET_ADMIN \
  -e ALLOWED_IPS="$TARGET_IP" \
  -e TARGET_URL="http://$TARGET_IP/" \
  -e OUT_OF_SCOPE_URLS="http://$HONEY_IP/,http://1.1.1.1/" \
  "$IMG"

echo ""
echo "=== sandbox destroyed (ephemeral). ==="
