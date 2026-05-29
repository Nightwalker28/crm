from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.realtime import realtime_stream
from app.core.security import require_user


router = APIRouter(prefix="/platform/realtime", tags=["Realtime"])


@router.get("/stream")
def stream_realtime_events(current_user=Depends(require_user)):
    return StreamingResponse(
        realtime_stream(tenant_id=current_user.tenant_id, user_id=current_user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
