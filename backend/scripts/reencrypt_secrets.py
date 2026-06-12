from __future__ import annotations

import argparse
import json

from app.core.database import SessionLocal
from app.core.secret_rotation import SECRET_TYPES, reencrypt_application_secrets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Re-encrypt application secrets with the current APP_ENCRYPTION_SECRET.")
    parser.add_argument("--secret-type", action="append", choices=SECRET_TYPES, help="Secret type to rotate. Repeatable. Defaults to all.")
    parser.add_argument("--tenant-id", type=int, default=None, help="Limit tenant-owned secrets to one tenant.")
    parser.add_argument("--apply", action="store_true", help="Write changes. Without this flag the command is a dry run.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db = SessionLocal()
    try:
        result = reencrypt_application_secrets(
            db,
            secret_types=args.secret_type,
            tenant_id=args.tenant_id,
            dry_run=not args.apply,
        )
        print(json.dumps(result, indent=2, sort_keys=True, default=str))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
