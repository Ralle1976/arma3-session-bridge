"""
test_health.py — pytest tests for the /health endpoint.

Runs against the FastAPI test client (no Docker required).
Environment variables ADMIN_PASSWORD and JWT_SECRET must be set.
"""

import os
import pytest
from httpx import AsyncClient, ASGITransport

# Ensure required env vars are set before importing app
os.environ.setdefault("ADMIN_PASSWORD", "test-password")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-at-least-32-chars-long")
os.environ.setdefault("DB_PATH", "/tmp/arma3-test.db")

from main import app  # noqa: E402


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_health_returns_ok():
    """GET /health must return HTTP 200 with status='ok'."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["status"] == "ok", f"Expected status='ok', got {data}"


@pytest.mark.anyio
async def test_health_contains_version():
    """GET /health response must include a version field."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert "version" in data, "Missing 'version' field in health response"


@pytest.mark.anyio
async def test_health_content_type_is_json():
    """GET /health must respond with application/json."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")

    assert "application/json" in response.headers.get("content-type", "")
