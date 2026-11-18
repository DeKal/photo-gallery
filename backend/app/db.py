from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings

if settings.serverless:
    # Serverless (e.g. Vercel): each invocation is short-lived and the managed
    # DB (Neon) does its own connection pooling, so keep none here -- a per-
    # instance pool would multiply open connections across cold starts and
    # exhaust Neon's limit. NullPool opens/closes a connection per checkout.
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        pool_pre_ping=True,
        future=True,
    )
else:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        # Media endpoints (/thumb, /face-thumb, /image) each check out a pooled DB
        # connection to look up one row. A People/Similar page triggers a burst of
        # such requests; with the default pool (size 5 + overflow 10 = 15) the
        # 16th+ concurrent request blocks 30s then fails with QueuePool TimeoutError
        # (HTTP 500 / broken image). A generous pool for this local, read-heavy,
        # image-serving workload removes that ceiling. (The media routes also
        # release their connection before streaming -- see app/api/media.py.)
        pool_size=20,
        max_overflow=40,
        pool_timeout=10,
        future=True,
    )


@event.listens_for(engine, "connect")
def _set_ivfflat_probes(dbapi_connection, connection_record) -> None:
    """Raise ivfflat recall by probing more inverted lists per query.

    The ``image_embeddings`` / ``faces`` cosine indexes are ivfflat with
    ``lists=100``. ivfflat is an *approximate* index: at the default
    ``probes=1`` it only scans a single list, which under-returns neighbors on
    the small/sparse data at this project's scale (2k-10k vectors) -- e.g.
    ``/photos/{id}/similar`` can miss obvious near-duplicates. Setting
    ``probes=50`` scans half the lists on every new DB connection, giving
    near-exact recall while keeping the index. The SET is issued through the
    raw DBAPI cursor so it applies to this physical connection for its lifetime.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET ivfflat.probes = 50")
    finally:
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
