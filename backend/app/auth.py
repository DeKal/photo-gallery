"""Authentication: PBKDF2 password hashing + HMAC-signed session tokens.

Stdlib only (hashlib/hmac/secrets) so the slim API image gains no dependency.
A single admin account lives in the ``users`` table (seed via
scripts/seed_admin.py); tokens are signed with ``settings.auth_secret``
(PHOTO_AUTH_SECRET) and carry only a subject + expiry -- no server-side session
store, which suits the stateless serverless API.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from fastapi import Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User

_PBKDF2_ITERATIONS = 240_000
_TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 days


# ---- Password hashing ----------------------------------------------------


def hash_password(password: str) -> str:
    """Return a ``pbkdf2_sha256$iters$salt_hex$hash_hex`` digest."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of ``password`` against a stored PBKDF2 digest."""
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters_s)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


# ---- Session tokens ------------------------------------------------------


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_b64: str) -> str:
    sig = hmac.new(
        settings.auth_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64url(sig)


def make_token(username: str) -> str:
    """Create a signed ``<payload>.<sig>`` token for ``username``."""
    payload = {"sub": username, "exp": int(time.time()) + _TOKEN_TTL_SECONDS}
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_token(token: str) -> str | None:
    """Return the token's subject if the signature and expiry are valid."""
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(payload_b64)):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload.get("sub")


# ---- FastAPI dependency --------------------------------------------------


def authenticate(session: Session, username: str, password: str) -> User | None:
    """Return the user if the username exists and the password matches."""
    user = session.execute(
        select(User).where(User.username == username)
    ).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


def require_admin(authorization: str | None = Header(default=None)) -> str:
    """Dependency guarding write routes: require a valid Bearer token.

    Returns the authenticated username; raises 401 otherwise. GET/read routes
    omit this dependency and stay public.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub = verify_token(authorization[7:].strip())
    if sub is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return sub
