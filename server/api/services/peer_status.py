"""
peer_status.py — In-memory disconnect registry for fast offline detection.

When a client disconnects gracefully, it sends POST /peers/disconnect.
This stores the disconnect timestamp so the server can immediately mark
the peer as offline, rather than waiting for WireGuard's handshake timeout.

If the client crashes without sending the signal, the shortened thresholds
(good < 60s, warning 60-180s, offline > 180s) act as a fallback.
"""

from __future__ import annotations

import threading
import time

# {public_key: disconnect_unix_timestamp}
_disconnect_registry: dict[str, float] = {}
_lock = threading.Lock()


def mark_disconnected(public_key: str) -> None:
    """Record that a peer has explicitly disconnected."""
    with _lock:
        _disconnect_registry[public_key] = time.time()


def clear_disconnect(public_key: str) -> None:
    """Clear disconnect state (called when peer reconnects / re-handshakes)."""
    with _lock:
        _disconnect_registry.pop(public_key, None)


def is_explicitly_disconnected(public_key: str, last_handshake_ts: int) -> bool:
    """Check if peer sent a disconnect signal AFTER their last WG handshake.

    Returns True if the peer explicitly disconnected more recently than
    their last WireGuard handshake — meaning they're definitely offline.
    """
    with _lock:
        disconnect_ts = _disconnect_registry.get(public_key)
    if disconnect_ts is None:
        return False
    # If disconnect timestamp is more recent than last handshake, peer is offline
    return disconnect_ts > last_handshake_ts
