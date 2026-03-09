#!/usr/bin/env bash
# =============================================================================
# WireGuard Watchdog — Auto-restart on stale handshakes
# =============================================================================
# Runs via cron every 2 minutes. Detects when peers are sending handshake
# initiations but the WireGuard kernel module isn't responding (known bug
# with linuxserver/wireguard in Docker). Restarts the container to fix it.
#
# Logic:
#   1. Skip if container uptime < 3 minutes (give it time to establish)
#   2. Count configured peers (from wg show)
#   3. Check each peer's latest handshake timestamp
#   4. If ANY peer has no handshake (timestamp=0) AND incoming UDP packets
#      are arriving on port 51820 → restart
#   5. If ALL peers have handshakes older than 5 minutes → restart
# =============================================================================

set -euo pipefail

CONTAINER="arma3-wireguard"
LOG_TAG="wg-watchdog"
MAX_HANDSHAKE_AGE=300  # 5 minutes
MIN_UPTIME=180         # 3 minutes — don't restart during initial boot

log() { logger -t "$LOG_TAG" "$1"; echo "$(date '+%Y-%m-%d %H:%M:%S') [$LOG_TAG] $1"; }

# --- Pre-checks ---

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    log "Container $CONTAINER is not running — skipping"
    exit 0
fi

# Container uptime in seconds
STARTED_AT=$(docker inspect "$CONTAINER" --format '{{.State.StartedAt}}')
STARTED_EPOCH=$(date -d "$STARTED_AT" +%s 2>/dev/null || date --date="$STARTED_AT" +%s)
NOW_EPOCH=$(date +%s)
UPTIME=$((NOW_EPOCH - STARTED_EPOCH))

if [ "$UPTIME" -lt "$MIN_UPTIME" ]; then
    log "Container uptime ${UPTIME}s < ${MIN_UPTIME}s — too early, skipping"
    exit 0
fi

# --- Gather peer handshake data ---

HANDSHAKE_DATA=$(docker exec "$CONTAINER" wg show wg0 latest-handshakes 2>/dev/null || true)
if [ -z "$HANDSHAKE_DATA" ]; then
    log "Could not read wg handshakes — skipping"
    exit 0
fi

PEER_COUNT=0
STALE_COUNT=0
NEVER_COUNT=0

while IFS=$'\t' read -r PUBKEY TIMESTAMP; do
    [ -z "$PUBKEY" ] && continue
    PEER_COUNT=$((PEER_COUNT + 1))

    if [ "$TIMESTAMP" = "0" ]; then
        NEVER_COUNT=$((NEVER_COUNT + 1))
        STALE_COUNT=$((STALE_COUNT + 1))
    else
        AGE=$((NOW_EPOCH - TIMESTAMP))
        if [ "$AGE" -gt "$MAX_HANDSHAKE_AGE" ]; then
            STALE_COUNT=$((STALE_COUNT + 1))
        fi
    fi
done <<< "$HANDSHAKE_DATA"

if [ "$PEER_COUNT" -eq 0 ]; then
    log "No peers configured — nothing to watch"
    exit 0
fi

# --- Decision ---

NEEDS_RESTART=false
REASON=""

if [ "$NEVER_COUNT" -gt 0 ]; then
    # Peers with zero handshake — check if UDP is arriving (someone is trying)
    DNAT_COUNTER=$(nft list table ip nat 2>/dev/null | grep "udp dport 51820" | grep -oP 'packets \K[0-9]+' || echo "0")
    if [ "$DNAT_COUNTER" -gt 0 ]; then
        NEEDS_RESTART=true
        REASON="${NEVER_COUNT}/${PEER_COUNT} peers never completed handshake, but ${DNAT_COUNTER} UDP packets arrived (DNAT counter)"
    fi
fi

if [ "$STALE_COUNT" -eq "$PEER_COUNT" ] && [ "$STALE_COUNT" -gt 0 ]; then
    NEEDS_RESTART=true
    REASON="ALL ${PEER_COUNT} peers have stale/missing handshakes (uptime: ${UPTIME}s)"
fi

# --- Act ---

if [ "$NEEDS_RESTART" = true ]; then
    log "RESTARTING: $REASON"
    docker restart "$CONTAINER"
    sleep 5
    # Verify
    NEW_HANDSHAKES=$(docker exec "$CONTAINER" wg show wg0 latest-handshakes 2>/dev/null || echo "unknown")
    log "Post-restart handshakes: $NEW_HANDSHAKES"
else
    log "OK: ${PEER_COUNT} peers, ${STALE_COUNT} stale, ${NEVER_COUNT} never — no action needed"
fi
