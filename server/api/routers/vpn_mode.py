import logging
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import get_admin_user
from database import get_connection

router = APIRouter(prefix="/admin/vpn-mode", tags=["vpn-mode"])
ARMA3_PORTS = [2302, 2303, 2304, 2305, 2344, 2345]
logger = logging.getLogger(__name__)


class VpnModeRequest(BaseModel):
    mode: str  # 'arma3' oder 'open'


def _apply_iptables(mode: str):
    cmds = [["docker", "exec", "arma3-wireguard", "iptables", "-F", "FORWARD"]]
    if mode == "arma3":
        for port in ARMA3_PORTS:
            cmds.append(
                [
                    "docker",
                    "exec",
                    "arma3-wireguard",
                    "iptables",
                    "-A",
                    "FORWARD",
                    "-i",
                    "wg0",
                    "-o",
                    "wg0",
                    "-p",
                    "udp",
                    "--dport",
                    str(port),
                    "-j",
                    "ACCEPT",
                ]
            )
        cmds.append(
            [
                "docker",
                "exec",
                "arma3-wireguard",
                "iptables",
                "-A",
                "FORWARD",
                "-i",
                "wg0",
                "-o",
                "wg0",
                "-j",
                "DROP",
            ]
        )
    else:
        cmds.append(
            [
                "docker",
                "exec",
                "arma3-wireguard",
                "iptables",
                "-A",
                "FORWARD",
                "-j",
                "ACCEPT",
            ]
        )
    for cmd in cmds:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"iptables error: {result.stderr}")


@router.get("")
async def get_vpn_mode(admin=Depends(get_admin_user)):
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT value FROM app_settings WHERE key = 'vpn_mode'"
        )
        row = await cursor.fetchone()
    return {"mode": row[0] if row else "arma3"}


@router.put("")
async def set_vpn_mode(data: VpnModeRequest, admin=Depends(get_admin_user)):
    """Change VPN mode with audit logging."""
    if data.mode not in ("arma3", "open"):
        raise HTTPException(400, "mode muss arma3 oder open sein")

    # Get old mode for audit log
    async with get_connection() as conn:
        cursor = await conn.execute(
            "SELECT value FROM app_settings WHERE key = 'vpn_mode'"
        )
        old_row = await cursor.fetchone()
        old_mode = old_row[0] if old_row else "arma3"

    try:
        _apply_iptables(data.mode)
    except RuntimeError as e:
        logger.error("Failed to apply iptables rules for mode %s: %s", data.mode, e)
        raise HTTPException(500, str(e))

    async with get_connection() as conn:
        await conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
            "VALUES ('vpn_mode', ?, CURRENT_TIMESTAMP)",
            (data.mode,),
        )
        await conn.commit()

    # Audit log
    logger.info("VPN mode changed: %s → %s by admin", old_mode, data.mode)

    return {"mode": data.mode, "message": f'VPN-Modus auf "{data.mode}" gesetzt'}
