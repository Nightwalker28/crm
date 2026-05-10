# Lynk Codex Runner

This local runner picks one GitHub issue labelled:

- `codex-ready`
- `codex-low-risk`

and not labelled:

- `codex-in-progress`
- `codex-done`
- `codex-failed`
- `human-review-required`
- `codex-plan-only`

It then:

1. chooses an initial workflow profile from the issue
2. creates a branch
3. runs Codex non-interactively
4. classifies the actual changed files
5. runs the checks required by policy
6. commits and pushes the result
7. opens a draft PR
8. comments on the issue
9. sends a Discord notification

## Safety

- One issue per run
- Draft PRs only
- No auto-merge
- Refuses to start with a dirty worktree
- Low-risk issues only
- Blocks if a low-risk task touches agent-control or automation files
- Uses Docker Compose services for app checks

## Workflow policy

`automation/workflow-policy.json` maps changed files to:

- skills
- checks
- suggested reviewers
- human-review requirements

Examples:

- docs-only diff → lightweight docs verification only
- frontend diff → frontend lint/build through the frontend container
- backend diff → backend compile/tests through the backend container
- migration diff → migration checks through the backend container
- security-sensitive diff → security reviewer suggestion

## Setup

```bash
cp automation/.env.example automation/.env
nano automation/.env
```

Fill in `DISCORD_WEBHOOK_URL`.

## Manual run

```bash
python automation/codex-runner.py
```

## Good issue labels

For autonomous implementation:

- `codex-ready`
- `codex-low-risk`

For plan only:

- `codex-ready`
- `codex-plan-only`

Never auto-implement:

- `human-review-required`

