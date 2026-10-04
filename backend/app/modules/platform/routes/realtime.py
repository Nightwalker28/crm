from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.core.realtime import realtime_stream
from app.core.security import get_current_user, require_user


router = APIRouter(prefix="/platform/realtime", tags=["Realtime"])


@router.get("/stream")
def stream_realtime_events(request: Request):
    # Authenticate with a session closed before the stream starts. A `Depends(get_db)` session
    # would stay checked out, idle in transaction, for the stream's whole life (13a H3).
    with SessionLocal() as db:
        current_user = require_user(get_current_user(request, db), db)
        tenant_id, user_id = current_user.tenant_id, current_user.id
    return StreamingResponse(
        realtime_stream(tenant_id=tenant_id, user_id=user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
