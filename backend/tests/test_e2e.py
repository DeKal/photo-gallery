"""End-to-end API test: real FastAPI app, real Postgres, real CLIP/InsightFace.

Exercises the full pipeline against the fixture image set built by
``tests/make_fixtures.py``: scan -> cluster -> browse persons / sim-clusters ->
similarity kNN -> media serving. Marked ``slow`` because the first run loads
(and on a cold machine downloads) the model weights.

Run::

    cd backend && .venv/bin/python -m pytest tests/test_e2e.py -v -m slow
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
EXPECTED_IMAGE_COUNT = 10  # 4 group + 4 scene + 2 noise (see make_fixtures.py)


def _photo_paths() -> dict[int, str]:
    """Map every photo id -> its filesystem path straight from the DB."""
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, path FROM photos")).all()
    return {int(pid): path for pid, path in rows}


def _error_count() -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM photos WHERE error IS NOT NULL")
            ).scalar_one()
        )


@pytest.mark.slow
def test_full_pipeline_e2e(clean_db: None) -> None:
    # TestClient runs BackgroundTasks synchronously, so the scan finishes
    # before the POST /scan response is handed back -- no polling race.
    with TestClient(app) as client:
        # 1. Scan the fixtures folder ------------------------------------
        resp = client.post("/scan", json={"root_path": str(FIXTURES_DIR)})
        assert resp.status_code == 200, resp.text
        scan_id = resp.json()["scan_id"]

        status = client.get(f"/scan/{scan_id}")
        assert status.status_code == 200, status.text
        body = status.json()
        assert body["status"] == "completed", body
        assert body["total"] == EXPECTED_IMAGE_COUNT, body
        assert body["done"] == body["total"] == EXPECTED_IMAGE_COUNT, body
        assert _error_count() == 0, "some fixtures failed to process"

        # 2. Cluster faces + images -------------------------------------
        cresp = client.post("/cluster")
        assert cresp.status_code == 200, cresp.text
        summary = cresp.json()
        persons = summary["faces"]["persons"]
        sim_clusters = summary["images"]["clusters"]
        # Fail loudly (with the summary) rather than passing silently.
        assert persons >= 1, f"expected >=1 person cluster, got summary={summary}"
        assert (
            sim_clusters >= 1
        ), f"expected >=1 sim cluster, got summary={summary}"

        # 3. Persons: list / rename / photos ----------------------------
        people = client.get("/persons").json()
        assert people, "no persons returned"
        person_id = people[0]["id"]

        renamed = client.patch(f"/persons/{person_id}", json={"name": "TestPerson"})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "TestPerson"
        assert client.get(f"/persons/{person_id}").json()["name"] == "TestPerson"

        person_photos = client.get(f"/persons/{person_id}/photos").json()
        assert person_photos, "person has no photos"

        # 4. Sim-clusters: list / photos --------------------------------
        clusters = client.get("/sim-clusters").json()
        assert clusters, "no sim clusters returned"

        paths = _photo_paths()
        scene_photo_id: int | None = None
        for cluster in clusters:
            photos = client.get(f"/sim-clusters/{cluster['id']}/photos").json()
            assert photos, f"sim cluster {cluster['id']} has no photos"
            for photo in photos:
                if "scene_" in Path(paths[photo["id"]]).name:
                    scene_photo_id = photo["id"]
        assert scene_photo_id is not None, "no scene_* photo landed in a cluster"

        # 5. Similarity kNN: near-dupes nearest-first, query excluded ----
        similar = client.get(f"/photos/{scene_photo_id}/similar?k=10")
        assert similar.status_code == 200, similar.text
        results = similar.json()
        assert results, "no similar photos returned"
        ids = [r["photo_id"] for r in results]
        assert scene_photo_id not in ids, "query photo was not excluded"
        dists = [r["distance"] for r in results]
        assert dists == sorted(dists), "results are not nearest-first"
        top_name = Path(paths[results[0]["photo_id"]]).name
        assert "scene_" in top_name, (
            f"nearest neighbor of a scene should be another scene, got {top_name} "
            f"(dist={results[0]['distance']})"
        )

        # 6. Media serving: thumb / image / 404 -------------------------
        thumb = client.get(f"/thumb/{scene_photo_id}")
        assert thumb.status_code == 200
        assert thumb.headers["content-type"].startswith("image/")

        image = client.get(f"/image/{scene_photo_id}")
        assert image.status_code == 200
        assert image.headers["content-type"].startswith("image/")

        assert client.get("/thumb/99999").status_code == 404
