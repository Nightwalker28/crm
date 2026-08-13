#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Lynk Codex checks =="

echo
echo "== Backend syntax check =="
docker compose exec -T backend python -m compileall app tests

echo
echo "== Database migration verification =="
docker compose exec -T backend python -m scripts.verify_migrations

echo
echo "== OpenAPI generation =="
docker compose exec -T backend python -m scripts.verify_openapi

echo
echo "== Generated API contract drift =="
"$ROOT_DIR/scripts/generate-contracts.sh" --check

echo
echo "== Backend unit tests =="
docker compose exec -T backend python -m unittest discover -s tests -p 'test_*.py'

echo
echo "== Design rules =="
# Source-level half of the design guard: the mechanically checkable rules in
# docs/design/design.md. The rendered half (Inter, monospace scope, contrast, control
# heights as computed, nested scrollers) lives in the design-rules and scroll-containers
# Playwright specs, which are run separately because they need a seeded browser session.
"$ROOT_DIR/scripts/check-design.sh"

echo
echo "== Frontend lint =="
docker compose exec -T frontend npm run lint

echo
echo "== Frontend build =="
docker compose exec -T frontend npm run build

echo
echo "All default Codex checks passed."
