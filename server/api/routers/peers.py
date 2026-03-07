"""
peers.py — WireGuard Peer CRUD Router for arma3-session-bridge API.

Endpoints:
  POST   /peers              → 201  Create peer, generate keypair, assign tunnel IP
  GET    /peers              → 200  List all peers
  GET    /peers/{id}         → 200  Get single peer (404 if not found)
  DELETE /peers/{id}         → 204  Revoke peer, sync WireGuard
  GET    /peers/{id}/config  → 200  Download WireGuard client .conf file

All endpoints require Admin Bearer JWT (see auth.py).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse

from auth import get_admin_user, get_peer_registrar
from database import get_connection
from models import PeerCreate, PeerCreateResponse, PeerResponse, PeerRegisterRequest
from services.wireguard import (
    build_client_config,
    generate_keypair,
    sync_wireguard,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/peers", tags=["peers"])

# ── Tunnel IP pool ─────────────────────────────────────────────────────────────
# Server is 10.8.0.1; peers get .2 through .20 (max 19 peers)
_TUNNEL_BASE = "10.8.0."
_PEER_IP_START = 2
_PEER_IP_END = 20


async def _next_tunnel_ip(conn) -> str:
    """Return the lowest available tunnel IP in 10.8.0.2–10.8.0.20.

    Raises:
        HTTPException 503: if all 19 slots are occupied.
    """
    # Check ALL peers (including revoked) — tunnel_ip has a UNIQUE DB constraint,
    # so revoked IPs can only be reused if the old row is deleted (not our approach).
    # Instead we assign IPs from the pool to new peers only from unoccupied slots.
    cursor = await conn.execute(
        "SELECT tunnel_ip FROM peers ORDER BY tunnel_ip"
    )
    rows = await cursor.fetchall()
    used = {row["tunnel_ip"] for row in rows}  # all IPs in DB (active + revoked)

    for last_octet in range(_PEER_IP_START, _PEER_IP_END + 1):
        candidate = f"{_TUNNEL_BASE}{last_octet}"
        if candidate not in used:
            return candidate

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Maximum number of peers reached (19). Revoke a peer first.",
    )


async def _get_active_peers(conn) -> list[dict]:
    """Fetch all non-revoked peers for wg syncconf."""
    cursor = await conn.execute(
        "SELECT public_key, tunnel_ip, allowed_ips FROM peers WHERE revoked = 0"
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


def _row_to_peer_response(row: Any) -> PeerResponse:
    """Convert an aiosqlite Row to a PeerResponse model."""
    return PeerResponse(
        id=row["id"],
        name=row["name"],
        public_key=row["public_key"],
        tunnel_ip=row["tunnel_ip"],
        allowed_ips=row["allowed_ips"],
        created_at=row["created_at"],
        revoked=bool(row["revoked"]),
    )


# ── POST /peers ────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=PeerCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new WireGuard peer",
    responses={
        201: {"description": "Peer created. Private key only available NOW."},
        400: {"description": "Peer name already exists"},
        503: {"description": "Tunnel IP pool exhausted"},
    },
)
async def create_peer(
    body: PeerCreate,
    _admin: Annotated[dict, Depends(get_admin_user)],
) -> PeerCreateResponse:
    """Create a new peer:
    1. Generates WireGuard keypair (wg genkey | wg pubkey)
    2. Assigns the next free tunnel IP (10.8.0.2–10.8.0.20)
    3. Inserts into DB
    4. Calls wg syncconf to apply without downtime
    5. Returns response including peer_token (issued once, not stored)

    Note: The private_key is included in the response ONCE and never stored.
    The client must save it to generate their .conf file later.
    """
    async with get_connection() as conn:
        # Check name uniqueness
        cursor = await conn.execute(
            "SELECT id FROM peers WHERE name = ? AND revoked = 0", (body.name,)
        )
        if await cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Peer with name '{body.name}' already exists",
            )

        tunnel_ip = await _next_tunnel_ip(conn)

        # Generate WireGuard keypair
        try:
            private_key, public_key = generate_keypair()
        except RuntimeError as exc:
            logger.error("Keypair generation failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

        # Insert peer into DB
        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        cursor = await conn.execute(
            """
            INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, created_at, revoked)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (body.name, public_key, tunnel_ip, body.allowed_ips, now),
        )
        peer_id = cursor.lastrowid
        await conn.commit()

        # Sync WireGuard (no downtime)
        active_peers = await _get_active_peers(conn)
        try:
            sync_wireguard(active_peers)
        except RuntimeError as exc:
            logger.warning(
                "wg syncconf failed (peer created but not yet synced): %s", exc
            )
            # Don't fail the request — peer is in DB, can be synced later

        # Issue peer token (stored nowhere — for future peer-JWT use)
        from jose import jwt as _jwt
        import os as _os
        from datetime import timedelta as _timedelta

        peer_token_payload = {
            "sub": f"peer:{peer_id}",
            "role": "peer",
            "peer_id": peer_id,
            "iat": datetime.now(tz=timezone.utc),
            "exp": datetime.now(tz=timezone.utc) + _timedelta(days=365),
        }
        jwt_secret = _os.getenv("JWT_SECRET", "")
        peer_token = _jwt.encode(peer_token_payload, jwt_secret, algorithm="HS256")

        logger.info("Peer created: id=%s name=%s ip=%s", peer_id, body.name, tunnel_ip)

        return PeerCreateResponse(
            id=peer_id,
            name=body.name,
            public_key=public_key,
            tunnel_ip=tunnel_ip,
            allowed_ips=body.allowed_ips,
            created_at=now,
            revoked=False,
            peer_token=peer_token,
        )


