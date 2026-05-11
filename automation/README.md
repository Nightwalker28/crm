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

1. chooses an initial workflow from the issue scope
2. chooses the implementation model from policy
3. creates a branch
4. runs Codex non-interactively
5. classifies the actual changed files
6. selects the final skills, checks, reviewers, and review model from policy
7. runs the required checks
8. runs a reviewer pass when policy requires one
9. if Codex, checks, or review fail, feeds the failure output back into Codex for bounded repair attempts
10. commits and pushes the result
11. opens a draft PR
12. comments on the issue
13. sends a Discord notification

## Safety

- One issue per run
- Draft PRs only
- No auto-merge
- Refuses to start with a dirty worktree
- Low-risk issues only
- Blocks if a low-risk task touches agent-control or automation files
- Uses Docker Compose services for app checks
- Uses the strongest configured model for real code changes
- Uses a lighter model only for docs-only work
- Uses bounded self-repair attempts; it does not silently bypass host permissions or approval prompts

## Workflow policy

`automation/workflow-policy.json` maps issue scope and changed files to:

- prompt profile
- implementation model
- skills
- checks
- reviewers
- review model
- human-review requirements

Examples:

- docs-only diff → `gpt-5.4-mini`, lightweight docs verification only
- backend diff → `gpt-5.5`, backend checks through the backend container
- frontend diff → `gpt-5.5`, frontend checks through the frontend container
- migration diff → migration checks through the backend container
- security-sensitive diff → security review required
- platform/core diff → architecture review required
- product-sensitive diff → product review required

Rules provide the minimum required workflow. Codex may still use additional judgment inside those boundaries.

## Setup

```bash
cp automation/.env.example automation/.env
nano automation/.env
```

Fill in `DISCORD_WEBHOOK_URL`.

Optional runner behavior:

```bash
CODEX_MAX_REPAIR_ATTEMPTS=2
CODEX_SANDBOX=workspace-write
CODEX_EXTRA_ARGS=
CODEX_BYPASS_APPROVALS_AND_SANDBOX=false
```

`CODEX_MAX_REPAIR_ATTEMPTS` controls how many times the runner will pass a failed Codex/check/review result back into Codex and rerun verification.

`CODEX_EXTRA_ARGS` can pass explicit Codex CLI options such as a profile configured in `~/.codex/config.toml`.

`CODEX_BYPASS_APPROVALS_AND_SANDBOX=true` adds Codex's dangerous bypass flag. Use it only inside a separately sandboxed environment. The runner intentionally does not auto-grant itself host permissions.

## Dry run

Show the next eligible issue and the initial workflow without changing anything or spending Codex tokens:

```bash
python automation/codex-runner.py --dry-run
```

## Manual run

## Queue run

Process every eligible issue in order until the queue is empty or one issue fails:

```bash
python automation/codex-runner.py --all
```

Continue to later issues even if one issue fails:

```bash
python automation/codex-runner.py --all --continue-on-failure
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
