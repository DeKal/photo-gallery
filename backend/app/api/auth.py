"""Auth API: log in to the single admin account and validate the session.

``POST /auth/login`` exchanges username/password for a signed token (app/auth.py);
``GET /auth/me`` echoes the authenticated username so the frontend can validate a
stored token on load. Write routes elsewhere depend on ``require_admin``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import authenticate, make_token, require_admin
from app.db import get_session
from app.schemas import LoginRequest, TokenOut

router = APIRouter()


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginRequest, session: Session = Depends(get_session)) -> TokenOut:
    """Verify credentials and issue a session token (401 on mismatch)."""
    user = authenticate(session, body.username, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenOut(token=make_token(user.username), username=user.username)


@router.get("/auth/me")
def me(username: str = Depends(require_admin)) -> dict[str, str]:
    """Return the current user if the Bearer token is valid, else 401."""
    return {"username": username}