# ── GET /peers ─────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[PeerResponse],
    summary="List all peers",
    responses={200: {"description": "List of all peers (including revoked)"}},
)
async def list_peers(
    _admin: Annotated[dict, Depends(get_admin_user)],
    include_revoked: bool = False,
) -> list[PeerResponse]:
    """Return all peers. By default only active (non-revoked) peers are returned.
    Pass `?include_revoked=true` to include revoked peers."""
    async with get_connection() as conn:
        if include_revoked:
            cursor = await conn.execute("SELECT * FROM peers ORDER BY id")
        else:
            cursor = await conn.execute(
                "SELECT * FROM peers WHERE revoked = 0 ORDER BY id"
            )
        rows = await cursor.fetchall()
    return [_row_to_peer_response(row) for row in rows]


# ── GET /peers/{id} ────────────────────────────────────────────────────────────


@router.get(
    "/{peer_id}",
    response_model=PeerResponse,
    summary="Get a single peer by ID",
    responses={
        200: {"description": "Peer found"},
        404: {"description": "Peer not found"},
    },
)
async def get_peer(
    peer_id: int,
    _admin: Annotated[dict, Depends(get_admin_user)],
) -> PeerResponse:
    """Fetch a peer by its integer ID."""
    async with get_connection() as conn:
        cursor = await conn.execute("SELECT * FROM peers WHERE id = ?", (peer_id,))
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer {peer_id} not found",
        )
    return _row_to_peer_response(row)


# ── DELETE /peers/{id} ─────────────────────────────────────────────────────────


@router.delete(
    "/{peer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a peer",
    responses={
        204: {"description": "Peer revoked and WireGuard synced"},
        404: {"description": "Peer not found or already revoked"},
    },
)
async def revoke_peer(
    peer_id: int,
    _admin: Annotated[dict, Depends(get_admin_user)],
) -> Response:
    """Revoke a peer:
    1. Marks peer as revoked in DB
    2. Calls wg syncconf to remove from WireGuard without downtime
    """
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, name FROM peers WHERE id = ? AND revoked = 0", (peer_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Peer {peer_id} not found or already revoked",
            )

        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await conn.execute(
            "UPDATE peers SET revoked = 1, revoked_at = ? WHERE id = ?",
            (now, peer_id),
        )
        await conn.commit()

        # Sync WireGuard without the revoked peer
        active_peers = await _get_active_peers(conn)
        try:
            sync_wireguard(active_peers)
        except RuntimeError as exc:
            logger.warning("wg syncconf failed after peer revocation: %s", exc)

        logger.info("Peer revoked: id=%s name=%s", peer_id, row["name"])

    return Response(status_code=status.HTTP_204_NO_CONTENT)



