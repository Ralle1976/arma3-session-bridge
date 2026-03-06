"""
models.py — Pydantic models for arma3-session-bridge API.

Three domain models matching the SQLite schema:
  - Peer        (WireGuard peer / game server node)
  - Session     (active Arma3 mission session reported by a peer)
  - AdminEvent  (audit log entry written by admin actions)
"""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Peer
# ---------------------------------------------------------------------------


class PeerBase(BaseModel):
    name: str = Field(
        ..., min_length=1, max_length=64, description="Human-readable peer name"
    )
    allowed_ips: str = Field(
        default="10.8.0.0/24",
        description="Split-tunnel AllowedIPs — only route the VPN subnet",
    )


class PeerCreate(PeerBase):
    pass


class PeerResponse(PeerBase):
    id: int
    public_key: str
    tunnel_ip: str
    created_at: str
    revoked: bool

    class Config:
        from_attributes = True


class PeerCreateResponse(PeerResponse):
    """Returned only once after creation — includes the pre-shared peer JWT token."""

    peer_token: str


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------


class SessionBase(BaseModel):
    mission: Optional[str] = Field(
        None, max_length=128, description="Mission file name"
    )
    map_name: Optional[str] = Field(
        None, max_length=64, description="ArmA map identifier"
    )
    player_count: int = Field(default=0, ge=0, le=256)


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    mission: Optional[str] = Field(None, max_length=128)
    map_name: Optional[str] = Field(None, max_length=64)
    player_count: Optional[int] = Field(None, ge=0, le=256)


class SessionResponse(SessionBase):
    id: int
    peer_id: int
    started_at: str
    ended_at: Optional[str] = None
    active: bool

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# AdminEvent
# ---------------------------------------------------------------------------


class AdminEventBase(BaseModel):
    event_type: str = Field(..., max_length=64)
    detail: Optional[str] = Field(None, max_length=512)
    actor: str = Field(default="admin", max_length=64)


class AdminEventResponse(AdminEventBase):
    id: int
    created_at: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
