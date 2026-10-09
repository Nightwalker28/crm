"""Document PDFs, previews and per-type document settings (13d §3.3).

Every document route clears the three access layers for the document's own module (`view`);
invoices and credit notes also apply the finance user scope through their loaders. Settings
are an admin's, like the workspace's other settings.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_access
from app.core.security import require_admin, require_user
from app.modules.platform.services import document_pdfs

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Document PDFs"])


def _guard(db: Session, user, module_key: str) -> None:
    document_pdfs.kind_for(module_key)
    require_access(db, user, module_key, "view", detail="You need view access to this record to print it.")


@router.get("/records/{module_key}/{record_id}/pdf")
def download_document_pdf(module_key: str, record_id: int, download: bool = Query(default=False),
                          db: Session = Depends(get_db), user=Depends(require_user)):
    _guard(db, user, module_key)
    try:
        content, filename = document_pdfs.document_pdf(db, user, module_key, record_id)
    except ImportError as exc:
        logger.exception("PDF rendering is not installed")
        raise HTTPException(status_code=503, detail="PDF rendering is not available on this server yet") from exc
    db.commit()
    disposition = "attachment" if download else "inline"
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disposition}; filename="{filename}"', "Cache-Control": "private, no-store"})


@router.get("/records/{module_key}/{record_id}/preview", response_class=HTMLResponse)
def preview_document(module_key: str, record_id: int, db: Session = Depends(get_db), user=Depends(require_user)):
    """The same HTML the PDF is made from; the app shows it in a sandboxed frame."""
    _guard(db, user, module_key)
    html = document_pdfs.render_preview(db, user, module_key, record_id)
    return HTMLResponse(content=html, headers={"Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'"})


@router.get("/records/{module_key}/{record_id}/send-context")
def document_send_context(module_key: str, record_id: int, db: Session = Depends(get_db), user=Depends(require_user)):
    """What *Send* starts with: the document's people, its type's template, its PDF (13d §3.4)."""
    _guard(db, user, module_key)
    from app.modules.platform.services import document_send

    return jsonable_encoder(document_send.send_context(db, user, module_key, record_id))


class DocumentSettingPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    default_terms: str | None = Field(default=None, max_length=10000)
    default_notes: str | None = Field(default=None, max_length=10000)
    email_template_id: int | None = Field(default=None, gt=0)


@router.get("/document-settings")
def list_document_settings(db: Session = Depends(get_db), user=Depends(require_user)):
    return jsonable_encoder({"items": document_pdfs.list_document_settings(db, tenant_id=user.tenant_id)})


@router.put("/document-settings/{kind}")
def save_document_setting(kind: str, payload: DocumentSettingPayload, db: Session = Depends(get_db), admin=Depends(require_admin)):
    document_pdfs.save_document_setting(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, kind=kind,
                                        payload=payload.model_dump(exclude_unset=True))
    db.commit()
    return jsonable_encoder({"items": document_pdfs.list_document_settings(db, tenant_id=admin.tenant_id)})
