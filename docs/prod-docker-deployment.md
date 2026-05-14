# Production Docker Deployment

This deployment runs Lynk CRM with app containers only. Postgres and Redis are expected to already exist outside this Compose stack.

## Files

- `docker-compose.prod.yml`: production Compose file for backend, frontend, Celery worker, and Celery beat.
- `backend/Dockerfile.prod`: multi-stage Python build for the FastAPI app and worker image.
- `backend/start.prod.sh`: backend startup script that waits for Postgres, runs migrations, runs bootstrap, and starts Uvicorn.
- `frontend/Dockerfile.prod`: multi-stage Next.js build using standalone output.
- `.env.production.example`: production environment template.

## Services

`backend`

- Builds `ghcr.io/nightwalker28/crm-backend:prod`.
- Exposes container port `8000`.
- Defaults to binding on host `127.0.0.1:8000` for use behind a reverse proxy.
- Mounts the shared `crm_uploads` volume at `/app/uploads`.
- Runs migrations and bootstrap on startup.

`frontend`

- Builds `ghcr.io/nightwalker28/crm-frontend:prod`.
- Exposes container port `3000`.
- Defaults to binding on host `127.0.0.1:3000` for use behind a reverse proxy.
- Uses Next.js standalone runtime output.

`celery-worker`

- Uses the backend image.
- Runs queued background jobs.
- Needs the same backend environment and upload volume.

`celery-beat`

- Uses the backend image.
- Runs scheduled jobs such as refresh-token cleanup, data-transfer cleanup, and reminder scans.

## Build And Start

Create the real production env file:

```bash
cp .env.production.example .env.production
```

Edit `.env.production`, then run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Check status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
```

Stop the app:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Do not use `down -v` unless you intentionally want to delete the Docker upload volume.

## Required Environment

Public URL settings:

- `FRONTEND_ORIGIN`: public frontend origin used by backend-generated links and CORS, for example `https://crm.example.com`.
- `NEXT_PUBLIC_API_BASE_URL`: public API origin used by browser-side frontend requests, for example `https://api.crm.example.com`.

Postgres:

- `DATABASE_URL`: SQLAlchemy/Postgres URL, for example `postgresql://lynk:password@host.docker.internal:5432/lynk_crm`.
- `DB_POOL_SIZE`: persistent backend DB connections per backend process. Default example is `10`.
- `DB_MAX_OVERFLOW`: temporary extra DB connections per backend process. Default example is `20`.
- `DB_POOL_RECYCLE_SECONDS`: recycles pooled DB connections after this many seconds. Code default is `1800`.
- `DB_POOL_PRE_PING`: set `true` to validate pooled DB connections before use. Code default is false.
- `DB_STATEMENT_TIMEOUT_MS`: per-statement timeout passed to Postgres connections. Code default is `30000`.
- `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`: idle transaction timeout passed to Postgres connections. Code default is `60000`.

Redis:

- `REDIS_URL`: app cache and rate-limit storage.
- `CELERY_BROKER_URL`: Celery queue broker. If omitted, the backend falls back to `REDIS_URL`.
- `REDIS_CIRCUIT_BREAKER_FAILURE_THRESHOLD`: failed Redis operations before temporary bypass. Code default is `3`.
- `REDIS_CIRCUIT_BREAKER_COOLDOWN_SECONDS`: Redis retry cooldown after circuit opens. Code default is `60`.

Security:

- `DEBUG=false`: required for production.
- `JWT_SECRET`: long random secret for auth/session/document/client-portal tokens.
- `JWT_ALGORITHM`: defaults to `HS256`.
- `COOKIE_SECURE=true`: required when served through HTTPS.
- `COOKIE_SAMESITE=lax`: correct for same-site frontend/backend deployment.
- `ALLOWED_DOMAINS`: comma-separated email domains allowed for user accounts, for example `example.com,example.org`.

Bootstrap:

- `INITIAL_ADMIN_EMAIL`: first admin email.
- `INITIAL_ADMIN_PASSWORD`: first admin password.
- `INITIAL_ADMIN_FIRST_NAME`: defaults to `System`.
- `INITIAL_ADMIN_LAST_NAME`: defaults to `Admin`.

