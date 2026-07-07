#!/usr/bin/env python3
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_STAGES = ROOT / "backend" / "app" / "modules" / "sales" / "opportunity_stages.py"
FRONTEND_STAGES = ROOT / "frontend" / "components" / "opportunities" / "opportunityStages.ts"


def _backend_metadata() -> tuple[list[str], dict[str, str]]:
    module = ast.parse(BACKEND_STAGES.read_text(encoding="utf-8"))
    values: dict[str, object] = {}
    for node in module.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in {"OPPORTUNITY_STAGE_ORDER", "OPPORTUNITY_STAGE_LABELS"}:
                values[node.targets[0].id] = ast.literal_eval(node.value)
    return values["OPPORTUNITY_STAGE_ORDER"], values["OPPORTUNITY_STAGE_LABELS"]  # type: ignore[return-value]


def _frontend_metadata() -> tuple[list[str], dict[str, str]]:
    source = FRONTEND_STAGES.read_text(encoding="utf-8")
    order_match = re.search(r"OPPORTUNITY_STAGE_ORDER = \[(.*?)\] as const", source, re.S)
    labels_match = re.search(r"OPPORTUNITY_STAGE_LABELS: Record<string, string> = \{(.*?)\};", source, re.S)
    if order_match is None or labels_match is None:
        raise ValueError("Could not parse frontend opportunity stage metadata.")
    return (
        re.findall(r'"([^"]+)"', order_match.group(1)),
        dict(re.findall(r"(\w+): \"([^\"]+)\"", labels_match.group(1))),
    )


def main() -> int:
    backend_order, backend_labels = _backend_metadata()
    frontend_order, frontend_labels = _frontend_metadata()
    expected_labels = {stage: backend_labels[stage] for stage in backend_order}
    if frontend_order != backend_order or frontend_labels != expected_labels:
        print("Opportunity stage metadata drift detected.", file=sys.stderr)
        print(f"backend order:  {backend_order}", file=sys.stderr)
        print(f"frontend order: {frontend_order}", file=sys.stderr)
        print(f"backend labels:  {expected_labels}", file=sys.stderr)
        print(f"frontend labels: {frontend_labels}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
