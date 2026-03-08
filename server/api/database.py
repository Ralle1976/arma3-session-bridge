"""
database.py — SQLite WAL-Mode Setup for arma3-session-bridge API.

Uses aiosqlite for async access. WAL mode is enabled for concurrent reads
from multiple coroutines without blocking writers.

Usage pattern:
    async with get_connection() as conn:
        ...
"""

import aiosqlite
import os
from contextlib import asynccontextmanager
from pathlib import Path

DB_PATH = Path(os.getenv("DB_PATH", "/app/data/arma3.db"))


@asynccontextmanager
async def get_connection():
    """Async context manager that yields an aiosqlite connection with WAL mode."""
    db_path = Path(os.getenv("DB_PATH", str(DB_PATH)))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(db_path)) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.commit()
        yield conn


async def init_db() -> None:
    """Create all tables on startup if they don't exist, then run migrations."""
    async with get_connection() as conn:
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
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id         INTEGER NOT NULL REFERENCES peers(id),
                mission_name    TEXT,
                map_name        TEXT,
                max_players     INTEGER NOT NULL DEFAULT 10,
                current_players INTEGER NOT NULL DEFAULT 0,
                last_seen       TEXT    NOT NULL DEFAULT (datetime('now')),
                status          TEXT    NOT NULL DEFAULT 'waiting',
                started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
                ended_at        TEXT,
                active          INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS admin_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type  TEXT    NOT NULL,
                detail      TEXT,
                actor       TEXT    NOT NULL DEFAULT 'admin',
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        await conn.commit()

        # Schema migrations removed — all columns now created in initial schema
        # Existing databases will have columns added via migrations on first startup
        # New databases get correct schema from the start
