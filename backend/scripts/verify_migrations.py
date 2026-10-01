"""Verify the Alembic chain against an isolated PostgreSQL database."""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.engine import make_url


BACKEND_DIR = Path(__file__).resolve().parents[1]


def _run_alembic(
    database_url: str,
    revision: str,
    *,
    postgres_options: str | None = None,
    version_table_schema: str | None = None,
) -> None:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    if postgres_options:
        environment["PGOPTIONS"] = postgres_options
    if version_table_schema:
        environment["ALEMBIC_VERSION_TABLE_SCHEMA"] = version_table_schema
    subprocess.run(
        ["alembic", "upgrade", revision],
        cwd=BACKEND_DIR,
        env=environment,
        check=True,
    )


def main() -> None:
    source_database_url = os.environ.get("DATABASE_URL", "").strip()
    if not source_database_url:
        raise RuntimeError("DATABASE_URL must be set")

    source_url = make_url(source_database_url)
    if source_url.get_backend_name() != "postgresql":
        raise RuntimeError("Migration verification requires PostgreSQL")

    alembic_config = Config(str(BACKEND_DIR / "alembic.ini"))
    revisions = ScriptDirectory.from_config(alembic_config)
    heads = revisions.get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Expected one Alembic head, found {len(heads)}: {heads}")

    head = revisions.get_revision(heads[0])
    prior_revision = head.down_revision
    if not isinstance(prior_revision, str):
        raise RuntimeError("The Alembic head must have one prior revision")

    isolation_name = f"lynk_migration_check_{uuid.uuid4().hex[:12]}"
    admin_database = os.environ.get("MIGRATION_ADMIN_DATABASE", "postgres")
    admin_url = source_url.set(database=admin_database)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    quoted_isolation_name = admin_engine.dialect.identifier_preparer.quote(isolation_name)
    isolated_url = source_url.set(database=isolation_name)
    verification_url = isolated_url
    postgres_options: str | None = None
    version_table_schema: str | None = None
    created_database = False
    schema_engine = None

    try:
        try:
            with admin_engine.connect() as connection:
                connection.execute(text(f"CREATE DATABASE {quoted_isolation_name}"))
            created_database = True
        except ProgrammingError as exc:
            if getattr(exc.orig, "pgcode", None) != "42501":
                raise
            print(
                "Database creation is unavailable; using an isolated temporary "
                "PostgreSQL schema instead."
            )
            schema_engine = create_engine(source_url, isolation_level="AUTOCOMMIT")
            quoted_isolation_name = (
                schema_engine.dialect.identifier_preparer.quote(isolation_name)
            )
            with schema_engine.connect() as connection:
                connection.execute(text(f"CREATE SCHEMA {quoted_isolation_name}"))
            verification_url = source_url
            postgres_options = f"-csearch_path={isolation_name},public"
            # `public` stays on the search path so shared extensions resolve,
            # which also means an unqualified `alembic_version` would resolve to
            # the real one. Pin the version table to the temporary schema so the
            # verification run cannot stamp the live database.
            version_table_schema = isolation_name

        rendered_verification_url = verification_url.render_as_string(hide_password=False)
        _run_alembic(
            rendered_verification_url,
            prior_revision,
            postgres_options=postgres_options,
            version_table_schema=version_table_schema,
        )
        _run_alembic(
            rendered_verification_url,
            "head",
            postgres_options=postgres_options,
            version_table_schema=version_table_schema,
        )

        verification_engine = create_engine(
            verification_url,
            connect_args={"options": postgres_options} if postgres_options else {},
        )
        version_table = (
            f"{quoted_isolation_name}.alembic_version"
            if version_table_schema
            else "alembic_version"
        )
        try:
            with verification_engine.connect() as connection:
                current_revision = connection.execute(
                    text(f"SELECT version_num FROM {version_table}")
                ).scalar_one()
        finally:
            verification_engine.dispose()

        if current_revision != heads[0]:
            raise RuntimeError(
                f"Migration verification ended at {current_revision}, expected {heads[0]}"
            )
        print(f"Migration verification passed at Alembic head {heads[0]}.")
    finally:
        if created_database:
            with admin_engine.connect() as connection:
                connection.execute(
                    text(
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                        "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                    ),
                    {"database_name": isolation_name},
                )
                connection.execute(
                    text(f"DROP DATABASE IF EXISTS {quoted_isolation_name}")
                )
        elif schema_engine is not None:
            with schema_engine.connect() as connection:
                connection.execute(
                    text(f"DROP SCHEMA IF EXISTS {quoted_isolation_name} CASCADE")
                )
            schema_engine.dispose()
        admin_engine.dispose()


if __name__ == "__main__":
    main()
