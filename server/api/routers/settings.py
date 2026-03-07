"""
settings.py — Admin Settings Router for arma3-session-bridge API.

Endpoints:
  GET /admin/settings  — Get current settings (masked)
  PUT /admin/settings  — Update settings

Requires Admin Bearer JWT for all endpoints.
"""

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_admin_user
from database import get_connection

router = APIRouter(prefix="/admin/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    registration_code_masked: str
    registration_code_preview: str  # first 4 chars visible


class SettingsUpdate(BaseModel):
    registration_code: str


def mask_code(code: str) -> str:
    if len(code) <= 4:
        return "*" * len(code)
    return code[:4] + "*" * (len(code) - 4)


@router.get("", response_model=SettingsResponse)
async def get_settings(admin=Depends(get_admin_user)):
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT value FROM app_settings WHERE key = 'registration_code'"
        )
        row = await cursor.fetchone()

    if row:
        code = row[0]
    else:
        code = os.getenv("PEER_REGISTRATION_CODE", "")

    masked = mask_code(code)
    return SettingsResponse(
        registration_code_masked=masked,
        registration_code_preview=code[:4] if len(code) >= 4 else code,
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
        "masked": mask_code(data.registration_code),
    }
