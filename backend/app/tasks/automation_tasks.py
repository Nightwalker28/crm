from sqlalchemy.exc import OperationalError

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.modules.platform.services.automation_rules import process_crm_event_automations
from app.modules.platform.services.crm_events import process_crm_event_delivery
from requests import RequestException


@celery_app.task(
    name="app.tasks.automation.process_crm_event",
    autoretry_for=(OperationalError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def process_crm_event(event_id: int) -> dict:
    with SessionLocal() as db:
        runs = process_crm_event_automations(db, event_id=event_id)
        return {"event_id": event_id, "runs": len(runs)}


@celery_app.task(
    name="app.tasks.automation.process_crm_event_delivery",
    autoretry_for=(RequestException, OSError, TimeoutError),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=120,
    time_limit=180,
)
def process_crm_event_delivery_task(delivery_id: int) -> dict:
    with SessionLocal() as db:
        delivery = process_crm_event_delivery(db, delivery_id=delivery_id)
        return {"delivery_id": delivery_id, "status": getattr(delivery, "status", "missing")}
