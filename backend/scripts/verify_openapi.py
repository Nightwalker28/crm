"""Generate and serialize the FastAPI OpenAPI contract."""

from __future__ import annotations

import json

from app.main import app


def main() -> None:
    schema = app.openapi()
    if not schema.get("openapi") or not schema.get("paths"):
        raise RuntimeError("OpenAPI generation returned an incomplete schema")
    json.dumps(schema, allow_nan=False, sort_keys=True)
    print(
        "OpenAPI generation passed "
        f"for {len(schema['paths'])} paths and "
        f"{len(schema.get('components', {}).get('schemas', {}))} schemas."
    )


if __name__ == "__main__":
    main()
