from __future__ import annotations


def parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields
