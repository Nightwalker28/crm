# Lynk

## Backend (FastAPI) with Docker

1. Copy `.env.sample` to `.env` (or create a `.env`) and supply the Google OAuth/JWT secrets.
2. Run `docker compose up --build` from the repository root to start the full local stack: Postgres, Redis, the FastAPI backend, the frontend, the Celery worker, and Celery beat.
3. The API becomes available at `http://localhost:8000/api/v1`.

The backend container waits for the Postgres healthcheck before starting and mounts `backend/uploads` to persist uploaded files between restarts.

join the postman workspace buddiesss...

https://app.getpostman.com/join-team?invite_code=dca25a69093b25c6de6d2eb14e44b79dc166adec6320840cfad9cc5e6bea76fc&target_code=8ff58402ea6fd6ecfa3fd337667990c6
