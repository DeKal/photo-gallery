from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, Boolean, Float, ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(String)
    sha256: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    taken_at: Mapped[datetime | None] = mapped_column(nullable=True)
    thumb_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # Thumbnail JPEG bytes stored in-DB so media can be served without a shared
    # filesystem (e.g. serverless/Vercel). thumb_path remains for local dev.
    thumb_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Drive file id when this photo came from a Google Drive folder; lets the UI
    # display the image straight from Drive and fall back to the local file.
    drive_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    scanned_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ImageEmbedding(Base):
    __tablename__ = "image_embeddings"

    photo_id: Mapped[int] = mapped_column(
        ForeignKey("photos.id"), primary_key=True
    )
    vec: Mapped[list[float]] = mapped_column(Vector(512))


class Face(Base):
    __tablename__ = "faces"

    id: Mapped[int] = mapped_column(primary_key=True)
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id"))
    bbox: Mapped[list[float]] = mapped_column(ARRAY(Float))
    det_score: Mapped[float] = mapped_column(Float)
    vec: Mapped[list[float]] = mapped_column(Vector(512))
    thumb_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # Cropped-face JPEG bytes stored in-DB (see Photo.thumb_data).
    thumb_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    cover_face_id: Mapped[int | None] = mapped_column(
        ForeignKey("faces.id"), nullable=True
    )
    # Soft-hide for bad/junk clusters; filtered from the default People list.
    hidden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # True once the user has curated this person (rename / merge / hide / move /
    # set-cover). Locked persons are preserved verbatim across re-clustering
    # instead of being rebuilt from scratch, so manual edits survive a rescan.
    locked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class FacePerson(Base):
    __tablename__ = "face_person"

    face_id: Mapped[int] = mapped_column(ForeignKey("faces.id"), primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id"))


class SimCluster(Base):
    __tablename__ = "sim_clusters"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)


class PhotoSimCluster(Base):
    __tablename__ = "photo_sim_cluster"

    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id"), primary_key=True)
    sim_cluster_id: Mapped[int] = mapped_column(ForeignKey("sim_clusters.id"))


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    root_path: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    done: Mapped[int] = mapped_column(default=0)
    total: Mapped[int] = mapped_column(default=0)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # When set, every photo this scan touches (new or already-indexed) is added
    # to this album. Lets a user scan a folder straight into e.g. "Wedding".
    album_id: Mapped[int | None] = mapped_column(
        ForeignKey("albums.id"), nullable=True
    )


class Album(Base):
    __tablename__ = "albums"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PhotoAlbum(Base):
    """Many-to-many membership: a photo may belong to several albums."""

    __tablename__ = "photo_album"

    photo_id: Mapped[int] = mapped_column(
        ForeignKey("photos.id"), primary_key=True
    )
    album_id: Mapped[int] = mapped_column(
        ForeignKey("albums.id"), primary_key=True
    )
