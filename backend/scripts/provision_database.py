"""Create, migrate, seed and drop a named Lynk database on the DATABASE_URL server (13a H29).

UAT and browser tests each get their own database instead of the shared dev one:

    python -m scripts.provision_database create lynk_uat              # migrated, tenant + admin only
    python -m scripts.provision_database create lynk_e2e_1728 --seed demo
    python -m scripts.provision_database drop lynk_e2e_1728            # e2e databases only
    python -m scripts.provision_database drop lynk_uat --confirm lynk_uat
    python -m scripts.provision_database list

The new database uses the same server and credentials as DATABASE_URL. A process works in it
when started with `LYNK_DATABASE_NAME=<name>` (see app/core/config.py). Only names starting
`lynk_e2e_` or `lynk_uat` are accepted, and the DATABASE_URL database itself is never dropped.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
NAME_PATTERN = re.compile(r"^lynk_(e2e_[a-z0-9_]{1,40}|uat[a-z0-9_]{0,40})$")


def _source_url():
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        raise SystemExit("DATABASE_URL must be set")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise SystemExit("A provisioned database needs PostgreSQL")
    return url


def _admin_engine():
    url = _source_url().set(database=os.environ.get("MIGRATION_ADMIN_DATABASE", "postgres"))
    return create_engine(url, isolation_level="AUTOCOMMIT")


def _checked_name(name: str) -> str:
    if not NAME_PATTERN.match(name):
        raise SystemExit(f"{name!r} is not a provisionable name: use lynk_e2e_<suffix> or lynk_uat[_<suffix>]")
    if name == _source_url().database:
        raise SystemExit(f"{name!r} is the DATABASE_URL database; refusing")
    return name


def _exists(engine, name: str) -> bool:
    with engine.connect() as connection:
        return connection.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}).scalar() is not None


def _run(module_args: list[str], name: str) -> None:
    environment = {**os.environ, "LYNK_DATABASE_NAME": name}
    subprocess.run([sys.executable, *module_args], cwd=BACKEND_DIR, env=environment, check=True)


def create(name: str, *, seed: str, if_missing: bool) -> None:
    name = _checked_name(name)
    engine = _admin_engine()
    quoted = engine.dialect.identifier_preparer.quote(name)
    if _exists(engine, name):
        if not if_missing:
            raise SystemExit(f"{name} already exists (pass --if-missing to reuse it)")
        print(f"{name} exists; migrating it")
    else:
        with engine.connect() as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))
        print(f"Created {name}")
    _run(["-m", "alembic", "upgrade", "head"], name)
    _run(["-m", "scripts.bootstrap"], name)
    if seed == "demo":
        # The demo records, then a sample for every module the demo leaves empty, so every
        # detail route the browser tests walk is reachable.
        slug = os.environ.get("SINGLE_TENANT_SLUG", "default")
        _run(["-m", "scripts.seed_demo_crm", "--tenant-slug", slug], name)
        _run(["-m", "scripts.seed_module_samples", "--tenant-slug", slug], name)
    print(f"Ready: start a process with LYNK_DATABASE_NAME={name}")


def drop(name: str, *, confirm: str | None) -> None:
    name = _checked_name(name)
    if not name.startswith("lynk_e2e_") and confirm != name:
        raise SystemExit(f"Dropping {name} needs --confirm {name}")
    engine = _admin_engine()
    if not _exists(engine, name):
        print(f"{name} does not exist")
        return
    quoted = engine.dialect.identifier_preparer.quote(name)
    with engine.connect() as connection:
        connection.execute(text(f"DROP DATABASE {quoted} WITH (FORCE)"))
    print(f"Dropped {name}")


def list_databases() -> None:
    with _admin_engine().connect() as connection:
        rows = connection.execute(
            text("SELECT datname FROM pg_database WHERE datname LIKE 'lynk\\_e2e\\_%' OR datname LIKE 'lynk\\_uat%' ORDER BY datname")
        ).scalars()
        for row in rows:
            print(row)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    create_parser = commands.add_parser("create")
    create_parser.add_argument("name")
    create_parser.add_argument("--seed", choices=("none", "demo"), default="none")
    create_parser.add_argument("--if-missing", action="store_true", help="Reuse and migrate an existing database")
    drop_parser = commands.add_parser("drop")
    drop_parser.add_argument("name")
    drop_parser.add_argument("--confirm")
    commands.add_parser("list")
    args = parser.parse_args()
    if args.command == "create":
        create(args.name, seed=args.seed, if_missing=args.if_missing)
    elif args.command == "drop":
        drop(args.name, confirm=args.confirm)
    else:
        list_databases()


if __name__ == "__main__":
    main()
