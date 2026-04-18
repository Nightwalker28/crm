from __future__ import annotations

from collections import Counter
from enum import Enum
from typing import Hashable, Iterable, NamedTuple, TypeVar

T = TypeVar("T", bound=Hashable)
V = TypeVar("V")


class DuplicateDetectionResult(NamedTuple):
    duplicates_in_request: set[T]
    existing_duplicates: set[T]
    duplicate_values: list[T]


class DuplicateMode(str, Enum):
    skip = "skip"
    overwrite = "overwrite"
    merge = "merge"


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


def resolve_duplicate_mode(
    *,
    duplicate_mode: str | None,
    default_mode: str | None = None,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
) -> DuplicateMode:
    explicit = (duplicate_mode or "").strip().lower() or None
    if explicit:
        try:
            return DuplicateMode(explicit)
        except ValueError as exc:
            raise ValueError("duplicate_mode must be one of: skip, overwrite, merge") from exc

    ensure_single_duplicate_action(
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    if replace_duplicates:
        return DuplicateMode.overwrite
    if skip_duplicates:
        return DuplicateMode.skip
    if create_new_records:
        return DuplicateMode.merge
    fallback = (default_mode or DuplicateMode.skip.value).strip().lower()
    try:
        return DuplicateMode(fallback)
    except ValueError as exc:
        raise ValueError("default duplicate mode must be one of: skip, overwrite, merge") from exc


def should_merge_value(current_value, incoming_value) -> bool:
    if incoming_value is None:
        return False
    if isinstance(incoming_value, str) and not incoming_value.strip():
        return False
    if isinstance(incoming_value, (list, dict)) and not incoming_value:
        return False
    if current_value is None:
        return True
    if isinstance(current_value, str) and not current_value.strip():
        return True
    if isinstance(current_value, (list, dict)) and not current_value:
        return True
    return False


def drop_existing_duplicates(
    mapping: dict[T, V],
    existing_duplicates: set[T],
) -> dict[T, V]:
    if not existing_duplicates:
        return mapping
    return {key: value for key, value in mapping.items() if key not in existing_duplicates}
