"""One renderer and one template system for every commercial document (13d §3.3).

Jinja2 templates in `app/templates/documents/` render the HTML; WeasyPrint turns it into a
PDF. The same HTML is the in-app preview, so there is one template per document, not two.

Safety:
- the environment is sandboxed and autoescaped, and loads templates from that folder only;
- the PDF renderer fetches nothing from the network: a URL fetcher refuses every scheme but
  `data:`, so a logo is embedded by the caller (`image_data_uri`), never fetched (SSRF).

Jinja2 and WeasyPrint are imported when a document is rendered, not at start-up, so the app and
every test that renders nothing run without them (and WeasyPrint's system libraries).
"""

from __future__ import annotations

import base64
import mimetypes
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.uploads import UPLOADS_DIR

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates" / "documents"
LAYOUTS = ("modern", "classic", "compact")
LOGO_MAX_BYTES = 2 * 1024 * 1024


def _money(value: Any, currency: str | None = None) -> str:
    try:
        amount = Decimal(str(value if value is not None else 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return ""
    sign = "-" if amount < 0 else ""
    text = f"{abs(amount):,.2f}"
    return f"{sign}{currency} {text}" if currency else f"{sign}{text}"


def _quantity(value: Any) -> str:
    try:
        number = Decimal(str(value if value is not None else 0)).normalize()
    except (InvalidOperation, ValueError):
        return ""
    return format(number, "f")


def _percent(value: Any) -> str:
    return f"{_quantity(value)}%" if value is not None else ""


def _date(value: Any) -> str:
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return str(value or "")


def _lines(value: Any):
    """Text with its line breaks kept, escaped."""
    from markupsafe import Markup, escape

    return Markup("<br>").join(escape(part) for part in str(value or "").splitlines())


@lru_cache(maxsize=1)
def _environment():
    from jinja2 import FileSystemLoader, StrictUndefined, select_autoescape
    from jinja2.sandbox import SandboxedEnvironment

    env = SandboxedEnvironment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters.update(money=_money, quantity=_quantity, percent=_percent, date=_date, lines=_lines)
    return env


def render_html(template: str, context: dict[str, Any]) -> str:
    return _environment().get_template(template).render(**context)


def _refuse_remote(url: str, *args, **kwargs):
    """WeasyPrint's fetcher: embedded `data:` URIs only, nothing over the network or disk."""
    if not url.startswith("data:"):
        raise ValueError("Document PDFs embed their images; nothing is fetched")
    from weasyprint.urls import default_url_fetcher

    return default_url_fetcher(url, *args, **kwargs)


def render_pdf(template: str, context: dict[str, Any]) -> bytes:
    from weasyprint import HTML

    html = render_html(template, context)
    return HTML(string=html, url_fetcher=_refuse_remote, base_url=None).write_pdf()


def image_data_uri(relative_path: str | None) -> str | None:
    """A tenant's uploaded image (the company logo) as a `data:` URI, read from local uploads.
    Anything that is not a file under the uploads folder gives none."""
    if not relative_path or "://" in relative_path:
        return None
    root = UPLOADS_DIR.resolve()
    path = (root / relative_path.lstrip("/")).resolve()
    if root not in path.parents or not path.is_file() or path.stat().st_size > LOGO_MAX_BYTES:
        return None
    content_type = mimetypes.guess_type(path.name)[0] or ""
    if content_type not in {"image/png", "image/jpeg", "image/webp"}:
        return None
    return f"data:{content_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
