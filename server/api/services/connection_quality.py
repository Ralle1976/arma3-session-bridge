"""
connection_quality.py — Canonical VPN connection quality classification.

Single source of truth for quality thresholds and the classify_quality helper.
Both the peers router (user-facing) and admin router (operator-facing) must
use this module instead of inline magic numbers.

Policies
--------
PLAYER: user-facing quality for /peers endpoints.
  Generous thresholds — players have varied connectivity and brief drops are
  normal. A 10-minute handshake window prevents false negatives.
  good    = last_handshake_ago <= 180 s
  warning = 181 s – 600 s
  offline = > 600 s or never connected

ADMIN: operator-facing quality for /admin endpoints.
  Tight thresholds — operators need to detect degraded links early.
  good    = last_handshake_ago <= 60 s
  warning = 61 s – 180 s
  offline = > 180 s or never connected
"""

from __future__ import annotations

from enum import Enum


class QualityPolicy(str, Enum):
    PLAYER = "player"  # /peers endpoints — user-facing, generous thresholds
    ADMIN = "admin"    # /admin endpoints — operator-facing, sensitive thresholds


# (good_max_seconds, warn_max_seconds)
# Handshake age <= good_max  → "good"
# Handshake age <= warn_max  → "warning"
# Handshake age >  warn_max  → "offline"
POLICY_THRESHOLDS: dict[QualityPolicy, tuple[int, int]] = {
    QualityPolicy.PLAYER: (180, 600),
    QualityPolicy.ADMIN:  (60, 180),
}


def classify_quality(
    last_handshake_ago: int | None,
    explicitly_disconnected: bool,
    policy: QualityPolicy,
) -> str:
    """Return connection quality label for a WireGuard peer.

    Args:
        last_handshake_ago: Seconds since last successful WireGuard handshake,
            or None if the peer has never completed a handshake.
        explicitly_disconnected: True if the peer sent a graceful disconnect
            signal via POST /peers/disconnect. Takes priority over handshake age.
        policy: QualityPolicy.PLAYER for user-facing routes,
            QualityPolicy.ADMIN for operator routes.

    Returns:
        "good" | "warning" | "offline"
    """
    if explicitly_disconnected:
        return "offline"

    good_max, warn_max = POLICY_THRESHOLDS[policy]

    if last_handshake_ago is None or last_handshake_ago > warn_max:
        return "offline"
    if last_handshake_ago > good_max:
        return "warning"
    return "good"
