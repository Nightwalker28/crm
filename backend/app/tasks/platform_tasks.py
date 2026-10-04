from app.core.background_health import HEARTBEAT_TASK_NAME, WORKER_HEARTBEAT_KEY, stamp_heartbeat
from app.core.celery_app import celery_app


# Beat publishes it with an expiry, so a worker back from an outage skips the stale ones.
@celery_app.task(name=HEARTBEAT_TASK_NAME, ignore_result=True)
def heartbeat_task() -> None:
    stamp_heartbeat(WORKER_HEARTBEAT_KEY)
