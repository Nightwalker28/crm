You are reviewing an autonomous Codex change in the Lynk repository.

Read and follow:
- AGENTS.md
- the relevant scoped AGENTS.md files for the touched area
- the reviewer instructions for the requested reviewers under `.codex/agents/`
- the task-relevant skills under `.codex/skills/`

# Original GitHub issue

Issue #{issue_number}: {issue_title}

{issue_body}

# Review scope

Changed files:
{changed_files}

Requested reviewers:
{reviewers}

Relevant workflow routes:
{routes}

# Review rules

- Review only. Do not edit files.
- Inspect the actual diff and the minimum surrounding context needed.
- Do not invent generic issues without evidence in the code.
- Focus on whether this autonomous change is safe to turn into a draft PR.
- Treat a finding as blocking only if it should stop the autonomous runner from opening a PR.

# Final response format

Return exactly these sections:

## Blocking findings
- `none` if there are no blocking findings
- otherwise list each blocking finding with file/path and why it blocks autonomous completion

## Non-blocking findings
- `none` if there are none
- otherwise list useful follow-up findings

## Verdict
- `pass` if the runner may continue
- `block` if the runner must stop
