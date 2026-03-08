"""
session_cleanup.py — Background asyncio task for session heartbeat cleanup.

Runs every 30 seconds. Any session that hasn't received a heartbeat within
the last 2 minutes is automatically marked as 'ended'.

Start via asyncio.create_task(cleanup_loop()) from the FastAPI lifespan.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from database import get_connection
from services.event_bus import broadcast

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 30
SESSION_TIMEOUT_MINUTES = 10  # Extended from 2 to 10 minutes for Arma 3 gameplay stability

async def cleanup_expired_sessions() -> int:
    """Mark sessions without heartbeat for > SESSION_TIMEOUT_MINUTES as ended.

    Returns:
        Number of sessions that were marked as ended.
    """
    cutoff = datetime.now(tz=timezone.utc) - timedelta(minutes=SESSION_TIMEOUT_MINUTES)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S")
    ended_at = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    async with get_connection() as conn:
        # Find sessions that timed out
        cursor = await conn.execute(
            """
            SELECT id, peer_id, mission
            FROM sessions
            WHERE active = 1
              AND last_seen IS NOT NULL
              AND last_seen < ?
            """,
            (cutoff_str,),
        )
        rows = await cursor.fetchall()

        if not rows:
            return 0

        session_ids = [row["id"] for row in rows]
        placeholders = ",".join("?" * len(session_ids))

        await conn.execute(
            f"""
            UPDATE sessions
            SET active = 0,
                status = 'ended',
                ended_at = ?
            WHERE id IN ({placeholders})
            """,
            [ended_at, *session_ids],
        )
        await conn.commit()

        # Broadcast session_ended events
        for row in rows:
            broadcast("session_ended", {"session_id": row["id"], "peer_id": row["peer_id"]})
            logger.info("Session %s expired (no heartbeat) → ended", row["id"])

        return len(rows)


async def cleanup_loop() -> None:
    """Infinite loop that runs cleanup_expired_sessions every CLEANUP_INTERVAL_SECONDS."""
    logger.info(
        "Session cleanup task started (interval=%ds, timeout=%dmin)",
        CLEANUP_INTERVAL_SECONDS,
        SESSION_TIMEOUT_MINUTES,
    )
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            count = await cleanup_expired_sessions()
            if count:
                logger.info("Cleanup: ended %d expired session(s)", count)
        except asyncio.CancelledError:
            logger.info("Session cleanup task cancelled")
            break
        except Exception as exc:  # pragma: no cover
            logger.error("Cleanup task error: %s", exc, exc_info=True)
            # Don't crash the loop on transient errors
