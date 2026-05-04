from __future__ import annotations

import json
import logging
import os
import threading
from collections import OrderedDict
from time import monotonic
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import redis
except ImportError:  # pragma: no cover - dependency can be absent in local dev until installed
    redis = None


LOCAL_CACHE_TTL_SECONDS = 300
MAX_LOCAL_CACHE_SIZE = 1000
_local_cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
_redis_client = None
_redis_lock = threading.Lock()
_redis_failure_logged = False


def _get_redis_client():
    global _redis_client, _redis_failure_logged
    if _redis_client is not None:
        return _redis_client
    if not settings.REDIS_URL or redis is None:
        return None
    with _redis_lock:
        if _redis_client is not None:
            return _redis_client
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


def warn_if_local_cache_multi_worker() -> None:
    if settings.REDIS_URL:
        return
    worker_count = 1
    for variable in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        raw_value = os.getenv(variable)
        if not raw_value:
            continue
        try:
            worker_count = max(worker_count, int(raw_value))
        except ValueError:
            continue
    if worker_count > 1:
        logger.warning(
            "REDIS_URL is not set while %s workers are configured; local in-process cache "
            "invalidation is per worker and may serve stale cached data.",
            worker_count,
        )


def cache_get_json(key: str) -> Any | None:
    client = _get_redis_client()
    if client is not None:
        try:
            cached = client.get(key)
            if cached is not None:
                return json.loads(cached)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis get failed for key %s: %s", key, exc)
        return None
    if settings.REDIS_URL:
        return None

    cached = _local_cache.get(key)
    if not cached:
        return None
    expires_at, serialized = cached
    if expires_at <= monotonic():
        _local_cache.pop(key, None)
        return None
    _local_cache.move_to_end(key)
    return json.loads(serialized)


def cache_set_json(key: str, value: Any, *, ttl_seconds: int = LOCAL_CACHE_TTL_SECONDS) -> None:
    serialized = json.dumps(value)
    client = _get_redis_client()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, serialized)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis set failed for key %s: %s", key, exc)
        return
    if settings.REDIS_URL:
        return
    _local_cache[key] = (monotonic() + ttl_seconds, serialized)
    _local_cache.move_to_end(key)
    while len(_local_cache) > MAX_LOCAL_CACHE_SIZE:
        _local_cache.popitem(last=False)


def cache_delete(key: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception as exc:  # pragma: no cover - network/service dependent
            logger.warning("Redis delete failed for key %s: %s", key, exc)
        return
    if settings.REDIS_URL:
        return
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
        return
    if settings.REDIS_URL:
        return

    for key in list(_local_cache.keys()):
        if key.startswith(prefix):
            _local_cache.pop(key, None)
