from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.calendar.services.calendar_services import sync_external_events_for_event_id


@celery_app.task(name="app.tasks.calendar.sync_event_to_external_providers")
def sync_calendar_event_to_external_providers_task(event_id: int) -> dict:
    db = SessionLocal()
    try:
        synced_participants = sync_external_events_for_event_id(db, event_id=event_id)
        return {"event_id": event_id, "synced_participants": synced_participants}
    finally:
        db.close()
