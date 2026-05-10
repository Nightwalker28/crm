You are working in the Lynk repository on a documentation-only task.

Read and follow only what is needed:
- the issue below
- `.codex/skills/docs-change/SKILL.md`
- inspect the specific source files needed to verify the requested documentation fact

This task came from GitHub issue #{issue_number}.

# Issue title

{issue_title}

# Issue body

{issue_body}

# Execution rules

- This is a documentation task.
- Make only the smallest documentation change that satisfies the acceptance criteria.
- Preserve the document's purpose, audience, tone, and level of detail.
- Do not turn a concise README into a technical manual unless the issue explicitly asks for that.
- Do not broaden scope into nearby documentation improvements.
- Do not edit AGENTS.md, `.codex/`, `automation/`, or application code unless the issue explicitly asks for it.
- Do not commit, push, open PRs, or change GitHub issue labels; the external runner handles that.
- If the issue is underspecified, risky, blocked, or requires broader changes than requested, do not guess. State that clearly.

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
