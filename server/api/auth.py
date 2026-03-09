"""
auth.py — JWT Auth middleware for arma3-session-bridge API.

Provides:
  - get_admin_user()  → FastAPI dependency that enforces admin JWT
  - create_admin_token() → helper to issue admin tokens

JWT payload structure:
  { "sub": "admin", "role": "admin", "iat": ..., "exp": ... }
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated
from fastapi import Request, Depends, Header, HTTPException, status
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from database import get_connection
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 8  # 8 hours

_bearer_scheme = HTTPBearer(auto_error=True)
logger = logging.getLogger(__name__)


def create_admin_token() -> str:
    """Issue a signed admin JWT token.

    Returns:
        Encoded JWT string.
    """
    _secret = os.getenv("JWT_SECRET", JWT_SECRET)
    if not _secret:
        raise RuntimeError("JWT_SECRET is not configured")

    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, _secret, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT token.

    Args:
        token: Raw JWT string.

    Returns:
        Decoded payload dict.

    Raises:
        HTTPException 401: if token is invalid or expired.
    """
    _secret = os.getenv("JWT_SECRET", JWT_SECRET)
    if not _secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT_SECRET not configured",
        )
    try:
        payload = jwt.decode(token, _secret, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as exc:
        logger.warning("JWT validation failed: %s (token starts with: %s...)", exc, token[:20] if len(token) > 20 else token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_admin_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer_scheme)],
) -> dict:
    """FastAPI dependency: validates admin Bearer JWT.

    Usage:
        @router.get("/protected")
        async def endpoint(admin=Depends(get_admin_user)):
            ...

    Returns:
        Decoded JWT payload dict with role='admin'.

    Raises:
        HTTP 401: if token is missing, invalid, or expired.
        HTTP 403: if role != 'admin'.
    """
    payload = _decode_token(credentials.credentials)
    
    if payload.get("role") != "admin":
        logger.warning(
            "Access denied: non-admin role attempt (role=%s, sub=%s)",
            payload.get("role"),
            payload.get("sub")
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )

    return payload



# ---------------------------------------------------------------------------
# Peer-Registration Auth (separate from admin — limited scope)
# ---------------------------------------------------------------------------


async def get_peer_registrar(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(HTTPBearer(auto_error=False)),
    ] = None,
    x_registration_code: str | None = Header(default=None),
) -> None:
    """FastAPI dependency: accepts either an admin JWT **or** the
    X-Registration-Code header (value = PEER_REGISTRATION_CODE env var).

    Regular players use the registration code — they never need the admin
    password.  This dependency grants NO admin privileges whatsoever.

    Raises:
        HTTP 401: if neither credential is valid.
    """
    # Path 1: X-Registration-Code header — check DB first, then env var
    if x_registration_code:
        async with get_connection() as conn:
            cursor = await conn.execute(
                "SELECT value FROM app_settings WHERE key = 'registration_code'"
            )
            row = await cursor.fetchone()
        reg_code = row[0] if row else os.getenv("PEER_REGISTRATION_CODE", "")
        if reg_code and x_registration_code == reg_code:
            return  # authorised via registration code

    # Path 2: fall back to admin JWT
    if credentials is not None:
        try:
            payload = _decode_token(credentials.credentials)
            if payload.get("role") == "admin":
                return  # authorised via admin JWT
        except HTTPException:
            pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Ungültiger Registrierungs-Code. Bitte den Code vom Admin erfragen.",
        headers={"WWW-Authenticate": "Bearer"},
    )


# ---------------------------------------------------------------------------
# Peer Auth (for authenticated peer endpoints — sessions, heartbeats, etc.)
# ---------------------------------------------------------------------------


async def get_peer_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer_scheme)],
) -> dict:
    """FastAPI dependency: validates peer Bearer JWT (role=peer).

    Also accepts admin tokens (admin can do anything a peer can).

    Returns:
        Decoded JWT payload dict with role='peer' (or 'admin').

    Raises:
        HTTP 401: if token is missing, invalid, or expired.
        HTTP 403: if role is neither 'peer' nor 'admin'.
    """
    payload = _decode_token(credentials.credentials)
    
    role = payload.get("role")
    if role not in ("peer", "admin"):
        logger.warning(
            "Access denied: invalid role (role=%s, sub=%s, expected: peer or admin)",
            role,
            payload.get("sub")
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Peer or admin role required",
        )
    
    return payload
