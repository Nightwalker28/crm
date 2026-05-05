import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import Column, Numeric, String
from starlette.datastructures import Headers

from app.core import cache, module_csv, module_export, module_filters, module_search, pagination, postgres_search, uploads
from app.core.duplicates import detect_duplicates
from app.core.passwords import (
    PBKDF2_ALGORITHM,
    PBKDF2_ITERATIONS,
    get_password_policy,
    password_hash_needs_upgrade,
    validate_password_strength,
)


class FakeQuery:
    def __init__(self):
        self.filters = []

    def filter(self, expression):
        self.filters.append(expression)
        return self


class CacheTests(unittest.TestCase):
    def tearDown(self):
        cache._local_cache.clear()
        cache._redis_client = None
        cache._redis_consecutive_failures = 0
        cache._redis_circuit_open_until = 0.0

    def test_local_cache_evicts_oldest_when_max_size_is_exceeded(self):
        with patch.object(cache, "_get_redis_client", return_value=None), \
             patch.object(cache.settings, "REDIS_URL", None), \
             patch.object(cache, "MAX_LOCAL_CACHE_SIZE", 2):
            cache.cache_set_json("a", {"value": 1})
            cache.cache_set_json("b", {"value": 2})
            cache.cache_set_json("c", {"value": 3})

            self.assertNotIn("a", cache._local_cache)
            self.assertEqual(cache.cache_get_json("b"), {"value": 2})
            self.assertEqual(cache.cache_get_json("c"), {"value": 3})

    def test_redis_configured_does_not_fall_back_to_local_cache_when_unavailable(self):
        with patch.object(cache.settings, "REDIS_URL", "redis://redis:6379/0"), \
             patch.object(cache, "_get_redis_client", return_value=None):
            cache.cache_set_json("redis-key", {"value": 1})

        self.assertNotIn("redis-key", cache._local_cache)

    def test_redis_connection_failures_open_circuit_temporarily(self):
        class FailingRedisModule:
            class Redis:
                @classmethod
                def from_url(cls, *_args, **_kwargs):
                    raise TimeoutError("redis timeout")

        with patch.object(cache.settings, "REDIS_URL", "redis://redis:6379/0"), \
             patch.object(cache.settings, "REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD", 2), \
             patch.object(cache.settings, "REDIS_CIRCUIT_BREAKER_COOLDOWN_SECONDS", 60), \
             patch.object(cache, "redis", FailingRedisModule):
            self.assertIsNone(cache._get_redis_client())
            self.assertIsNone(cache._get_redis_client())

        self.assertGreater(cache._redis_circuit_open_until, 0)


class ModuleCsvTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_upload_bytes_rejects_non_csv_content_type_for_csv_upload(self):
        upload = UploadFile(
            file=io.BytesIO(b"name\nAcme\n"),
            filename="records.csv",
            headers=Headers({"content-type": "application/octet-stream"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await module_csv.read_upload_bytes(upload, allowed_extensions={"csv"})

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid file content type.")

    async def test_read_upload_bytes_accepts_uppercase_csv_extension_and_text_content(self):
        upload = UploadFile(
            file=io.BytesIO(b"name\nAcme\n"),
            filename="RECORDS.CSV",
            headers=Headers({"content-type": "text/plain; charset=utf-8"}),
        )

        content = await module_csv.read_upload_bytes(upload, allowed_extensions={"csv"})

        self.assertEqual(content, b"name\nAcme\n")

    async def test_dict_rows_to_csv_bytes_sanitizes_formula_cells(self):
        content = module_export.dict_rows_to_csv_bytes(
            headers=["name", "amount"],
            rows=[
                {"name": "=cmd", "amount": "+10"},
                {"name": "Safe", "amount": 5},
            ],
        ).decode("utf-8")

        self.assertIn("'=cmd", content)
        self.assertIn("'+10", content)
        self.assertIn("Safe,5", content)

    async def test_batched_csv_zip_file_writes_temp_file(self):
        path, meta = module_export.batched_csv_zip_file(
            rows=[{"name": "A"}, {"name": "B"}],
            batch_size=1,
            file_prefix="records",
            serialize_row=lambda rows: module_export.dict_rows_to_csv_bytes(
                headers=["name"],
                rows=rows,
            ).decode("utf-8"),
        )

        try:
            self.assertTrue(path.exists())
            self.assertEqual(meta, {"batches": 2, "rows": 2})
            with zipfile.ZipFile(path) as zipf:
                self.assertEqual(
                    sorted(zipf.namelist()),
                    ["records_batch_1.csv", "records_batch_2.csv"],
                )
        finally:
            path.unlink(missing_ok=True)

    async def test_count_csv_rows_bytes_streams_non_blank_rows(self):
        content = b"name\nAcme\n\nBeta\n"

        self.assertEqual(module_csv.count_csv_rows_bytes(content), 2)

    async def test_rows_from_csv_text_rejects_too_many_rows(self):
        content = "name\nA\nB\n"

        with patch.object(module_csv, "MAX_CSV_ROWS", 1):
            with self.assertRaises(HTTPException) as exc:
                module_csv.rows_from_csv_text(content)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "CSV exceeds maximum row limit.")


class ModuleFilterTests(unittest.TestCase):
    def test_parse_filter_conditions_rejects_large_payload(self):
        with self.assertRaisesRegex(ValueError, "Filter payload too large"):
            module_filters.parse_filter_conditions(" " * 64_001)

    def test_parse_filter_conditions_rejects_unknown_operator(self):
        with self.assertRaisesRegex(ValueError, "Unknown filter operator"):
            module_filters.parse_filter_conditions(
                '[{"field": "amount", "operator": "greater"}]'
            )

    def test_numeric_filter_rejects_text_column(self):
        definition = {"expression": Column("amount_text", String()), "type": "number"}

        with self.assertRaisesRegex(
            ValueError,
            "Numeric filters are only supported for numeric fields",
        ):
            module_filters._build_condition_expression(
                definition,
                {"operator": "gt", "value": "10", "values": None},
            )

    def test_numeric_filter_allows_numeric_column(self):
        definition = {"expression": Column("amount", Numeric()), "type": "number"}

        expression = module_filters._build_condition_expression(
            definition,
            {"operator": "gt", "value": "10", "values": None},
        )

        self.assertIsNotNone(expression)


class DuplicateDetectionTests(unittest.TestCase):
    def test_detect_duplicates_keeps_request_and_existing_sets_separate(self):
        detection = detect_duplicates(["A", "A", "B"], existing_values={"C"})

        self.assertEqual(detection.duplicates_in_request, {"A"})
        self.assertEqual(detection.existing_duplicates, {"C"})
        self.assertEqual(detection.request_duplicate_values, ["A"])
        self.assertEqual(detection.existing_duplicate_values, ["C"])
        self.assertEqual(detection.duplicate_values, ["A", "C"])


class PaginationTests(unittest.TestCase):
    def test_public_pagination_rejects_values_above_configured_max(self):
        with patch.object(pagination, "MAX_PUBLIC_PAGE_SIZE", 50):
            with self.assertRaises(HTTPException) as exc:
                pagination.get_pagination(page=1, page_size=100)

        self.assertEqual(exc.exception.status_code, 400)

    def test_internal_pagination_constructor_allows_large_page_size(self):
        result = pagination.create_pagination(page=2, page_size=1000)

        self.assertEqual(result.offset, 1000)
        self.assertEqual(result.limit, 1000)


class PasswordTests(unittest.TestCase):
    def test_password_strength_rejects_common_password(self):
        with self.assertRaisesRegex(ValueError, "too common"):
            validate_password_strength("Password1234")

    def test_password_policy_exposes_minimum_length(self):
        policy = get_password_policy()

        self.assertEqual(policy["min_length"], 12)
        self.assertTrue(policy["requirements"])

    def test_password_hash_upgrade_detects_lower_iteration_hash(self):
        old_hash = f"pbkdf2_{PBKDF2_ALGORITHM}$1$c2FsdA==$ZGlnZXN0"

        self.assertTrue(password_hash_needs_upgrade(old_hash))
        self.assertFalse(
            password_hash_needs_upgrade(
                f"pbkdf2_{PBKDF2_ALGORITHM}${PBKDF2_ITERATIONS}$c2FsdA==$ZGlnZXN0"
            )
        )


class PostgresSearchTests(unittest.TestCase):
    def test_short_search_term_uses_only_ilike_without_rank(self):
        query = FakeQuery()
        document = Column("document", String())

        with patch.object(postgres_search, "TRIGRAM_MIN_SEARCH_LENGTH", 3):
            filtered_query, rank = postgres_search.apply_trigram_search(
                query,
                search="ab",
                document=document,
            )

        self.assertIs(filtered_query, query)
        self.assertIsNone(rank)
        self.assertEqual(len(query.filters), 1)

    def test_long_search_term_returns_similarity_rank(self):
        query = FakeQuery()
        document = Column("document", String())

        filtered_query, rank = postgres_search.apply_trigram_search(
            query,
            search="acme",
            document=document,
        )

        self.assertIs(filtered_query, query)
        self.assertIsNotNone(rank)
        self.assertEqual(len(query.filters), 1)


class ModuleSearchTests(unittest.TestCase):
    def test_default_order_by_uses_explicit_none_check(self):
        class OrderQuery:
            def __init__(self):
                self.ordering = None

            def order_by(self, *ordering):
                self.ordering = ordering
                return self

        query = OrderQuery()
        ordering = [Column("created_at", String())]

        result = module_search.apply_ranked_search(
            query,
            search=None,
            document=Column("document", String()),
            default_order_by=ordering,
        )

        self.assertIs(result, query)
        self.assertEqual(query.ordering, tuple(ordering))


class UploadCleanupTests(unittest.TestCase):
    def test_delete_local_media_file_accepts_media_path_without_leading_slash(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            media_root = Path(tmpdir) / "media"
            target = media_root / "profile-assets" / "user-1" / "photo.jpg"
            target.parent.mkdir(parents=True)
            target.write_text("image")

            with patch.object(uploads, "MEDIA_ROOT_DIR", media_root):
                uploads.delete_local_media_file("media/profile-assets/user-1/photo.jpg")

            self.assertFalse(target.exists())

    def test_delete_local_media_file_ignores_external_urls(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            media_root = Path(tmpdir) / "media"
            target = media_root / "profile-assets" / "user-1" / "photo.jpg"
            target.parent.mkdir(parents=True)
            target.write_text("image")

            with patch.object(uploads, "MEDIA_ROOT_DIR", media_root):
                uploads.delete_local_media_file("https://example.com/photo.jpg")

            self.assertTrue(target.exists())

    def test_delete_local_media_file_warns_for_unexpected_local_path(self):
        with self.assertLogs("app.core.uploads", level="WARNING") as logs:
            uploads.delete_local_media_file("profile-assets/user-1/photo.jpg")

        self.assertTrue(any("outside media root" in message for message in logs.output))


class ImageUploadTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_image_upload_accepts_png_magic_bytes(self):
        upload = UploadFile(
            file=io.BytesIO(b"\x89PNG\r\n\x1a\npayload"),
            filename="logo.png",
            headers=Headers({"content-type": "image/png"}),
        )

        content, extension = await uploads.read_image_upload(upload)

        self.assertEqual(content, b"\x89PNG\r\n\x1a\npayload")
        self.assertEqual(extension, "png")

    async def test_read_image_upload_rejects_spoofed_image(self):
        upload = UploadFile(
            file=io.BytesIO(b"not really an image"),
            filename="logo.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await uploads.read_image_upload(upload)

        self.assertEqual(exc.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
