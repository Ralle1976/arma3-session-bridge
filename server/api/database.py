"""
database.py — SQLite WAL-Mode Setup for arma3-session-bridge API.

Uses aiosqlite for async access. WAL mode is enabled for concurrent reads
from multiple coroutines without blocking writers.
"""

import aiosqlite
import os
from pathlib import Path

DB_PATH = Path(os.getenv("DB_PATH", "/app/data/arma3.db"))


async def get_connection() -> aiosqlite.Connection:
    """Open an aiosqlite connection with WAL mode enabled."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(str(DB_PATH))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    await conn.commit()
    return conn


async def init_db() -> None:
    """Create all tables on startup if they don't exist."""
    async with await get_connection() as conn:
        await conn.executescript("""
            CREATE TABLE IF NOT EXISTS peers (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL UNIQUE,
                public_key  TEXT    NOT NULL UNIQUE,
                tunnel_ip   TEXT    NOT NULL UNIQUE,
                allowed_ips TEXT    NOT NULL DEFAULT '10.8.0.0/24',
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                revoked_at  TEXT,
                revoked     INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id     INTEGER NOT NULL REFERENCES peers(id),
                mission     TEXT,
                map_name    TEXT,
                player_count INTEGER NOT NULL DEFAULT 0,
                started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                ended_at    TEXT,
                active      INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS admin_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type  TEXT    NOT NULL,
                detail      TEXT,
                actor       TEXT    NOT NULL DEFAULT 'admin',
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            );
        """)
        await conn.commit()
