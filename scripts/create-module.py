#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = REPO_ROOT / "docs" / "module-template"

GENERATED_TEMPLATES = [
    ("backend/app/modules/__area__/repositories/__modules___repository.py", "backend/app/modules/{area}/repositories/{modules}_repository.py"),
    ("backend/app/modules/__area__/services/__modules___services.py", "backend/app/modules/{area}/services/{modules}_services.py"),
    ("backend/app/modules/__area__/routes/__modules___routes.py", "backend/app/modules/{area}/routes/{modules}_routes.py"),
    ("backend/alembic/versions/create___table__.py", "backend/alembic/versions/create_{table}.py"),
    ("frontend/types/__modules__.ts", "frontend/types/{modules}.ts"),
    ("frontend/hooks/__area__/use__Modules__.ts", "frontend/hooks/{area}/use{Modules}.ts"),
    ("frontend/components/__modules__/__Module__Form.tsx", "frontend/components/{modules}/{Module}Form.tsx"),
    ("frontend/components/__modules__/__Modules__Table.tsx", "frontend/components/{modules}/{Modules}Table.tsx"),
    ("frontend/app/dashboard/__area__/__modules__/page.tsx", "frontend/app/dashboard/{area}/{modules}/page.tsx"),
    ("frontend/app/dashboard/__area__/__modules__/new/page.tsx", "frontend/app/dashboard/{area}/{modules}/new/page.tsx"),
    ("frontend/app/dashboard/__area__/__modules__/[__id_field__]/page.tsx", "frontend/app/dashboard/{area}/{modules}/[{id_field}]/page.tsx"),
    ("frontend/app/dashboard/__area__/__modules__/[__id_field__]/edit/page.tsx", "frontend/app/dashboard/{area}/{modules}/[{id_field}]/edit/page.tsx"),
]

SNIPPETS = [
    ("Model snippet", "backend/app/modules/__area__/models.__module__.snippet.py", "backend/app/modules/{area}/models.py"),
    ("Schema snippet", "backend/app/modules/__area__/schema.__module__.snippet.py", "backend/app/modules/{area}/schema.py"),
    ("API router registration", "backend/app/api/v1/router.registration.snippet.py", "backend/app/api/v1/router.py"),
    ("Frontend route metadata", "frontend/snippets/route.registration.snippet.ts", "frontend/lib/routes.ts"),
    ("Sidebar canonical route", "frontend/snippets/sidebar.registration.snippet.tsx", "frontend/components/sidebar/Sidebar.tsx"),
    ("Module view config", "frontend/snippets/module-view.registration.snippet.ts", "frontend/lib/moduleViewConfigs.ts"),
    ("Protected field registry", "frontend/snippets/permission.registration.snippet.ts", "frontend/hooks/useModuleFieldConfigs.ts"),
]


def snake(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip()).strip("_").lower()
    if not normalized:
        raise ValueError("value cannot be empty")
    return normalized


def singularize(plural: str) -> str:
    if plural.endswith("ies") and len(plural) > 3:
        return plural[:-3] + "y"
    if plural.endswith("ses") and len(plural) > 3:
        return plural[:-2]
    if plural.endswith("s") and len(plural) > 1:
        return plural[:-1]
    return plural


def pascal(value: str) -> str:
    return "".join(part.capitalize() for part in value.split("_") if part)


def display_name(plural: str) -> str:
    return " ".join(part.capitalize() for part in plural.split("_") if part)


def replacements(area: str, modules: str) -> dict[str, str]:
    module = singularize(modules)
    module_key = f"{area}_{modules}" if area else modules
    table = module_key
    id_field = f"{module}_id"
    route_prefix = f"/dashboard/{area}/{modules}" if area else f"/dashboard/{modules}"
    api_prefix = f"/{area}/{modules}" if area else f"/{modules}"
    return {
        "__area__": area,
        "__module__": module,
        "__modules__": modules,
        "__Module__": pascal(module),
        "__Modules__": pascal(modules),
        "__MODULE_KEY__": module_key,
        "__MODULE_CONST__": module_key.upper(),
        "__table__": table,
        "__id_field__": id_field,
        "__api_prefix__": api_prefix,
        "__route_prefix__": route_prefix,
        "__frontend_path__": f"frontend/app/dashboard/{area}/{modules}",
        "__frontend_route__": route_prefix,
        "__display_name__": display_name(modules),
    }


def render_text(text: str, mapping: dict[str, str]) -> str:
    for placeholder, value in mapping.items():
        text = text.replace(placeholder, value)
    return text


def render_path(template: str, mapping: dict[str, str]) -> Path:
    path = render_text(template, mapping)
    return Path(path)


def format_target(template: str, values: dict[str, str]) -> Path:
    return Path(template.format(
        area=values["__area__"],
        module=values["__module__"],
        modules=values["__modules__"],
        Module=values["__Module__"],
        Modules=values["__Modules__"],
        module_key=values["__MODULE_KEY__"],
        table=values["__table__"],
        id_field=values["__id_field__"],
    ))


def create_files(values: dict[str, str], dry_run: bool) -> list[Path]:
    targets: list[tuple[Path, Path, str]] = []
    existing: list[Path] = []

    for template_rel, target_pattern in GENERATED_TEMPLATES:
        source = TEMPLATE_ROOT / template_rel
        target = REPO_ROOT / format_target(target_pattern, values)
        if target.exists():
            existing.append(target)
            continue
        targets.append((source, target, render_text(source.read_text(), values)))

    if existing:
        print("Refusing to overwrite existing files:", file=sys.stderr)
        for path in existing:
            print(f"  {path.relative_to(REPO_ROOT)}", file=sys.stderr)
        raise SystemExit(1)

    if dry_run:
        return [target for _, target, _ in targets]

    created: list[Path] = []
    for _, target, content in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        created.append(target)
    return created


def print_snippets(values: dict[str, str]) -> None:
    print("\nManual snippets to paste:")
    for title, template_rel, destination_pattern in SNIPPETS:
        source = TEMPLATE_ROOT / template_rel
        destination = format_target(destination_pattern, values)
        print(f"\n## {title} -> {destination}")
        print("```")
        print(render_text(source.read_text().rstrip(), values))
        print("```")

    print("\nAlso review whether this module needs:")
    print("- backend/app/bootstrap/seed.py module seed entry")
    print("- platform recycle bin registration")
    print("- global search/report adapters")
    print("- frontend record activity/document type unions")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a tenant-scoped CRUD module scaffold.")
    parser.add_argument("area", help="Module area, for example: sales")
    parser.add_argument("modules", help="Plural module name, for example: vendors")
    parser.add_argument("--dry-run", action="store_true", help="Show files that would be created without writing.")
    args = parser.parse_args()

    area = snake(args.area)
    modules = snake(args.modules)
    values = replacements(area, modules)
    created = create_files(values, args.dry_run)

    action = "Would create" if args.dry_run else "Created"
    print(f"{action} {len(created)} files:")
    for path in created:
        print(f"  {path.relative_to(REPO_ROOT)}")
    print_snippets(values)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
