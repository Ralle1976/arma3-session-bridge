"""Session registry endpoints for hosting/joining Arma sessions."""

from __future__ import annotations

import logging
import os
import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt.exceptions import InvalidTokenError as JWTError
from pydantic import BaseModel, Field

from database import get_connection
from models import SessionUpdate
from services.event_bus import broadcast
from services.host_probe import probe_udp

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

_security = HTTPBearer()


async def _require_peer(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> int:
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )

    if payload.get("role") != "peer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Peer token required (role=peer)",
        )

    try:
        return int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Malformed token payload: {exc}",
        )


class SessionCreate(BaseModel):
    mission_name: Optional[str] = Field(None, max_length=128)
    max_players: int = Field(default=10, ge=1, le=256)
    current_players: int = Field(default=0, ge=0, le=256)


class SessionResponse(BaseModel):
    id: int
    host_peer_id: int
    host_tunnel_ip: str
    mission_name: str
    max_players: int
    current_players: int
    status: str
    created_at: str
    last_seen: str


class HeartbeatResponse(BaseModel):
    id: int
    last_seen: str
    status: str


class SessionProbeResponse(BaseModel):
    session_id: int
    host_tunnel_ip: str
    game_port: int
    query_port: int
    reachable: bool
    latency_ms: int | None = None
    probed_port: int | None = None
    error: str | None = None


def _now_utc() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


async def _get_peer_tunnel_ip(peer_id: int) -> str:
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT tunnel_ip FROM peers WHERE id = ? AND revoked = 0",
            (peer_id,),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer {peer_id} not found or revoked",
        )

    return row["tunnel_ip"]


