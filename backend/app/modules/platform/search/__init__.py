"""Search backend abstraction for platform-backed module search."""

from app.modules.platform.search.search_backend import SearchBackend, SearchQuery
from app.modules.platform.search.postgres_search_backend import PostgresSearchBackend
from app.modules.platform.search.search_service import get_search_backend

__all__ = ["PostgresSearchBackend", "SearchBackend", "SearchQuery", "get_search_backend"]
