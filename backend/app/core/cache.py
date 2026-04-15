from __future__ import annotations

import json
import logging
from time import monotonic
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import redis
except ImportError:  # pragma: no cover - dependency can be absent in local dev until installed
    redis = None


LOCAL_CACHE_TTL_SECONDS = 300
_local_cache: dict[str, tuple[float, str]] = {}
_redis_client = None
_redis_failure_logged = False


def _get_redis_client():
    global _redis_client, _redis_failure_logged
    if _redis_client is not None:
        return _redis_client
    if not settings.REDIS_URL or redis is None:
        return None
    try:
        _redis_client = redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_timeout=0.2,
            socket_connect_timeout=0.2,
        )
        _redis_client.ping()
        return _redis_client
    except Exception as exc:  # pragma: no cover - network/service dependent
        if not _redis_failure_logged:
            logger.warning("Redis unavailable, falling back to local cache: %s", exc)
            _redis_failure_logged = True
        _redis_client = None
        return None


def cache_get_json(key: str) -> Any | None:
    client = _get_redis_client()
    if client is not None:
        try:
            cached = client.get(key)
            if cached is not None:
                return json.loads(cached)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis get failed for key %s: %s", key, exc)

    cached = _local_cache.get(key)
    if not cached:
        return None
    expires_at, serialized = cached
    if expires_at <= monotonic():
        _local_cache.pop(key, None)
        return None
    return json.loads(serialized)


def cache_set_json(key: str, value: Any, *, ttl_seconds: int = LOCAL_CACHE_TTL_SECONDS) -> None:
    serialized = json.dumps(value)
    client = _get_redis_client()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, serialized)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis set failed for key %s: %s", key, exc)
    _local_cache[key] = (monotonic() + ttl_seconds, serialized)


def cache_delete(key: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis delete failed for key %s: %s", key, exc)
    _local_cache.pop(key, None)


def cache_delete_prefix(prefix: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            keys = client.keys(f"{prefix}*")
            if keys:
                client.delete(*keys)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis delete prefix failed for %s: %s", prefix, exc)

    for key in list(_local_cache.keys()):
        if key.startswith(prefix):
            _local_cache.pop(key, None)
