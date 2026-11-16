from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)


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
