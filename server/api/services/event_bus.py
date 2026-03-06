"""
event_bus.py — Simple asyncio pub/sub event bus for arma3-session-bridge.

Used to broadcast admin events (peer_connected, session_created, etc.)
to SSE subscribers without coupling routers together.
"""

import asyncio
from typing import Any

_subscribers: list[asyncio.Queue] = []


def subscribe() -> asyncio.Queue:
    """Register a new SSE subscriber queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    """Remove an SSE subscriber queue."""
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


def broadcast(event_type: str, data: Any) -> None:
    """Push an event to all registered SSE subscribers.

    Drops events for slow subscribers (QueueFull) rather than blocking.
    """
    for q in list(_subscribers):
        try:
            q.put_nowait({"event": event_type, "data": data})
        except asyncio.QueueFull:
            pass  # Drop event rather than block
