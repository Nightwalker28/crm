"""Export the bounded record-layout OpenAPI slice consumed by the frontend contract layer.

This is the backend half of the layout-family contract pilot described in
``docs/crm-evolution/10-dx-ci-api-contracts.md``. It writes a canonical JSON document
to stdout so the host-side generator/drift scripts can compare it against the committed
artifact without needing a writable bind mount inside the container.

Only the record-layout paths and the schemas they transitively reference are exported.
Widening the pilot means changing ``PATH_PREFIX`` deliberately, not letting unrelated
API families leak into the generated types.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from app.main import app


CONTRACT_TITLE = "Lynk record layout contract"
PATH_PREFIX = "/api/v1/record-layouts"
SCHEMA_REF_PREFIX = "#/components/schemas/"
REPAIR_COMMAND = "./scripts/generate-contracts.sh"


def _collect_refs(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            found.add(ref)
        for value in node.values():
            _collect_refs(value, found)
    elif isinstance(node, list):
        for item in node:
            _collect_refs(item, found)


def _schema_name(ref: str) -> str:
    if not ref.startswith(SCHEMA_REF_PREFIX):
        raise RuntimeError(
            f"The record-layout contract references {ref!r}, which is not a component schema. "
            "Only '#/components/schemas/...' references can be exported into the bounded slice."
        )
    return ref[len(SCHEMA_REF_PREFIX) :]


def build_contract(schema: dict[str, Any]) -> dict[str, Any]:
    paths = {
        path: item
        for path, item in schema.get("paths", {}).items()
        if path == PATH_PREFIX or path.startswith(f"{PATH_PREFIX}/")
    }
    if not paths:
        raise RuntimeError(
            f"No OpenAPI paths start with {PATH_PREFIX!r}. The record-layout router was renamed, "
            "unmounted, or moved; update PATH_PREFIX in this script before regenerating contracts."
        )

    available = schema.get("components", {}).get("schemas", {})
    selected: dict[str, Any] = {}
    pending: set[str] = set()
    refs: set[str] = set()
    _collect_refs(paths, refs)
    pending.update(_schema_name(ref) for ref in refs)

    while pending:
        name = pending.pop()
        if name in selected:
            continue
        definition = available.get(name)
        if definition is None:
            raise RuntimeError(
                f"The record-layout contract references the missing component schema {name!r}."
            )
        selected[name] = definition
        nested: set[str] = set()
        _collect_refs(definition, nested)
        pending.update(_schema_name(ref) for ref in nested)

    return {
        "openapi": schema["openapi"],
        "info": {"title": CONTRACT_TITLE, "version": schema["info"]["version"]},
        "paths": paths,
        "components": {"schemas": selected},
    }


def main() -> None:
    try:
        contract = build_contract(app.openapi())
    except RuntimeError as error:
        print(f"{error}\nRepair with: {REPAIR_COMMAND}", file=sys.stderr)
        raise SystemExit(1) from error

    # sort_keys keeps the artifact byte-stable across runs and Python versions so the
    # drift check only fails on real contract changes.
    sys.stdout.write(json.dumps(contract, indent=2, sort_keys=True, ensure_ascii=False))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
