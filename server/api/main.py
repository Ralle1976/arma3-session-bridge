from fastapi import FastAPI
import logging

from database import get_connection, init_db
from services.wireguard import sync_wireguard

logger = logging.getLogger(__name__)

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Startup WireGuard sync
    try:
        async with get_connection() as conn:
            cursor = await conn.execute(
                "SELECT public_key, tunnel_ip, allowed_ips FROM peers WHERE revoked = 0"
            )
            rows = await cursor.fetchall()
            active_peers = [dict(row) for row in rows]
        if active_peers:
            sync_wireguard(active_peers)
            logger.info(
                "Startup WireGuard sync: %d active peer(s) synced", len(active_peers)
            )
        else:
            logger.info("Startup WireGuard sync: no active peers in DB")
    except Exception as exc:
        logger.warning("Startup WireGuard sync failed (non-fatal): %s", exc)
    yield
    # No shutdown tasks in this minimal implementation


app = FastAPI(lifespan=lifespan)