Optional integrations:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`
- `GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED`
- `MAIL_CREDENTIAL_SECRET`

Runtime sizing:

- `WEB_CONCURRENCY`: number of Uvicorn worker processes inside the backend container. The prod script defaults to `2`.
- `DATA_TRANSFER_BACKGROUND_ROW_THRESHOLD`
- `DATA_TRANSFER_BACKGROUND_FILE_BYTES_THRESHOLD`
- `DATA_TRANSFER_RESULT_RETENTION_DAYS`
- `DATA_TRANSFER_RESULT_CLEANUP_INTERVAL_SECONDS`
- `TASK_DUE_ALERT_SCAN_INTERVAL_SECONDS`
- `FOLLOW_UP_REMINDER_SCAN_INTERVAL_SECONDS`

Upload and storage limits:

- `DOCUMENT_MAX_UPLOAD_BYTES`
- `DOCUMENT_TENANT_STORAGE_LIMIT_BYTES`
- `IO_SEARCH_UPLOAD_DIR` is set by Compose to `/app/uploads/io-search`.

## Postgres Connection Notes

The production Compose file does not run Postgres. If Postgres runs directly on the same server as Docker, the provided example uses:

```env
DATABASE_URL=postgresql://lynk:change-me@host.docker.internal:5432/lynk_crm
```

`host.docker.internal` works because `docker-compose.prod.yml` maps it to Docker's Linux host gateway.

Make sure Postgres is reachable from containers:

- Postgres must listen on a TCP address reachable from Docker, not only a Unix socket.
- If Postgres only listens on `127.0.0.1`, containers usually cannot reach it through the Docker host gateway.
- Prefer binding Postgres to a private host address or Docker bridge-reachable address and restrict access with firewall rules and `pg_hba.conf`.
- Create a dedicated database and user for Lynk.
- The DB user must be able to run the app migrations.

Migrations use Postgres features for search. Ensure `pg_trgm` is available. Newer migrations also try to enable `unaccent` and `pg_stat_statements`; `pg_stat_statements` is best-effort and may require server-level configuration. If the app DB user cannot create extensions, install required extensions as a Postgres admin before first boot.

Example admin setup:

```sql
CREATE DATABASE lynk_crm;
CREATE USER lynk WITH PASSWORD 'change-me';
GRANT ALL PRIVILEGES ON DATABASE lynk_crm TO lynk;
\c lynk_crm
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

## Redis Connection Notes

The production Compose file does not run Redis. If Redis runs directly on the same server as Docker, the provided example uses:

```env
REDIS_URL=redis://host.docker.internal:6379/2
CELERY_BROKER_URL=redis://host.docker.internal:6379/3
```

Use Redis logical databases that are not already used by other apps. Avoid database `0` when that Redis server is shared.

Recommended split:

- `REDIS_URL`: one dedicated DB index for Lynk cache/rate-limit keys.
- `CELERY_BROKER_URL`: another dedicated DB index for Celery queue keys.

This matters because the current app does not expose a Redis key-prefix setting. Separating by Redis logical DB is the safest simple isolation when sharing one Redis instance.

If Redis uses a password:

```env
REDIS_URL=redis://:password@host.docker.internal:6379/2
CELERY_BROKER_URL=redis://:password@host.docker.internal:6379/3
```

If Redis uses TLS, use `rediss://` URLs if your Redis deployment supports them.

Make sure the Redis server has enough logical databases for the selected indexes. The default Redis config usually provides `databases 16`, which supports indexes `0` through `15`.

## Reverse Proxy

The Compose file binds backend and frontend to localhost by default:

```env
FRONTEND_BIND=127.0.0.1:3000
BACKEND_BIND=127.0.0.1:8000
```

Put Nginx, Caddy, or another reverse proxy in front of them for TLS.

Typical routing:

- `https://crm.example.com` -> `127.0.0.1:3000`
- `https://api.crm.example.com` -> `127.0.0.1:8000`

With this split, set:

```env
FRONTEND_ORIGIN=https://crm.example.com
NEXT_PUBLIC_API_BASE_URL=https://api.crm.example.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
```

## Startup Behavior

On backend container start:

1. The script waits for `DATABASE_URL` to accept connections.
2. It runs `alembic upgrade head`.
3. It runs `python3 -m scripts.bootstrap`.
4. It starts Uvicorn with `WEB_CONCURRENCY` workers.

This is fine for a single backend container. If you later run multiple backend replicas, move migrations/bootstrap to a one-off release job so multiple replicas do not run migrations at the same time.

## Production Checks

Before first live boot:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml build backend frontend
```

After boot:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs celery-worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs celery-beat
```

If the backend fails to start, check DB reachability and migration permissions first. If jobs are not running, check `CELERY_BROKER_URL` and Redis reachability.

## GitHub Container Registry

Production images are tagged for GHCR without the Lynk product name:

```bash
ghcr.io/nightwalker28/crm-backend:prod
ghcr.io/nightwalker28/crm-frontend:prod
```

The Dockerfiles include OCI `org.opencontainers.image.source` labels pointing at `https://github.com/Nightwalker28/crm`, which lets GitHub associate the container packages with the repository.

Login before pushing:

```bash
docker login ghcr.io -u Nightwalker28
```

Use a GitHub personal access token with package write permission as the password.

Build and push:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build backend frontend
docker push ghcr.io/nightwalker28/crm-backend:prod
docker push ghcr.io/nightwalker28/crm-frontend:prod
```
