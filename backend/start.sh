#!/bin/sh
set -eu

echo "Waiting for database..."
python3 - <<'PY'
import time
from sqlalchemy import create_engine, text
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, future=True, pool_pre_ping=True)

for attempt in range(60):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("Database is ready.")
        break
    except Exception as exc:
        if attempt == 59:
            raise
        print(f"Database not ready yet ({exc}). Retrying...")
        time.sleep(2)
PY

echo "Running database migrations..."
alembic upgrade head

echo "Running bootstrap seed..."
python3 -m scripts.bootstrap

echo "Starting backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
