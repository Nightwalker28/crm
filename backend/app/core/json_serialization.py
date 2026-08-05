from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import date, datetime, time, timezone
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class JsonSerializationError(TypeError):
    """Raised when a value cannot be represented safely in a JSON column."""


def _datetime_to_utc_iso(value: datetime) -> str:
    aware_value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    return aware_value.astimezone(timezone.utc).isoformat()


def _json_key(value: Any, *, path: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Enum):
        return _json_key(value.value, path=path)
    if isinstance(value, (UUID, int)) and not isinstance(value, bool):
        return str(value)
    raise JsonSerializationError(f"Unsupported JSON object key type at {path}: {type(value).__name__}")


def to_json_safe(value: Any, *, _path: str = "$") -> Any:
    """Convert supported application values into strict JSON-compatible values.

    Datetimes are normalized to UTC before encoding. Unsupported objects fail
    explicitly instead of being silently stringified.
    """

    if value is None:
        return value
    if isinstance(value, Enum):
        return to_json_safe(value.value, _path=_path)
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise JsonSerializationError(f"Non-finite number at {_path} is not valid JSON")
        return value
    if isinstance(value, datetime):
        return _datetime_to_utc_iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, BaseModel):
        return to_json_safe(value.model_dump(mode="json"), _path=_path)
    if isinstance(value, Mapping):
        return {
            _json_key(key, path=f"{_path}.<key>"): to_json_safe(item, _path=f"{_path}.{key}")
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [to_json_safe(item, _path=f"{_path}[{index}]") for index, item in enumerate(value)]
    raise JsonSerializationError(f"Unsupported JSON value type at {_path}: {type(value).__name__}")
