"""
wireguard.py — WireGuard service for arma3-session-bridge API.

Responsibilities:
  - generate_keypair()   → (private_key, public_key) via wg genkey | wg pubkey
  - sync_wireguard()     → write wg0.conf + docker exec wg syncconf
  - get_peer_status()    → parse `wg show wg0` output
"""

import base64
import os
import subprocess
import tempfile
from typing import Optional

WG_CONTAINER = os.getenv("WG_CONTAINER", "arma3-wireguard")
WG_SERVER_PUBLIC_KEY = os.getenv("WG_SERVER_PUBLIC_KEY", "")
WG_SERVER_IP = os.getenv("WG_SERVER_IP", "")
WG_LISTEN_PORT = int(os.getenv("WG_LISTEN_PORT", "51820"))
WG_SERVER_TUNNEL_IP = "10.8.0.1"


def generate_keypair() -> tuple[str, str]:
    """Generate a WireGuard keypair using Python cryptography (Curve25519/X25519).

    Does NOT require the wg CLI — keys are generated in-process using the
    same cryptography library already used for JWT signing.

    Returns:
        (private_key, public_key) as base64 strings — WireGuard-compatible format.

    Raises:
        RuntimeError: if key generation fails.
    """
    try:
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding, NoEncryption, PrivateFormat, PublicFormat,
        )
        priv_obj = X25519PrivateKey.generate()
        priv_bytes = priv_obj.private_bytes(
            encoding=Encoding.Raw,
            format=PrivateFormat.Raw,
            encryption_algorithm=NoEncryption(),
        )
        pub_bytes = priv_obj.public_key().public_bytes(
            encoding=Encoding.Raw,
            format=PublicFormat.Raw,
        )
        return base64.b64encode(priv_bytes).decode(), base64.b64encode(pub_bytes).decode()
    except Exception as exc:
        raise RuntimeError(f"WireGuard keypair generation failed: {exc}") from exc


def _build_wg_conf(peers: list[dict]) -> str:
    """Build a wg0.conf content string for the server.

    Args:
        peers: List of peer dicts with keys: public_key, tunnel_ip, allowed_ips

    Returns:
        wg0.conf content as string (Interface section + Peer sections).
    """
    server_private_key = os.getenv("WG_SERVER_PRIVATE_KEY", "")
    lines = [
        "[Interface]",
        f"PrivateKey = {server_private_key}",
        f"Address = {WG_SERVER_TUNNEL_IP}/24",
        f"ListenPort = {WG_LISTEN_PORT}",
        "MTU = 1420",
        "",
    ]
    for peer in peers:
        lines += [
            "[Peer]",
            f"PublicKey = {peer['public_key']}",
            f"AllowedIPs = {peer['tunnel_ip']}/32",
            "",
        ]
    return "\n".join(lines)


def sync_wireguard(peers: list[dict]) -> None:
    """Write wg0.conf and apply it via docker exec wg syncconf.

    Uses `wg syncconf` (no downtime!) instead of restarting the container.
    The config is written to a temp file, copied into the container, then applied.

    Args:
        peers: List of active (non-revoked) peer dicts.

    Raises:
        RuntimeError: if docker exec fails.
    """
    conf_content = _build_wg_conf(peers)

    # Write config to a temp file that will be synced
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".conf", prefix="wg0_", delete=False
    ) as tmp:
        tmp.write(conf_content)
        tmp_path = tmp.name

    try:
        # Copy config file into the container at /tmp/wg0.conf
        cp_result = subprocess.run(
            ["docker", "cp", tmp_path, f"{WG_CONTAINER}:/tmp/wg0.conf"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if cp_result.returncode != 0:
            raise RuntimeError(
                f"docker cp failed (rc={cp_result.returncode}): {cp_result.stderr}"
            )

        # Apply config without restarting (no downtime!)
        sync_result = subprocess.run(
            [
                "docker",
                "exec",
                WG_CONTAINER,
                "wg",
                "syncconf",
                "wg0",
                "/tmp/wg0.conf",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if sync_result.returncode != 0:
            raise RuntimeError(
                f"wg syncconf failed (rc={sync_result.returncode}): {sync_result.stderr}"
            )
    finally:
        import os as _os

        try:
            _os.unlink(tmp_path)
        except OSError:
            pass


def get_peer_status() -> dict[str, dict]:
    """Parse `docker exec wg show wg0` output into a dict keyed by public key.

    Returns:
        Dict mapping public_key → {endpoint, latest_handshake, transfer_rx, transfer_tx}
        Returns empty dict if wg show fails (container not running, etc).
    """
    try:
        result = subprocess.run(
            ["docker", "exec", WG_CONTAINER, "wg", "show", "wg0"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return {}
        return _parse_wg_show(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return {}


def _parse_wg_show(output: str) -> dict[str, dict]:
    """Parse `wg show wg0` text output into structured data.

    Example output:
      interface: wg0
        public key: ...
        private key: (hidden)
        listening port: 51820

      peer: <pubkey>
        endpoint: 1.2.3.4:12345
        allowed ips: 10.8.0.2/32
        latest handshake: 1 minute, 23 seconds ago
        transfer: 1.50 MiB received, 2.30 MiB sent
    """
    result: dict[str, dict] = {}
    current_peer: Optional[str] = None

    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("peer:"):
            current_peer = stripped.split("peer:", 1)[1].strip()
            result[current_peer] = {}
        elif current_peer:
            if stripped.startswith("endpoint:"):
                result[current_peer]["endpoint"] = stripped.split("endpoint:", 1)[
                    1
                ].strip()
            elif stripped.startswith("latest handshake:"):
                result[current_peer]["latest_handshake"] = stripped.split(
                    "latest handshake:", 1
                )[1].strip()
            elif stripped.startswith("transfer:"):
                result[current_peer]["transfer"] = stripped.split("transfer:", 1)[
                    1
                ].strip()
            elif stripped.startswith("allowed ips:"):
                result[current_peer]["allowed_ips"] = stripped.split("allowed ips:", 1)[
                    1
                ].strip()

    return result


def build_client_config(
    private_key: str,
    tunnel_ip: str,
    allowed_ips: str = "10.8.0.0/24",
) -> str:
    """Build a WireGuard client .conf file content.

    Args:
        private_key: Peer's private key (only available at creation time!)
        tunnel_ip: Assigned tunnel IP (e.g. 10.8.0.2)
        allowed_ips: Split-tunnel range (default: 10.8.0.0/24 — NOT 0.0.0.0/0)

    Returns:
        WireGuard client config as string.
    """
    server_pubkey = WG_SERVER_PUBLIC_KEY or os.getenv("WG_SERVER_PUBLIC_KEY", "")
    server_ip = WG_SERVER_IP or os.getenv("WG_SERVER_IP", "")

    return (
        f"[Interface]\n"
        f"PrivateKey = {private_key}\n"
        f"Address = {tunnel_ip}/24\n"
        f"DNS = 1.1.1.1\n"
        f"MTU = 1420\n"
        f"\n"
        f"[Peer]\n"
        f"PublicKey = {server_pubkey}\n"
        f"Endpoint = {server_ip}:{WG_LISTEN_PORT}\n"
        f"AllowedIPs = {allowed_ips}\n"
        f"PersistentKeepalive = 25\n"
    )
