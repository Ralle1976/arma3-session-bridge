"""
conftest.py — Shared pytest configuration for arma3-session-bridge API tests.

Sets environment variables BEFORE any test module imports the app, ensuring
consistent auth credentials and DB path across all test files.
"""

import os
import pathlib

# ── Shared test credentials (must be set before any app import) ──────────────
_TEST_DB = "/tmp/arma3-test-shared.db"
_TEST_ADMIN_PW = "test-admin-password"
_TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars-long"

# Remove stale DB so tests always start clean
pathlib.Path(_TEST_DB).unlink(missing_ok=True)

os.environ["ADMIN_PASSWORD"] = _TEST_ADMIN_PW
os.environ["JWT_SECRET"] = _TEST_JWT_SECRET
os.environ["DB_PATH"] = _TEST_DB
