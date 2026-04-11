from __future__ import annotations

import sys

from app.bootstrap.seed import seed_initial_data
from app.core.config import settings


def main() -> int:
    result = seed_initial_data(
        admin_email=getattr(settings, "INITIAL_ADMIN_EMAIL", None),
        admin_password=getattr(settings, "INITIAL_ADMIN_PASSWORD", None),
        admin_first_name=getattr(settings, "INITIAL_ADMIN_FIRST_NAME", "System"),
        admin_last_name=getattr(settings, "INITIAL_ADMIN_LAST_NAME", "Admin"),
    )

    print(f"bootstrap: {result['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