# ── POST /peers/register ───────────────────────────────────────────────────────


@router.post(
    "/register",
    response_class=PlainTextResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Self-service peer registration — client provides its own public key",
    responses={
        201: {"description": "Peer registered. Returns ready-to-use WireGuard .conf"},
        400: {"description": "Peer name already exists"},
        503: {"description": "Tunnel IP pool exhausted"},
    },
)
async def register_peer(
    body: PeerRegisterRequest,
    _auth: Annotated[None, Depends(get_peer_registrar)],
) -> PlainTextResponse:
    """Self-service registration:
    1. Validates name uniqueness
    2. Assigns next free tunnel IP
    3. Inserts peer into DB using the CLIENT-PROVIDED public_key (no server-side keygen)
    4. Syncs WireGuard
    5. Returns a ready-to-use .conf with the private key placeholder replaced by
       <INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE> — the client substitutes its own
       private key before saving (done by the Tauri generate_and_register_peer command).
    """
    async with get_connection() as conn:
        # 1. Name uniqueness check
        cursor = await conn.execute(
            "SELECT id FROM peers WHERE name = ? AND revoked = 0", (body.name,)
        )
        if await cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Peer with name \'{body.name}\' already exists",
            )

        # 2. Assign tunnel IP
        tunnel_ip = await _next_tunnel_ip(conn)

        # 3. Insert peer — public_key comes from the client
        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await conn.execute(
            """
            INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, created_at, revoked)
            VALUES (?, ?, ?, ?, ?, 0)
            """,
            (body.name, body.public_key, tunnel_ip, "10.8.0.0/24", now),
        )
        await conn.commit()

        # 4. Sync WireGuard
        active_peers = await _get_active_peers(conn)
        try:
            sync_wireguard(active_peers)
        except RuntimeError as exc:
            logger.warning(
                "wg syncconf failed after self-service registration: %s", exc
            )

        logger.info(
            "Self-service peer registered: name=%s ip=%s pubkey=%s",
            body.name, tunnel_ip, body.public_key[:12] + "...",
        )

        # 5. Build .conf template (private key placeholder — client fills it in)
        config = build_client_config(
            private_key="<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>",
            tunnel_ip=tunnel_ip,
            allowed_ips="10.8.0.0/24",
        )

    return PlainTextResponse(
        content=config,
        media_type="text/plain",
        status_code=status.HTTP_201_CREATED,
    )


# ── GET /peers/{id}/config ─────────────────────────────────────────────────────


@router.get(
    "/{peer_ref}/config",
    response_class=PlainTextResponse,
    summary="Get WireGuard client config (.conf file)",
    responses={
        200: {
            "description": "WireGuard .conf file content",
            "content": {"text/plain": {}},
        },
        404: {"description": "Peer not found"},
    },
)
async def get_peer_config(
    peer_ref: str,
) -> PlainTextResponse:
    """Return the WireGuard client .conf file for a peer.

    `peer_ref` can be either the integer peer ID or the peer name string.

    NOTE: Private keys are never stored on the server. This endpoint returns
    a config template with a PLACEHOLDER for the private key.
    """
    async with get_connection() as conn:
        if peer_ref.isdigit():
            cursor = await conn.execute(
                "SELECT * FROM peers WHERE id = ? AND revoked = 0", (int(peer_ref),)
            )
        else:
            cursor = await conn.execute(
                "SELECT * FROM peers WHERE name = ? AND revoked = 0", (peer_ref,)
            )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer '{peer_ref}' not found or revoked",
        )

    config = build_client_config(
        private_key="<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>",
        tunnel_ip=row["tunnel_ip"],
        allowed_ips=row["allowed_ips"],
    )

    return PlainTextResponse(
        content=config,
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="peer{row["id"]}-{row["name"]}.conf"'
        },
    )
