"""Scratch-DB integration test for locked-person preservation across re-cluster.

Creates a throwaway database, seeds synthetic faces for THREE distinct identities
(well separated in embedding space), then:
  1. clusters -> 3 auto persons
  2. locks + hides one, renames another, merges the other two into one person
  3. adds NEW faces for an existing identity and a brand-new identity
  4. re-clusters and asserts: locked/hidden/renamed/merged state survived, new
     faces for a locked identity got absorbed, the new identity formed its own
     cluster.

Does NOT touch the live `photos` database.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as db  # noqa: E402

ADMIN = "postgresql+psycopg://photo:photo@localhost:5432/postgres"
TEST_URL = "postgresql+psycopg://photo:photo@localhost:5432/photos_locktest"


def _recreate_db() -> None:
    eng = create_engine(ADMIN, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS photos_locktest"))
        c.execute(text("CREATE DATABASE photos_locktest"))
    eng.dispose()


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def _ident(base: np.ndarray, jitter: float, g: np.random.Generator) -> list[float]:
    v = base + jitter * g.standard_normal(512).astype(np.float32)
    v = v / np.linalg.norm(v)
    return v.astype(np.float32).tolist()


def main() -> int:
    _recreate_db()
    engine = create_engine(TEST_URL)

    # Point the app's models/session at the scratch DB and create the schema.
    db.engine = engine
    Session = sessionmaker(bind=engine)
    with engine.connect() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        c.commit()
    from app.models import Base, Face, FacePerson, Person, Photo  # noqa: E402

    Base.metadata.create_all(engine)

    from app.clusterer import cluster_faces  # noqa: E402

    g = _rng(42)
    # Three orthogonal-ish identity directions.
    bases = []
    for i in range(3):
        b = np.zeros(512, dtype=np.float32)
        b[i * 10 : i * 10 + 10] = 1.0
        b = b / np.linalg.norm(b)
        bases.append(b)

    s = Session()
    photo = Photo(path="/x.jpg", sha256="seed", width=10, height=10)
    s.add(photo)
    s.flush()

    def add_faces(identity: int, count: int) -> list[int]:
        ids = []
        for _ in range(count):
            f = Face(
                photo_id=photo.id,
                bbox=[0.0, 0.0, 100.0, 100.0],
                det_score=0.9,
                vec=_ident(bases[identity], 0.02, g),
            )
            s.add(f)
            s.flush()
            ids.append(f.id)
        return ids

    add_faces(0, 6)  # identity A
    add_faces(1, 6)  # identity B
    add_faces(2, 6)  # identity C
    s.commit()

    r1 = cluster_faces(s)
    print("run1:", r1)
    persons = s.query(Person).all()
    assert len(persons) == 3, f"expected 3 auto persons, got {len(persons)}"

    # Map each person to the identity of its faces (by nearest base).
    def person_identity(pid: int) -> int:
        row = (
            s.query(Face.vec)
            .join(FacePerson, FacePerson.face_id == Face.id)
            .filter(FacePerson.person_id == pid)
            .first()
        )
        v = np.asarray(row[0], dtype=np.float32)
        return int(np.argmax([float(v @ b) for b in bases]))

    by_ident = {person_identity(p.id): p for p in persons}
    pa, pb, pc = by_ident[0], by_ident[1], by_ident[2]

    # Curate: rename A, hide B, merge C into A (A becomes A+C).
    pa.name = "Alice"
    pa.locked = True
    pb.hidden = True
    pb.locked = True
    s.query(FacePerson).filter(FacePerson.person_id == pc.id).update(
        {FacePerson.person_id: pa.id}
    )
    pa_id = pa.id
    pb_id = pb.id
    s.delete(pc)
    s.commit()

    locked_ids = {p.id for p in s.query(Person).filter(Person.locked.is_(True))}
    print("locked persons after curation:", locked_ids)

    # New faces: more of identity A (should be absorbed into locked Alice) and a
    # brand-new identity D (should form its own fresh cluster).
    add_faces(0, 4)
    base_d = np.zeros(512, dtype=np.float32)
    base_d[200:210] = 1.0
    base_d = base_d / np.linalg.norm(base_d)
    bases.append(base_d)
    for _ in range(5):
        f = Face(
            photo_id=photo.id,
            bbox=[0.0, 0.0, 100.0, 100.0],
            det_score=0.9,
            vec=_ident(bases[3], 0.02, g),
        )
        s.add(f)
    s.commit()

    r2 = cluster_faces(s)
    print("run2:", r2)

    alice = s.get(Person, pa_id)
    bob = s.get(Person, pb_id)
    assert alice is not None, "renamed+merged person was destroyed by re-cluster"
    assert alice.name == "Alice", f"name lost: {alice.name!r}"
    assert bob is not None, "hidden person was destroyed by re-cluster"
    assert bob.hidden is True, "hidden flag lost"

    # Alice should now hold identity A (6) + merged C (6) + absorbed new A (4) = 16.
    alice_faces = (
        s.query(FacePerson).filter(FacePerson.person_id == alice.id).count()
    )
    print("alice faces:", alice_faces)
    assert alice_faces == 16, f"expected 16 faces on Alice, got {alice_faces}"

    # A brand-new auto person for identity D must exist (un-locked, unnamed).
    auto = s.query(Person).filter(
        Person.locked.is_(False), Person.name.is_(None)
    ).all()
    assert len(auto) == 1, f"expected exactly 1 new auto person, got {len(auto)}"
    print("new auto person faces:",
          s.query(FacePerson).filter(FacePerson.person_id == auto[0].id).count())

    s.close()
    print("\nALL ASSERTIONS PASSED — locked state survives re-cluster.")

    # Clean up the scratch DB.
    engine.dispose()
    eng = create_engine(ADMIN, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS photos_locktest"))
    eng.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
