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
echo "== Design token drift =="
# The named Tailwind radius aliases are deliberately unmapped in globals.css, so a
# leftover emits no CSS at all and silently renders a square corner. A computed-style
# check cannot catch that (border-radius: 0 is legitimate elsewhere), so it is caught
# here at the source. See docs/design/design.md 4.3.
if grep -rnE '\brounded-(sm|md|lg|xl|2xl|3xl)\b' frontend/app frontend/components frontend/lib \
     --include='*.tsx' --include='*.ts'; then
  echo
  echo "Found bare Tailwind radius classes. They emit no CSS and render square corners."
  echo "Use a radius token named for what the shape wraps, e.g."
  echo "  rounded-[var(--radius-control)]  buttons, inputs, selects"
  echo "  rounded-[var(--radius-card)]     cards, table containers, callouts"
  echo "rounded-full and rounded-none are still allowed."
  exit 1
fi
echo "No bare radius aliases."

echo
echo "== Frontend lint =="
docker compose exec -T frontend npm run lint

echo
echo "== Frontend build =="
docker compose exec -T frontend npm run build

echo
echo "All default Codex checks passed."
