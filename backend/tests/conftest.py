"""Shared e2e test setup: Postgres reachability guard and table truncation.

The e2e suite runs the *real* FastAPI app against the *real* Postgres from
docker-compose, using FastAPI's ``TestClient`` so that ``BackgroundTasks``
(the scan pipeline) run synchronously on the response -- making each scan
deterministic without any polling race.

If Postgres is not reachable the whole suite is skipped with a clear message
rather than failing, so a contributor without docker-compose running still
gets a green (skipped) run.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.config import settings
from app.db import engine

# Data tables wiped before each e2e test, in FK-safe order via CASCADE.
_DATA_TABLES = (
    "photos",
    "image_embeddings",
    "faces",
    "persons",
    "face_person",
    "sim_clusters",
    "photo_sim_cluster",
    "scans",
)


def _postgres_reachable() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 - any connect failure means skip
        return False


@pytest.fixture(scope="session", autouse=True)
def require_postgres() -> None:
    """Skip the entire module if the docker-compose Postgres is unreachable."""
    if not _postgres_reachable():
        pytest.skip(
            "Postgres is not reachable at "
            f"{settings.database_url!r}. Start it with "
            "`docker compose up -d db` to run the e2e suite.",
            allow_module_level=True,
        )


@pytest.fixture()
def clean_db() -> None:
    """TRUNCATE all data tables (restart identity, cascade) before a test."""
    table_list = ", ".join(_DATA_TABLES)
    with engine.begin() as conn:
        conn.execute(
            text(f"TRUNCATE {table_list} RESTART IDENTITY CASCADE")
        )
