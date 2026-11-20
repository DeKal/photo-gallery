"""Central permission map: which capabilities require an authenticated admin.

One source of truth for gating. Flip a value to `False` to open that capability
to anonymous visitors (and to show its control in the UI); the frontend mirrors
this table in `frontend/src/permissions.ts`. Routes gate themselves with
``Depends(gate("<capability>"))`` instead of referencing ``require_admin``
directly, so changing access is a one-line edit here.
"""

from __future__ import annotations

from collections.abc import Callable

from app.auth import require_admin

# capability -> requires a signed-in admin?
REQUIRES_ADMIN: dict[str, bool] = {
    # Worker functions
    "scan": True,
    "cluster": True,
    "pick_folder": True,
    # People curation
    "person.hide": True,
    "person.show_hidden": True,
    "person.rename": True,
    "person.merge": True,
    "person.cover": False,  # cover face is a safe, display-only pick
    "face.move": True,
    # Albums
    "album.create": True,
    "album.rename": True,
    "album.delete": True,
    "album.add_photo": True,
    "album.remove_photo": True,
    "album.cover": True,
    # Photos
    "photo.favorite": False,  # starring a photo is a safe, shared toggle
}


def _allow_anon() -> None:
    """No-op dependency for capabilities open to everyone."""
    return None


def gate(capability: str) -> Callable:
    """Return the FastAPI dependency enforcing this capability's access level.

    ``require_admin`` (401 without a valid token) when the capability requires
    admin, otherwise a no-op that lets anyone through. Unknown capabilities
    default to admin-only (fail closed).
    """
    return require_admin if REQUIRES_ADMIN.get(capability, True) else _allow_anon


def requires_admin(capability: str) -> bool:
    """Whether a capability needs admin. Unknown capabilities fail closed."""
    return REQUIRES_ADMIN.get(capability, True)
