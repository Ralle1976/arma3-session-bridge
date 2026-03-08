"""
peers.py — WireGuard Peer CRUD Router for arma3-session-bridge API.

Endpoints:
  POST   /peers              → 201  Create peer, generate keypair, assign tunnel IP
  GET    /peers              → 200  List all peers
  GET    /peers/{id}         → 200  Get single peer (404 if not found)
  DELETE /peers/{id}         → 204  Revoke peer, sync WireGuard
  GET    /peers/{id}/config  → 200  Download WireGuard client .conf file
  GET    /peers/online       → 200  List currently connected peers (peer JWT)
  GET    /peers/me           → 200  Own peer stats: traffic, quality, handshake (peer JWT)
  POST   /peers/disconnect   → 200  Signal graceful disconnect (peer JWT)

All admin endpoints require Admin Bearer JWT (see auth.py).
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse

from auth import get_admin_user, get_peer_registrar, get_peer_user
from database import get_connection
from models import PeerCreate, PeerCreateResponse, PeerResponse, PeerRegisterRequest
from services.wireguard import (
    build_client_config,
    generate_keypair,
    sync_wireguard,
)
from services.peer_status import is_explicitly_disconnected, mark_disconnected

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/peers", tags=["peers"])


def _issue_peer_token(peer_id: int) -> str:
    """Issue a JWT for peer authentication (sessions, heartbeats)."""
    import os as _os
    from datetime import timedelta as _timedelta
    from jose import jwt as _jwt

    payload = {
        "sub": str(peer_id),
        "role": "peer",
        "peer_id": peer_id,
        "iat": datetime.now(tz=timezone.utc),
        "exp": datetime.now(tz=timezone.utc) + _timedelta(days=365),
    }
    secret = _os.getenv("JWT_SECRET", "")
    return _jwt.encode(payload, secret, algorithm="HS256")

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
    # Only ACTIVE peers consume the live tunnel IP pool.
    # Revoked rows can be recycled in create/register flows.
    cursor = await conn.execute(
        "SELECT tunnel_ip FROM peers WHERE revoked = 0 ORDER BY tunnel_ip"
    )
    rows = await cursor.fetchall()
    used = {row["tunnel_ip"] for row in rows}

    for last_octet in range(_PEER_IP_START, _PEER_IP_END + 1):
        candidate = f"{_TUNNEL_BASE}{last_octet}"
        if candidate not in used:
            return candidate

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Maximum number of ACTIVE peers reached (19).",
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

# ── GET /peers/online ────────────────────────────────────────────────────────────────


def _get_wg_peer_stats_raw() -> list[dict]:
    """Run `wg show wg0 dump` and parse per-peer stats (same logic as admin router)."""
    import subprocess, time as _time, os as _os
    wg_container = _os.getenv("WG_CONTAINER", "arma3-wireguard")
    try:
        result = subprocess.run(
            ["docker", "exec", wg_container, "wg", "show", "wg0", "dump"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []

    peers = []
    lines = result.stdout.strip().splitlines()
    if not lines:
        return peers
    # Skip interface line (first line)
    now = int(_time.time())
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) < 8:
            continue
        pub_key = parts[0]
        last_handshake_ts = int(parts[4]) if parts[4].isdigit() else 0
        last_handshake_ago = (now - last_handshake_ts) if last_handshake_ts > 0 else None

        # Check explicit disconnect registry first
        if is_explicitly_disconnected(pub_key, last_handshake_ts):
            quality = "offline"
        elif last_handshake_ago is None or last_handshake_ago > 180:
            quality = "offline"
        elif last_handshake_ago > 60:
            quality = "warning"
        else:
            quality = "good"

        peers.append({
            "public_key": pub_key,
            "connection_quality": quality,
            "last_handshake_ago": last_handshake_ago,
            "rx_bytes": int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0,
            "tx_bytes": int(parts[6]) if len(parts) > 6 and parts[6].isdigit() else 0,
        })
    return peers


@router.get(
    "/online",
    summary="List currently connected peers (peer JWT required)",
    responses={200: {"description": "List of online peers with name, tunnel IP, and connection quality"}},
)
async def list_online_peers(
    _peer: Annotated[dict, Depends(get_peer_user)],
) -> list[dict]:
    """Return peers currently connected to the WireGuard VPN.

    Joins `wg show wg0 dump` data with the peers DB to resolve names.
    Only returns peers with connection_quality != 'offline'.
    Does NOT expose public keys, endpoints, or transfer stats.
    """
    wg_peers = _get_wg_peer_stats_raw()
    if not wg_peers:
        return []

    # Build pubkey → wg info mapping
    wg_by_pubkey = {p["public_key"]: p for p in wg_peers}

    # Fetch active peers from DB to resolve names and tunnel IPs
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT name, public_key, tunnel_ip FROM peers WHERE revoked = 0"
        )
        rows = await cursor.fetchall()

    online = []
    for row in rows:
        wg_info = wg_by_pubkey.get(row["public_key"])
        if wg_info and wg_info["connection_quality"] != "offline":
            online.append({
                "name": row["name"],
                "tunnel_ip": row["tunnel_ip"],
                "connection_quality": wg_info["connection_quality"],
                "last_handshake_ago": wg_info["last_handshake_ago"],
            })

    return online


# ── GET /peers/me ────────────────────────────────────────────────────────────────────


@router.get(
    "/me",
    summary="Get own peer stats (peer JWT required)",
    responses={200: {"description": "Own peer's traffic, quality, and handshake stats"}},
)
async def get_my_stats(
    peer: Annotated[dict, Depends(get_peer_user)],
) -> dict:
    """Return the calling peer's own WireGuard stats.

    Includes rx/tx bytes, connection quality, last handshake, and tunnel IP.
    Used by the client's Network Dashboard for self-monitoring.
    """
    peer_id = peer.get("peer_id") or peer.get("sub")
    if not peer_id:
        raise HTTPException(status_code=400, detail="Invalid peer token")

    # Look up peer's public key and tunnel IP from DB
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT public_key, tunnel_ip, name FROM peers WHERE id = ? AND revoked = 0",
            (int(peer_id),),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Peer not found")

    # Find this peer's stats in WireGuard dump
    wg_peers = _get_wg_peer_stats_raw()
    wg_info = None
    for wg_peer in wg_peers:
        if wg_peer["public_key"] == row["public_key"]:
            wg_info = wg_peer
            break

    if not wg_info:
        return {
            "name": row["name"],
            "tunnel_ip": row["tunnel_ip"],
            "connection_quality": "offline",
            "last_handshake_ago": None,
            "rx_bytes": 0,
            "tx_bytes": 0,
        }

    return {
        "name": row["name"],
        "tunnel_ip": row["tunnel_ip"],
        "connection_quality": wg_info["connection_quality"],
        "last_handshake_ago": wg_info["last_handshake_ago"],
        "rx_bytes": wg_info["rx_bytes"],
        "tx_bytes": wg_info["tx_bytes"],
    }


# ── POST /peers/disconnect ─────────────────────────────────────────────────────────────


@router.post(
    "/disconnect",
    summary="Signal graceful VPN disconnect (peer JWT required)",
    responses={200: {"description": "Disconnect recorded — peer will appear offline immediately"}},
)
async def peer_disconnect(
    peer: Annotated[dict, Depends(get_peer_user)],
) -> dict:
    """Called by the client before disconnecting the WireGuard tunnel.

    Stores the disconnect timestamp so the online-status logic can
    immediately mark this peer as offline, instead of waiting for the
    WireGuard handshake to time out (up to 3 minutes with shortened thresholds).
    """
    peer_id = peer.get("peer_id") or peer.get("sub")
    if not peer_id:
        raise HTTPException(status_code=400, detail="Invalid peer token")

    # Look up the peer's public key from DB
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT public_key, name FROM peers WHERE id = ? AND revoked = 0",
            (int(peer_id),),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Peer not found")

    mark_disconnected(row["public_key"])
    logger.info("Peer disconnect signal: id=%s name=%s", peer_id, row["name"])
    return {"status": "ok", "message": f"Peer '{row['name']}' marked as disconnected"}


# ── POST /peers ──────────────────────────────────────────────────────────────────────


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
            "SELECT id, revoked FROM peers WHERE name = ?", (body.name,)
        )
        if await cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gerätename '{body.name}' ist bereits vergeben. Wähle einen anderen Namen.",
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

        # Insert or recycle a revoked slot with the same tunnel_ip
        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        recycled = await conn.execute(
            "SELECT id FROM peers WHERE tunnel_ip = ? AND revoked = 1",
            (tunnel_ip,),
        )
        recycled_row = await recycled.fetchone()

        if recycled_row:
            peer_id = recycled_row["id"]
            await conn.execute(
                """
                UPDATE peers
                SET name = ?, public_key = ?, allowed_ips = ?, created_at = ?,
                    revoked = 0, revoked_at = NULL
                WHERE id = ?
                """,
                (body.name, public_key, body.allowed_ips, now, peer_id),
            )
            await conn.commit()
        else:
            try:
                cursor = await conn.execute(
                    """
                    INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, created_at, revoked)
                    VALUES (?, ?, ?, ?, ?, 0)
                    """,
                    (body.name, public_key, tunnel_ip, body.allowed_ips, now),
                )
                peer_id = cursor.lastrowid
                await conn.commit()
            except sqlite3.IntegrityError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Gerätename '{body.name}' ist bereits vergeben. Wähle einen anderen Namen.",
                )

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
        peer_token = _issue_peer_token(peer_id)

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
        # 1. Name uniqueness check — allow re-registration (update public key)
        cursor = await conn.execute(
            "SELECT id, tunnel_ip, revoked FROM peers WHERE name = ?", (body.name,)
        )
        existing = await cursor.fetchone()
        if existing:
            # Re-registration: update public key, revive if revoked, re-sync WireGuard
            peer_id = existing["id"]
            tunnel_ip = existing["tunnel_ip"]
            now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            await conn.execute(
                "UPDATE peers SET public_key = ?, revoked = 0, revoked_at = NULL WHERE id = ?",
                (body.public_key, peer_id),
            )
            await conn.commit()
            active_peers = await _get_active_peers(conn)
            try:
                sync_wireguard(active_peers)
            except RuntimeError as exc:
                logger.warning("wg syncconf failed after re-registration: %s", exc)
            logger.info(
                "Peer re-registered: name=%s ip=%s pubkey=%s",
                body.name, tunnel_ip, body.public_key[:12] + "...",
            )
            config = build_client_config(
                private_key="<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>",
                tunnel_ip=tunnel_ip,
                allowed_ips="10.8.0.0/24",
            )
            # Issue peer JWT for session auth
            peer_token = _issue_peer_token(peer_id)
            return PlainTextResponse(
                content=config,
                media_type="text/plain",
                status_code=status.HTTP_200_OK,
                headers={"X-Peer-Token": peer_token},
            )

        # 2. Assign tunnel IP
        tunnel_ip = await _next_tunnel_ip(conn)

        # 3. Insert peer or recycle revoked slot — public_key comes from the client
        now = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        recycled = await conn.execute(
            "SELECT id FROM peers WHERE tunnel_ip = ? AND revoked = 1",
            (tunnel_ip,),
        )
        recycled_row = await recycled.fetchone()

        if recycled_row:
            peer_id = recycled_row["id"]
            await conn.execute(
                """
                UPDATE peers
                SET name = ?, public_key = ?, allowed_ips = ?, created_at = ?,
                    revoked = 0, revoked_at = NULL
                WHERE id = ?
                """,
                (body.name, body.public_key, "10.8.0.0/24", now, peer_id),
            )
            await conn.commit()
        else:
            cursor = await conn.execute(
                """
                INSERT INTO peers (name, public_key, tunnel_ip, allowed_ips, created_at, revoked)
                VALUES (?, ?, ?, ?, ?, 0)
                """,
                (body.name, body.public_key, tunnel_ip, "10.8.0.0/24", now),
            )
            peer_id = cursor.lastrowid
            if peer_id is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to persist peer id",
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

        # Issue peer JWT for session auth
        peer_token = _issue_peer_token(peer_id)

    return PlainTextResponse(
        content=config,
        media_type="text/plain",
        status_code=status.HTTP_201_CREATED,
        headers={"X-Peer-Token": peer_token},
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
