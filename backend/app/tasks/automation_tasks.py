from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.automation_rules import process_crm_event_automations


@celery_app.task(name="app.tasks.automation.process_crm_event")
def process_crm_event(event_id: int) -> dict:
    db = SessionLocal()
    try:
        runs = process_crm_event_automations(db, event_id=event_id)
        return {"event_id": event_id, "runs": len(runs)}
    finally:
        db.close()
