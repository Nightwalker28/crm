"""Load-test the realtime stream (13a H3): open N streams, then check the backend still answers.

Before H3, every open stream held a database session idle in transaction and polled on the
event loop, so about 30 tabs stalled the whole backend. This opens the streams as the
bootstrap admin, waits, then measures `/health` latency, a normal API call, and the
database connections held:

    docker compose exec -T backend python -m scripts.load_realtime --streams 100 --base http://127.0.0.1:8000

Exit status 1 when a check fails.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import time

import httpx
from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.user_management.models import User
from app.modules.user_management.services.auth import create_access_token


def _admin_token() -> str:
    with SessionLocal() as db:
        email = (settings.INITIAL_ADMIN_EMAIL or "").strip().lower()
        user = db.query(User).filter(User.email == email).first() if email else None
        if user is None:
            raise SystemExit("INITIAL_ADMIN_EMAIL does not name a user in this database")
        return create_access_token(user)


def _idle_in_transaction() -> int:
    with SessionLocal() as db:
        return int(
            db.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND state = 'idle in transaction'"
                )
            ).scalar()
            or 0
        )


async def _hold_stream(client: httpx.AsyncClient, url: str, opened: asyncio.Event, counter: list[int], stop: asyncio.Event):
    try:
        async with client.stream("GET", url) as response:
            if response.status_code != 200:
                return
            async for _chunk in response.aiter_text():
                counter[0] += 1
                if counter[0] >= counter[1]:
                    opened.set()
                await asyncio.sleep(0)
                if stop.is_set():
                    return
    except (httpx.HTTPError, asyncio.CancelledError):
        return


async def run(base: str, streams: int, hold_seconds: float) -> bool:
    token = _admin_token()
    cookies = {settings.ACCESS_TOKEN_COOKIE_NAME: token}
    limits = httpx.Limits(max_connections=streams + 20, max_keepalive_connections=streams + 20)
    timeout = httpx.Timeout(10.0, read=None)
    async with httpx.AsyncClient(base_url=base, cookies=cookies, limits=limits, timeout=timeout) as client:
        opened = asyncio.Event()
        stop = asyncio.Event()
        counter = [0, streams]  # first chunks seen, target
        tasks = [asyncio.create_task(_hold_stream(client, "/api/v1/platform/realtime/stream", opened, counter, stop)) for _ in range(streams)]
        try:
            await asyncio.wait_for(opened.wait(), timeout=60)
        except asyncio.TimeoutError:
            print(f"only {counter[0]} of {streams} streams sent their first event within 60s")
        print(f"{min(counter[0], streams)} streams open; holding {hold_seconds:.0f}s")
        await asyncio.sleep(hold_seconds)

        latencies = []
        for _ in range(20):
            started = time.perf_counter()
            response = await client.get("/health")
            latencies.append((time.perf_counter() - started) * 1000)
            response.raise_for_status()
        started = time.perf_counter()
        me = await client.get("/api/v1/users/me")
        me_ms = (time.perf_counter() - started) * 1000
        idle = await asyncio.to_thread(_idle_in_transaction)

        stop.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    p95 = statistics.quantiles(latencies, n=20)[-1]
    print(f"/health p50 {statistics.median(latencies):.1f} ms, p95 {p95:.1f} ms")
    print(f"/api/v1/users/me {me.status_code} in {me_ms:.1f} ms")
    print(f"sessions idle in transaction: {idle}")
    ok = counter[0] >= streams and p95 < 500 and me.status_code == 200 and me_ms < 2000 and idle < 5
    print("PASS" if ok else "FAIL")
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--streams", type=int, default=100)
    parser.add_argument("--hold", type=float, default=30.0, help="Seconds to keep the streams open before measuring")
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(run(args.base, args.streams, args.hold)) else 1)


if __name__ == "__main__":
    main()
