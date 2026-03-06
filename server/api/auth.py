"""
auth.py — JWT Auth middleware for arma3-session-bridge API.

Provides:
  - get_admin_user()  → FastAPI dependency that enforces admin JWT
  - create_admin_token() → helper to issue admin tokens

JWT payload structure:
  { "sub": "admin", "role": "admin", "iat": ..., "exp": ... }
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 8  # 8 hours

_bearer_scheme = HTTPBearer(auto_error=True)


def create_admin_token() -> str:
    """Issue a signed admin JWT token.

    Returns:
        Encoded JWT string.
    """
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not configured")

    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": "admin",
        "role": "admin",
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT token.

    Args:
        token: Raw JWT string.

    Returns:
        Decoded payload dict.

    Raises:
        HTTPException 401: if token is invalid or expired.
    """
    if not JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT_SECRET not configured",
        )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError as exc:
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )

    return payload