async def _fetch_session(session_id: int) -> dict:
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT
                s.id,
                s.peer_id,
                p.tunnel_ip,
                s.mission_name,
                s.map_name,
                s.max_players,
                s.current_players,
                s.status,
                s.started_at,
                s.last_seen,
                s.active,
                s.ended_at
            FROM sessions s
            JOIN peers p ON p.id = s.peer_id
            WHERE s.id = ?
            """,
            (session_id,),
        )
        row = await cursor.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    return dict(row)


def _row_to_response(row: dict) -> SessionResponse:
    mission_name = row.get("mission_name") or row.get("map_name") or "Untitled Session"
    return SessionResponse(
        id=row["id"],
        host_peer_id=row["peer_id"],
        host_tunnel_ip=row["tunnel_ip"],
        mission_name=mission_name,
        max_players=row.get("max_players", 10),
        current_players=row.get("current_players", 0),
        status=row.get("status", "waiting"),
        created_at=row.get("started_at", ""),
        last_seen=row.get("last_seen", row.get("started_at", "")),
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionResponse,
)
async def create_session(
    body: SessionCreate,
    peer_id: int = Depends(_require_peer),
) -> SessionResponse:
    tunnel_ip = await _get_peer_tunnel_ip(peer_id)
    now = _now_utc()
    initial_players = body.current_players if body.current_players > 0 else 1

    async with get_connection() as conn:
        await conn.execute(
            """
            UPDATE sessions
            SET active = 0,
                status = 'ended',
                ended_at = ?,
                last_seen = ?
            WHERE peer_id = ?
              AND active = 1
            """,
            (now, now, peer_id),
        )
        cursor = await conn.execute(
            """
            INSERT INTO sessions
                (peer_id, mission_name, max_players, current_players,
                 status, started_at, last_seen, active)
            VALUES (?, ?, ?, ?, 'waiting', ?, ?, 1)
            """,
            (
                peer_id,
                body.mission_name,
                body.max_players,
                initial_players,
                now,
                now,
            ),
        )
        await conn.commit()
        session_id = cursor.lastrowid

    broadcast("session_created", {"session_id": session_id, "peer_id": peer_id})
    logger.info("Session %s created by peer %s", session_id, peer_id)

    return SessionResponse(
        id=session_id,
        host_peer_id=peer_id,
        host_tunnel_ip=tunnel_ip,
        mission_name=body.mission_name or "Untitled Session",
        max_players=body.max_players,
        current_players=initial_players,
        status="waiting",
        created_at=now,
        last_seen=now,
    )


@router.get("", response_model=list[SessionResponse])
async def list_sessions() -> list[SessionResponse]:
    async with get_connection() as conn:
        cursor = await conn.execute(
            """
            SELECT
                s.id,
                s.peer_id,
                p.tunnel_ip,
                s.mission_name,
                s.max_players,
                s.current_players,
                s.status,
                s.started_at,
                s.last_seen
            FROM sessions s
            JOIN peers p ON p.id = s.peer_id
            WHERE s.active = 1
            ORDER BY s.started_at DESC
            """,
        )
        rows = await cursor.fetchall()

    return [_row_to_response(dict(row)) for row in rows]


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: int) -> SessionResponse:
    row = await _fetch_session(session_id)
    if not row.get("active"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} is ended",
        )
    return _row_to_response(row)


@router.get("/{session_id}/probe", response_model=SessionProbeResponse)
async def probe_session_host(
    session_id: int,
    game_port: int = Query(2302, ge=1, le=65535),
    query_port: int | None = Query(None, ge=1, le=65535),
    timeout_seconds: float = Query(1.2, ge=0.2, le=10.0),
) -> SessionProbeResponse:
    row = await _fetch_session(session_id)
    if not row.get("active"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} is ended",
        )

    host_ip = row["tunnel_ip"]
    effective_query_port = query_port if query_port is not None else (game_port + 1)

    result = await asyncio.to_thread(
        probe_udp,
        host_ip,
        effective_query_port,
        timeout_seconds,
    )
    probed_port = effective_query_port

    if not result.reachable:
        fallback = await asyncio.to_thread(
            probe_udp,
            host_ip,
            game_port,
            timeout_seconds,
        )
        if fallback.reachable:
            result = fallback
            probed_port = game_port

    return SessionProbeResponse(
        session_id=session_id,
        host_tunnel_ip=host_ip,
        game_port=game_port,
        query_port=effective_query_port,
        reachable=result.reachable,
        latency_ms=result.latency_ms,
        probed_port=probed_port if result.reachable else None,
        error=result.error,
    )


@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: int,
    data: SessionUpdate,
    peer_id: int = Depends(_require_peer),
) -> SessionResponse:
    row = await _fetch_session(session_id)

    if row["peer_id"] != peer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update sessions you created",
        )
    if not row["active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already ended",
        )

    updates: list[str] = []
    values: list[object] = []

    if data.mission_name is not None:
        updates.append("mission_name = ?")
        values.append(data.mission_name)

    if data.map_name is not None:
        updates.append("map_name = ?")
        values.append(data.map_name)

    if data.player_count is not None:
        updates.append("current_players = ?")
        values.append(data.player_count)

    if data.max_players is not None:
        updates.append("max_players = ?")
        values.append(data.max_players)

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one updatable field must be provided",
        )

    values.append(_now_utc())
    values.append(session_id)

    async with get_connection() as conn:
        await conn.execute(
            f"UPDATE sessions SET {', '.join(updates)}, last_seen = ? WHERE id = ?",
            tuple(values),
        )
        await conn.commit()

    updated = await _fetch_session(session_id)
    logger.info("Session %s updated by peer %s", session_id, peer_id)
    return _row_to_response(updated)


@router.put("/{session_id}/heartbeat", response_model=HeartbeatResponse)
async def session_heartbeat(
    session_id: int,
    peer_id: int = Depends(_require_peer),
) -> HeartbeatResponse:
    row = await _fetch_session(session_id)

    if row["peer_id"] != peer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only heartbeat sessions you created",
        )
    if not row["active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already ended",
        )

    now = _now_utc()
    new_status = (
        "active" if row.get("status") == "waiting" else row.get("status", "active")
    )

    async with get_connection() as conn:
        await conn.execute(
            "UPDATE sessions SET last_seen = ?, status = ? WHERE id = ?",
            (now, new_status, session_id),
        )
        await conn.commit()

    return HeartbeatResponse(id=session_id, last_seen=now, status=new_status)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_session(
    session_id: int,
    peer_id: int = Depends(_require_peer),
) -> Response:
    row = await _fetch_session(session_id)

    if row["peer_id"] != peer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only end sessions you created",
        )
    if not row["active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is already ended",
        )

    now = _now_utc()
    async with get_connection() as conn:
        await conn.execute(
            "UPDATE sessions SET active = 0, status = 'ended', ended_at = ?, last_seen = ? WHERE id = ?",
            (now, now, session_id),
        )
        await conn.commit()

    broadcast("session_ended", {"session_id": session_id, "peer_id": peer_id})
    logger.info("Session %s ended by peer %s", session_id, peer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
