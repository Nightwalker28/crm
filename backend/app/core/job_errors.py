from __future__ import annotations


CALENDAR_SYNC_SAFE_ERROR = "Calendar sync could not be completed. Your existing events were not removed. Try again."


def safe_data_transfer_error(*, module_key: str, operation_type: str) -> str:
    if module_key == "calendar" and operation_type == "sync":
        return CALENDAR_SYNC_SAFE_ERROR
    operation_name = operation_type.replace("_", " ").strip().capitalize() or "Background job"
    return f"{operation_name} could not be completed. Try again."


def technical_job_error(error: BaseException | str | None) -> str:
    """Keep bounded diagnostic context internally without exposing it to users."""

    if isinstance(error, BaseException):
        detail = str(error).strip()
        value = f"{type(error).__name__}: {detail}" if detail else type(error).__name__
    else:
        value = str(error or "Background job failed.").strip() or "Background job failed."
    return value[:4000]
