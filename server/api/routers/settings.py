"""
settings.py — Admin Settings Router for arma3-session-bridge API.

Endpoints:
  GET /admin/settings  — Get current settings (full code for admins)
  PUT /admin/settings  — Update settings

Requires Admin Bearer JWT for all endpoints.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_admin_user
from database import get_connection

router = APIRouter(prefix="/admin/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    registration_code: str          # Vollständiger Code (nur für Admins)
    registration_code_masked: str   # Maskiert (für Logs etc.)
    server_url: str                 # Öffentliche Server-URL


class SettingsUpdate(BaseModel):
    registration_code: str


def mask_code(code: str) -> str:
    if len(code) <= 4:
        return "*" * len(code)
    return code[:4] + "*" * (len(code) - 4)


def get_server_url(request: Request) -> str:
    """Server-URL aus Env oder Request ableiten."""
    env_url = os.getenv("SERVER_PUBLIC_URL", "")
    if env_url:
        return env_url.rstrip("/")
    # Aus Request ableiten (hinter Nginx)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
    scheme = request.headers.get("x-forwarded-proto", "https")
    return f"{scheme}://{host}"


@router.get("", response_model=SettingsResponse)
async def get_settings(request: Request, admin=Depends(get_admin_user)):
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT value FROM app_settings WHERE key = 'registration_code'"
        )
        row = await cursor.fetchone()

    code = row[0] if row else os.getenv("PEER_REGISTRATION_CODE", "")
    return SettingsResponse(
        registration_code=code,
        registration_code_masked=mask_code(code),
        server_url=get_server_url(request),
    )


@router.put("")
async def update_settings(data: SettingsUpdate, admin=Depends(get_admin_user)):
    if len(data.registration_code) < 8:
        raise HTTPException(
            status_code=400,
            detail="Registrierungs-Code muss mindestens 8 Zeichen lang sein",
        )
    async with get_connection() as conn:
        await conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
            "VALUES ('registration_code', ?, CURRENT_TIMESTAMP)",
            (data.registration_code,),
        )
        await conn.commit()
    return {
        "message": "Einstellungen gespeichert",
        "registration_code": data.registration_code,
        "masked": mask_code(data.registration_code),
    }
