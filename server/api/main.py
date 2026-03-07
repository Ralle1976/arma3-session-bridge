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
  GET  /sessions          — list active sessions (public)
  DELETE /sessions/{id}   — close session (peer JWT)
  PUT  /sessions/{id}/heartbeat — update heartbeat (peer JWT)
  --- admin ---
  GET  /admin/stats   — system statistics (admin JWT)
  GET  /admin/events  — SSE stream of live events (admin JWT)
"""

import asyncio
import os
import time
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
    return jwt.encode(payload, os.getenv("JWT_SECRET", JWT_SECRET), algorithm=JWT_ALGORITHM)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

_cleanup_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cleanup_task

    _jwt_secret = os.getenv("JWT_SECRET", "")
    _admin_pw = os.getenv("ADMIN_PASSWORD", "")
    if not _jwt_secret:
        raise RuntimeError("JWT_SECRET environment variable is required")
    if not _admin_pw:
        raise RuntimeError("ADMIN_PASSWORD environment variable is required")

    await init_db()

    # Record server start time for uptime calculations
    from routers.admin import set_server_start_time
    set_server_start_time(time.time())

    # Start background session cleanup task
    from services.session_cleanup import cleanup_loop
    _cleanup_task = asyncio.create_task(cleanup_loop())

    yield

    # Shutdown: cancel cleanup task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass


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
# Include routers
# ---------------------------------------------------------------------------

from routers.peers import router as peers_router
from routers.sessions import router as sessions_router
from routers.admin import router as admin_router
from routers.settings import router as settings_router
from routers.vpn_mode import router as vpn_mode_router

app.include_router(peers_router)
app.include_router(sessions_router)
app.include_router(admin_router)
app.include_router(settings_router)
app.include_router(vpn_mode_router)


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
    _admin_pw = os.getenv("ADMIN_PASSWORD", ADMIN_PASSWORD)
    if not _admin_pw:
        raise HTTPException(status_code=503, detail="Admin password not configured")
    if body.password != _admin_pw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )
    token = _create_token("admin", {"role": "admin"})
    return TokenResponse(access_token=token)


# Peers router is included above via app.include_router(peers_router)
