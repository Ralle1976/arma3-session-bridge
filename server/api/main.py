"""
main.py — FastAPI application entry point for arma3-session-bridge.

Endpoints (skeleton — full implementation in subsequent tasks):
  GET  /health        — liveness probe (public)
  POST /auth/login    — admin JWT login
  --- peers ---
  POST   /peers           — create peer (admin)
  GET    /peers           — list peers (admin)
  GET    /peers/{id}      — get peer (admin)
  DELETE /peers/{id}      — revoke peer (admin)
  GET    /peers/{id}/config — download WireGuard config (admin)
  --- sessions ---
  POST /sessions          — open session (peer JWT)
  PATCH /sessions/{id}    — update session (peer JWT)
  DELETE /sessions/{id}   — close session (peer JWT)
  GET  /sessions          — list active sessions (admin)
  --- admin ---
  GET  /admin/events      — audit log (admin)
  GET  /admin/status      — system status (admin)
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from models import TokenResponse, LoginRequest

# ---------------------------------------------------------------------------
# Auth helpers (JWT)
# ---------------------------------------------------------------------------

from jose import jwt, JWTError
from passlib.context import CryptContext

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 8  # 8 hours

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def _create_token(subject: str, extra: dict | None = None) -> str:
    from datetime import timedelta

    payload = {
        "sub": subject,
        "iat": datetime.now(tz=timezone.utc),
        "exp": datetime.now(tz=timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES),
        **(extra or {}),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET environment variable is required")
    if not ADMIN_PASSWORD:
        raise RuntimeError("ADMIN_PASSWORD environment variable is required")
    await init_db()
    yield


app = FastAPI(
    title="Arma3 Session Bridge API",
    version="0.1.0",
    description="WireGuard peer management and Arma3 session tracking.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    tags=["system"],
    summary="Liveness probe",
    responses={200: {"description": "API is healthy"}},
)
async def health() -> dict:
    """Returns `{"status": "ok"}` — used by Docker health checks and monitoring."""
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@app.post(
    "/auth/login",
    response_model=TokenResponse,
    tags=["auth"],
    summary="Admin login — returns JWT",
)
async def login(body: LoginRequest) -> TokenResponse:
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin password not configured")
    if body.password != ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )
    token = _create_token("admin", {"role": "admin"})
    return TokenResponse(access_token=token)


# ---------------------------------------------------------------------------
# Peers (stub — full implementation in T2)
# ---------------------------------------------------------------------------


@app.post("/peers", tags=["peers"], status_code=501)
async def create_peer():
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.get("/peers", tags=["peers"], status_code=501)
async def list_peers():
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.get("/peers/{peer_id}", tags=["peers"], status_code=501)
async def get_peer(peer_id: int):
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.delete("/peers/{peer_id}", tags=["peers"], status_code=501)
async def revoke_peer(peer_id: int):
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.get("/peers/{peer_id}/config", tags=["peers"], status_code=501)
async def get_peer_config(peer_id: int):
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ---------------------------------------------------------------------------
# Sessions (stub — full implementation in T3)
# ---------------------------------------------------------------------------


@app.post("/sessions", tags=["sessions"], status_code=501)
async def open_session():
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.patch("/sessions/{session_id}", tags=["sessions"], status_code=501)
async def update_session(session_id: int):
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.delete("/sessions/{session_id}", tags=["sessions"], status_code=501)
async def close_session(session_id: int):
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.get("/sessions", tags=["sessions"], status_code=501)
async def list_sessions():
    raise HTTPException(status_code=501, detail="Not implemented yet")


# ---------------------------------------------------------------------------
# Admin (stub — full implementation in T4)
# ---------------------------------------------------------------------------


@app.get("/admin/events", tags=["admin"], status_code=501)
async def list_admin_events():
    raise HTTPException(status_code=501, detail="Not implemented yet")


@app.get("/admin/status", tags=["admin"], status_code=501)
async def admin_status():
    raise HTTPException(status_code=501, detail="Not implemented yet")
