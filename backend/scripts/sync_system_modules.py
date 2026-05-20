from __future__ import annotations

from app.core.database import SessionLocal
from app.modules.platform.services.system_module_sync import sync_system_modules


def main() -> int:
    db = SessionLocal()
    try:
        result = sync_system_modules(db)
        print(
            "system module sync: "
            f"modules={result.modules_upserted} "
            f"tenant_configs={result.tenant_configs_upserted} "
            f"field_configs={result.field_configs_upserted} "
            f"access_permissions={result.access_permissions_created}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

