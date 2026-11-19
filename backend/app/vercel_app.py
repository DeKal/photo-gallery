"""Vercel entry for the merged ``backend`` service (slim, DB-only; no worker).

On Vercel the ``backend`` service runs this ASGI app: the light
``app.main_api`` (persons, similarity, photos, albums, in-DB thumbnails)
mounted under ``/api`` so the SPA at ``/`` and the API at ``/api/*`` share one
origin (no CORS). Services receive the original request path (Vercel does not
strip the rewrite prefix), so ``/api/persons`` arrives here as ``/api/persons``
and the mount turns it into ``/persons`` inside ``main_api``.

Only ``app.main_api`` is imported, which pulls none of the ML stack
(torch/open_clip/insightface/onnxruntime) or Pillow -- the heavy worker
(``app.main_worker``) is never deployed to Vercel; it runs natively on a host.
Mode is chosen by entrypoint + installed deps, not auto-detected: Vercel installs
the slim ``requirements.txt`` and runs this; local installs ``.[worker]`` and
runs the worker.
"""

import os

# Short-lived invocations + the managed DB (Neon) pooling connections itself
# mean this app must keep no connection pool of its own; force NullPool (db.py).
os.environ.setdefault("PHOTO_SERVERLESS", "1")

import html as _html  # noqa: E402
import re  # noqa: E402
import urllib.request  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402  (import after env setup)
from fastapi.responses import HTMLResponse, RedirectResponse  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main_api import app as api_app  # noqa: E402

app = FastAPI()
app.mount("/api", api_app)


def _set_meta(doc: str, prop: str, value: str, attr: str = "property") -> str:
    """Replace a <meta …>'s content, or insert the tag before </head>.

    Tolerant of attributes split across lines (index.html formats some multi-line).
    """
    tag = f'<meta {attr}="{prop}" content="{value}" />'
    pat = re.compile(
        rf'<meta\s+{attr}="{re.escape(prop)}"\s+content="[^"]*"\s*/?>',
        re.S,
    )
    if pat.search(doc):
        return pat.sub(tag, doc, count=1)
    return doc.replace("</head>", f"{tag}\n</head>", 1)


@app.get("/albums/{album_id}", response_class=HTMLResponse)
def album_og(album_id: int, request: Request) -> HTMLResponse:
    """Serve the SPA shell with per-album Open Graph tags injected.

    Social crawlers read static HTML and don't run JS, so a client-only SPA
    always shows the generic preview. Vercel rewrites ``/albums/:id`` here; we
    fetch the built ``index.html`` from the same origin, inject the album's
    title + cover as OG/Twitter tags, and return it. Humans get the same shell,
    so React boots and renders the album normally. On any failure we fall back
    to the app home rather than 500 a shared link.
    """
    host = request.headers.get("host", "")
    try:
        req = urllib.request.Request(
            f"https://{host}/index.html",
            headers={"User-Agent": "og-prerender"},
        )
        with urllib.request.urlopen(req, timeout=5) as r:  # noqa: S310 (same-origin)
            doc = r.read().decode("utf-8")
    except Exception:
        return RedirectResponse(url="/", status_code=307)

    name = f"Album {album_id}"
    count = 0
    cover_drive = None
    try:
        with SessionLocal() as session:
            row = session.execute(
                text(
                    """
                    SELECT a.name,
                      (SELECT count(*) FROM photo_album pa WHERE pa.album_id = a.id) AS cnt,
                      (SELECT p.drive_file_id FROM photos p WHERE p.id = COALESCE(
                         a.cover_photo_id,
                         (SELECT pa.photo_id FROM photo_album pa
                            JOIN photos p2 ON p2.id = pa.photo_id
                            WHERE pa.album_id = a.id AND p2.error IS NULL
                            ORDER BY p2.id ASC LIMIT 1))) AS cover_drive
                    FROM albums a WHERE a.id = :aid
                    """
                ),
                {"aid": album_id},
            ).first()
        if row is not None:
            name = row.name or name
            count = row.cnt or 0
            cover_drive = row.cover_drive
    except Exception:
        pass  # Degrade to a generic-but-valid preview.

    title = _html.escape(name)
    desc = _html.escape(f"{count} photos" if count else name)
    image = (
        f"https://lh3.googleusercontent.com/d/{cover_drive}=w1200"
        if cover_drive
        else f"https://{host}/og-image.png"
    )
    url = f"https://{host}/albums/{album_id}"

    doc = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", doc, count=1, flags=re.S)
    doc = _set_meta(doc, "description", desc, attr="name")
    doc = _set_meta(doc, "og:title", title)
    doc = _set_meta(doc, "og:description", desc)
    doc = _set_meta(doc, "og:image", _html.escape(image))
    doc = _set_meta(doc, "og:url", _html.escape(url))
    doc = _set_meta(doc, "twitter:title", title, attr="name")
    doc = _set_meta(doc, "twitter:description", desc, attr="name")
    doc = _set_meta(doc, "twitter:image", _html.escape(image), attr="name")
    return HTMLResponse(content=doc)
