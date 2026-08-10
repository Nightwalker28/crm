# Generated API contracts

This directory holds the generated half of the layout-family contract pilot
(`docs/crm-evolution/10-dx-ci-api-contracts.md`, Phase 2). It currently covers one bounded
API family: the record-layout runtime endpoints under `/api/v1/record-layouts`.

## Files

| Path | Owner | Edit by hand? |
|---|---|---|
| `record-layouts.openapi.json` | `backend/scripts/export_layout_contract.py` | No |
| `generated/record-layouts.ts` | `openapi-typescript` (pinned in `package.json`) | No |
| `../lib/contracts/recordLayouts.ts` | Engineers | Yes — this is the adapter |

Both generated files are committed. CI builds the frontend image from repository source with
no bind mount, so the artifacts must exist in the repo; generating them during the image
build would remove the drift signal we want.

## Commands

```bash
./scripts/generate-contracts.sh           # regenerate both artifacts (the repair command)
./scripts/generate-contracts.sh --check   # fail on drift; runs inside scripts/codex-check.sh
```

Both modes read the live contract from the running `backend` container, so bring the stack up
first (`docker compose up -d backend frontend`). The regenerating form writes through the
frontend bind mount, which means it is a local developer command — CI only ever runs `--check`.

If the generator is missing from the container, run `docker compose exec -T frontend npm install`.

## Determinism

- The backend exports the slice with sorted keys and a fixed indent, so the JSON is byte-stable.
- `openapi-typescript` is pinned to an exact version; a caret range would let a patch release
  reformat the output and fail the drift check for no real contract change.
- Only `/api/v1/record-layouts` paths and the schemas they transitively reference are exported.
  Unrelated API families cannot leak into the generated types and inflate the diff.

## Boundaries

`lib/contracts/recordLayouts.ts` is the only module that imports from `generated/`. Product code
imports the domain names from the adapter or from `hooks/useResolvedRecordLayout`.

The generated artifacts are **types, not a client**. All requests still go through `apiFetch`,
which retries GET and HEAD only. Do not adopt a generator that emits its own fetch layer without
first proving it cannot retry writes — `tests/e2e/contract-transport.spec.ts` guards that rule.

## Widening the pilot

Change `PATH_PREFIX` in `backend/scripts/export_layout_contract.py` and regenerate. Adopting a
second API family is Phase 3 work and should land as its own slice with its own adapter.
