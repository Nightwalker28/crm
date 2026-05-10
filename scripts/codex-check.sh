#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Lynk Codex checks =="

echo
echo "== Backend syntax check =="
(
  cd "$ROOT_DIR/backend"
  python -m compileall app tests
)

echo
echo "== Backend unit tests =="
(
  cd "$ROOT_DIR/backend"
  python -m unittest discover -s tests -p 'test_*.py'
)

echo
echo "== Frontend lint =="
(
  cd "$ROOT_DIR/frontend"
  npm run lint
)

echo
echo "== Frontend build =="
(
  cd "$ROOT_DIR/frontend"
  npm run build
)

echo
echo "All default Codex checks passed."
