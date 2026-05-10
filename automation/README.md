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

1. creates a branch
2. runs Codex non-interactively
3. runs repository checks
4. commits and pushes the result
5. opens a draft PR
6. comments on the issue
7. sends a Discord notification

## Safety

- One issue per run
- Draft PRs only
- No auto-merge
- Refuses to start with a dirty worktree
- Low-risk issues only

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
