"""States and provinces: ISO 3166-2 top-level subdivisions per country (13b §3.6, F3.6).

Bundled from Debian iso-codes like the country list (13b §5 decision 6). An address's state
column keeps the subdivision's **name**, not its code: names read correctly in every list,
export, report and print without a lookup per surface. Codes (`US-CA`, or `CA` within the
US) and names in any case or accent are accepted on input and stored as the bundled name.

A country with no subdivisions in the list keeps a free-text state.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Subdivision:
    code: str
    name: str
    type: str


def _clean_name(name: str) -> str:
    # iso-codes appends alternative names in brackets: "Wales [Cymru GB-CYM]".
    return re.sub(r"\s*\[[^\]]*\]\s*$", "", name).strip()


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", stripped.casefold()).strip()


@lru_cache(maxsize=1)
def _all() -> dict[str, tuple[Subdivision, ...]]:
    path = Path(__file__).resolve().parent / "data" / "iso_3166_2.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        country: tuple(
            sorted(
                (Subdivision(item["code"], _clean_name(item["name"]), item.get("type") or "") for item in items),
                key=lambda item: _fold(item.name),
            )
        )
        for country, items in data["subdivisions"].items()
    }


@lru_cache(maxsize=None)
def _lookup(country: str) -> dict[str, str]:
    table: dict[str, str] = {}
    for item in _all().get(country, ()):
        suffix = item.code.split("-", 1)[-1]
        for key in (item.code, suffix, item.name):
            table.setdefault(_fold(key), item.name)
    return table


def subdivisions(country_code: str | None) -> tuple[Subdivision, ...]:
    if not country_code:
        return ()
    return _all().get(country_code.strip().upper(), ())


def has_subdivisions(country_code: str | None) -> bool:
    return bool(subdivisions(country_code))


def resolve_subdivision(country_code: str | None, value: str | None) -> str | None:
    """The bundled name for a code or name within the country, or None when it does not match."""

    if not country_code or not value or not value.strip():
        return None
    return _lookup(country_code.strip().upper()).get(_fold(value))
