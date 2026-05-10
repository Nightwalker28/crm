#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Lynk Codex checks =="

echo
echo "== Backend syntax check =="
docker compose exec -T backend python -m compileall app tests

echo
echo "== Backend unit tests =="
docker compose exec -T backend python -m unittest discover -s tests -p 'test_*.py'

echo
echo "== Frontend lint =="
docker compose exec -T frontend npm run lint

echo
echo "== Frontend build =="
docker compose exec -T frontend npm run build

echo
echo "All default Codex checks passed."
