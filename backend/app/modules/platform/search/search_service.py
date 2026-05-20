from __future__ import annotations

from functools import lru_cache

from app.modules.platform.search.postgres_search_backend import PostgresSearchBackend
from app.modules.platform.search.search_backend import SearchBackend


@lru_cache(maxsize=1)
def get_search_backend() -> SearchBackend:
    return PostgresSearchBackend()
