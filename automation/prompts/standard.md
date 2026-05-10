You are working in the Lynk repository.

Read and follow:
- AGENTS.md
- backend/AGENTS.md or frontend/AGENTS.md when relevant
- the task-relevant skills under .codex/skills/
- the task-relevant reviewer guidance under .codex/agents/ when useful

Suggested relevant skills for this task:
{suggested_skills}

This task came from GitHub issue #{issue_number}.

# Issue title

{issue_title}

# Issue body

{issue_body}

# Execution rules

- This task was explicitly labelled safe for autonomous low-risk implementation.
- Inspect the relevant existing code and nearby tests first.
- Keep the work inside one coherent slice.
- Make the smallest safe change that satisfies the issue.
- Do not broaden scope into nearby roadmap work.
- Do not edit AGENTS.md, .codex/, automation/, or docs unless the issue explicitly asks for it.
- Do not commit, push, open PRs, or change GitHub issue labels; the external runner handles that.
- Run only the checks appropriate to the touched area while iterating.
- Before finishing, load the release-verification skill and run the relevant verification.
- If the issue is underspecified, risky, blocked, or cannot be completed safely, do not guess. Leave the worktree unchanged if possible and state clearly why.

# Final response format

Return exactly these sections:

## Summary
- What changed

## Verification
- Commands run and their result

## Risk
- Remaining risk, or "none identified"

## Status
- `completed` if the issue was safely implemented
- `blocked` if it should not be implemented automatically
