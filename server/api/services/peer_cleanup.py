"""
peer_cleanup.py — Background asyncio task for inactive peer auto-revocation.

Runs every 6 hours. Any peer whose last WireGuard handshake is older than
30 days (or who has *never* had a handshake and was created > 30 days ago)
is automatically revoked. After revocation, WireGuard is synced to remove
the peer from the tunnel config.

This frees up tunnel IP slots (10.8.0.2–10.8.0.20, max 19) for new players.
Revoked peers can re-register via POST /peers/register with the same name —
the server recycles their old slot and assigns the same tunnel IP.

Start via asyncio.create_task(peer_cleanup_loop()) from the FastAPI lifespan.
"""

import asyncio
import logging
import os
import subprocess
import time
from datetime import datetime, timezone

from database import get_connection
from services.event_bus import broadcast

logger = logging.getLogger(__name__)

# How often the cleanup runs (default: every 6 hours)
CLEANUP_INTERVAL_SECONDS = int(os.getenv("PEER_CLEANUP_INTERVAL", str(6 * 3600)))

# Inactivity threshold before auto-revocation (default: 30 days in seconds)
INACTIVITY_THRESHOLD_SECONDS = int(os.getenv("PEER_INACTIVITY_DAYS", "30")) * 86400


def _get_wg_handshake_map() -> dict[str, int]:
    """Run `wg show wg0 dump` and return a map of public_key → last_handshake_epoch.

    Returns empty dict on failure (container down, wg not available, etc.).
    Only includes peers that have a non-zero handshake timestamp.
    """
    wg_container = os.getenv("WG_CONTAINER", "arma3-wireguard")
    try:
        result = subprocess.run(
            ["docker", "exec", wg_container, "wg", "show", "wg0", "dump"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return {}
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return {}

    handshakes: dict[str, int] = {}
    lines = result.stdout.strip().splitlines()
    if not lines:
        return handshakes

    # Skip interface line (first line), parse peer lines
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        pub_key = parts[0]
        last_hs = int(parts[4]) if parts[4].isdigit() else 0
        if last_hs > 0:
            handshakes[pub_key] = last_hs

    return handshakes


async def cleanup_inactive_peers() -> int:
    """Revoke peers inactive for more than INACTIVITY_THRESHOLD_SECONDS.

    Logic per peer:
      1. If WireGuard has a handshake timestamp → use that.
      2. If no handshake ever recorded → fall back to `created_at` timestamp.
      3. If the relevant timestamp is older than the threshold → revoke.

    Returns:
        Number of peers auto-revoked.
    """
    now_epoch = int(time.time())
    cutoff_epoch = now_epoch - INACTIVITY_THRESHOLD_SECONDS

    # Get current WireGuard handshake data
    wg_handshakes = _get_wg_handshake_map()

    async with get_connection() as conn:
        # Fetch all active (non-revoked) peers
        cursor = await conn.execute(
            "SELECT id, name, public_key, tunnel_ip, created_at FROM peers WHERE revoked = 0"
        )
        rows = await cursor.fetchall()

        if not rows:
            return 0

        to_revoke: list[dict] = []
        now_str = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        for row in rows:
            pub_key = row["public_key"]
            last_activity_epoch: int | None = None

            # Priority 1: WireGuard handshake timestamp
            if pub_key in wg_handshakes:
                last_activity_epoch = wg_handshakes[pub_key]

            # Priority 2: Fall back to created_at (peer never connected)
            if last_activity_epoch is None:
                try:
                    created_dt = datetime.strptime(
                        row["created_at"], "%Y-%m-%d %H:%M:%S"
                    )
                    created_dt = created_dt.replace(tzinfo=timezone.utc)
                    last_activity_epoch = int(created_dt.timestamp())
                except (ValueError, TypeError):
                    # Can't parse created_at — skip this peer (don't revoke what we can't assess)
                    logger.warning(
                        "Peer %s (%s): unparseable created_at '%s' — skipping",
                        row["id"],
                        row["name"],
                        row["created_at"],
                    )
                    continue

            # Check if inactive beyond threshold
            if last_activity_epoch < cutoff_epoch:
                days_inactive = (now_epoch - last_activity_epoch) / 86400
                to_revoke.append(
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "tunnel_ip": row["tunnel_ip"],
                        "days_inactive": round(days_inactive, 1),
                    }
                )

        if not to_revoke:
            return 0

        # Revoke all inactive peers in a single transaction
        for peer in to_revoke:
            await conn.execute(
                "UPDATE peers SET revoked = 1, revoked_at = ? WHERE id = ?",
                (now_str, peer["id"]),
            )
            logger.info(
                "Auto-revoked inactive peer: id=%s name='%s' ip=%s (inactive %.1f days)",
                peer["id"],
                peer["name"],
                peer["tunnel_ip"],
                peer["days_inactive"],
            )
            broadcast(
                "peer_revoked",
                {
                    "peer_id": peer["id"],
                    "name": peer["name"],
                    "reason": f"inactive for {peer['days_inactive']} days (auto-cleanup)",
                },
            )
        await conn.commit()

        # Sync WireGuard to remove revoked peers from tunnel config
        remaining_cursor = await conn.execute(
            "SELECT public_key, tunnel_ip, allowed_ips FROM peers WHERE revoked = 0"
        )
        remaining_rows = await remaining_cursor.fetchall()
        active_peers = [dict(r) for r in remaining_rows]

    # Sync outside the DB context manager
    try:
        from services.wireguard import sync_wireguard

        sync_wireguard(active_peers)
        logger.info(
            "WireGuard synced after auto-cleanup (%d peers revoked)", len(to_revoke)
        )
    except RuntimeError as exc:
        logger.error("WireGuard sync failed after auto-cleanup: %s", exc)

    return len(to_revoke)


async def peer_cleanup_loop() -> None:
    """Infinite loop that runs cleanup_inactive_peers every CLEANUP_INTERVAL_SECONDS."""
    interval_hours = CLEANUP_INTERVAL_SECONDS / 3600
    threshold_days = INACTIVITY_THRESHOLD_SECONDS / 86400
    logger.info(
        "Peer cleanup task started (interval=%.1fh, threshold=%dd)",
        interval_hours,
        threshold_days,
    )
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            count = await cleanup_inactive_peers()
            if count:
                logger.info("Peer cleanup: auto-revoked %d inactive peer(s)", count)
            else:
                logger.debug("Peer cleanup: no inactive peers found")
        except asyncio.CancelledError:
            logger.info("Peer cleanup task cancelled")
            break
        except Exception as exc:  # pragma: no cover
            logger.error("Peer cleanup task error: %s", exc, exc_info=True)
            # Don't crash the loop on transient errors
