from __future__ import annotations

from collections import Counter
from typing import Hashable, Iterable, NamedTuple, TypeVar

T = TypeVar("T", bound=Hashable)
V = TypeVar("V")


class DuplicateDetectionResult(NamedTuple):
    duplicates_in_request: set[T]
    existing_duplicates: set[T]
    duplicate_values: list[T]


def detect_duplicates(
    values: Iterable[T],
    existing_values: Iterable[T] | None = None,
) -> DuplicateDetectionResult:
    values_list = list(values)
    counts = Counter(values_list)
    duplicates_in_request = {value for value, count in counts.items() if count > 1}
    existing_set = set(existing_values or [])
    duplicate_values = sorted(duplicates_in_request | existing_set)
    return DuplicateDetectionResult(
        duplicates_in_request=duplicates_in_request,
        existing_duplicates=existing_set,
        duplicate_values=duplicate_values,
    )


def ensure_single_duplicate_action(
    *,
    replace_duplicates: bool,
    skip_duplicates: bool,
    create_new_records: bool,
) -> None:
    if sum(1 for flag in (replace_duplicates, skip_duplicates, create_new_records) if flag) > 1:
        raise ValueError(
            "Choose only one: replace_duplicates=true to overwrite, "
            "skip_duplicates=true to ignore existing files, or "
            "create_new_records=true to add new entries alongside existing ones."
        )


def drop_existing_duplicates(
    mapping: dict[T, V],
    existing_duplicates: set[T],
) -> dict[T, V]:
    if not existing_duplicates:
        return mapping
    return {key: value for key, value in mapping.items() if key not in existing_duplicates}
