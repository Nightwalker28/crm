#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import json
import time
import os
import re
import shlex
import subprocess
import sys
import textwrap
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AUTOMATION_DIR = ROOT / "automation"
LOG_DIR = AUTOMATION_DIR / "logs"
ENV_FILE = AUTOMATION_DIR / ".env"
POLICY_FILE = AUTOMATION_DIR / "workflow-policy.json"
PROMPT_DIR = AUTOMATION_DIR / "prompts"
CHECK_COMMANDS = {
    "docs_diff": ["git", "diff", "--check"],
    "backend_compile": ["docker", "compose", "exec", "-T", "backend", "python", "-m", "compileall", "app", "tests"],
    "backend_tests": ["docker", "compose", "exec", "-T", "backend", "python", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
    "frontend_lint": ["docker", "compose", "exec", "-T", "frontend", "npm", "run", "lint"],
    "frontend_build": ["docker", "compose", "exec", "-T", "frontend", "npm", "run", "build"],
    "migration_upgrade": ["docker", "compose", "exec", "-T", "backend", "alembic", "upgrade", "head"],
    "migration_current": ["docker", "compose", "exec", "-T", "backend", "alembic", "current"],
}


@dataclass(frozen=True)
class Config:
    github_repo: str
    base_branch: str
    repo_dir: Path
    discord_webhook_url: str
    codex_timeout_seconds: int
    create_draft_pr: bool
    max_repair_attempts: int
    codex_sandbox: str
    codex_bypass_approvals_and_sandbox: bool
    codex_extra_args: list[str]


@dataclass(frozen=True)
class Issue:
    number: int
    title: str
    body: str
    url: str
    labels: set[str]


@dataclass(frozen=True)
class Workflow:
    profile: str
    routes: set[str]
    skills: list[str]
    checks: list[str]
    reviewers: list[str]
    implementation_model: str | None
    review_model: str | None
    requires_human_review: bool


class RunnerError(RuntimeError):
    pass


@dataclass(frozen=True)
class FailureContext:
    stage: str
    summary: str
    command: list[str] | None = None
    stdout: str = ""
    stderr: str = ""


class RepairableRunnerError(RunnerError):
    def __init__(self, failure: FailureContext):
        super().__init__(failure.summary)
        self.failure = failure


def load_dotenv(path: Path) -> None:
    if not path.exists():
        raise RunnerError(f"Missing {path}. Copy automation/.env.example to automation/.env first.")

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        value = int(os.environ.get(name, str(default)).strip())
    except ValueError as exc:
        raise RunnerError(f"{name} must be an integer") from exc
    if value < minimum:
        raise RunnerError(f"{name} must be >= {minimum}")
    return value


def load_config() -> Config:
    load_dotenv(ENV_FILE)

    github_repo = os.environ.get("GITHUB_REPO", "").strip()
    base_branch = os.environ.get("BASE_BRANCH", "main").strip()
    repo_dir = Path(os.environ.get("REPO_DIR", str(ROOT))).expanduser().resolve()
    discord_webhook_url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    timeout = env_int("CODEX_TIMEOUT_SECONDS", 7200, minimum=60)
    max_repair_attempts = env_int("CODEX_MAX_REPAIR_ATTEMPTS", 2, minimum=0)
    codex_sandbox = os.environ.get("CODEX_SANDBOX", "workspace-write").strip()
    codex_bypass = env_bool("CODEX_BYPASS_APPROVALS_AND_SANDBOX", False)
    codex_extra_args = shlex.split(os.environ.get("CODEX_EXTRA_ARGS", ""))
    allowed_sandboxes = {"read-only", "workspace-write", "danger-full-access"}
    if codex_sandbox not in allowed_sandboxes:
        raise RunnerError(f"CODEX_SANDBOX must be one of: {', '.join(sorted(allowed_sandboxes))}")

    if not github_repo:
        raise RunnerError("GITHUB_REPO is required in automation/.env")
    if not discord_webhook_url:
        raise RunnerError("DISCORD_WEBHOOK_URL is required in automation/.env")
    if not repo_dir.exists():
        raise RunnerError(f"REPO_DIR does not exist: {repo_dir}")

    return Config(
        github_repo=github_repo,
        base_branch=base_branch,
        repo_dir=repo_dir,
        discord_webhook_url=discord_webhook_url,
        codex_timeout_seconds=timeout,
        create_draft_pr=env_bool("CREATE_DRAFT_PR", True),
        max_repair_attempts=max_repair_attempts,
        codex_sandbox=codex_sandbox,
        codex_bypass_approvals_and_sandbox=codex_bypass,
        codex_extra_args=codex_extra_args,
    )


def load_policy() -> dict[str, Any]:
    return json.loads(POLICY_FILE.read_text())


def command_failed_message(args: list[str], result: subprocess.CompletedProcess[str]) -> str:
    return (
        f"Command failed ({result.returncode}): {shlex.join(args)}\n"
        f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )


def is_transient_github_failure(result: subprocess.CompletedProcess[str]) -> bool:
    output = f"{result.stdout}\n{result.stderr}".lower()
    transient_markers = (
        "http 502",
        "http 503",
        "http 504",
        "bad gateway",
        "service unavailable",
        "gateway timeout",
        "temporary failure",
        "timed out",
    )
    return any(marker in output for marker in transient_markers)


def run(
    args: list[str],
    *,
    cwd: Path,
    capture: bool = True,
    check: bool = True,
    timeout: int | None = None,
    retries: int = 0,
    retry_delay_seconds: float = 2.0,
    retry_transient_github_only: bool = False,
) -> subprocess.CompletedProcess[str]:
    attempts = retries + 1
    last_result: subprocess.CompletedProcess[str] | None = None

    for attempt in range(1, attempts + 1):
        result = subprocess.run(
            args,
            cwd=cwd,
            text=True,
            capture_output=capture,
            timeout=timeout,
        )
        last_result = result

        if result.returncode == 0:
            return result

        should_retry = (
            attempt < attempts
            and (
                not retry_transient_github_only
                or is_transient_github_failure(result)
            )
        )
        if should_retry:
            time.sleep(retry_delay_seconds * attempt)
            continue

        if check:
            raise RunnerError(command_failed_message(args, result))
        return result

    assert last_result is not None
    return last_result


def gh_json(args: list[str], *, cwd: Path) -> Any:
    result = run(
        ["gh", *args],
        cwd=cwd,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RunnerError(f"Failed to parse gh JSON output:\n{result.stdout}") from exc


def ensure_clean_worktree(config: Config) -> None:
    status = run(["git", "status", "--porcelain"], cwd=config.repo_dir).stdout.strip()
    if status:
        raise RunnerError(
            "Working tree is not clean. Commit/stash your local changes before running the autonomous runner.\n"
            f"{status}"
        )


def fetch_next_issue(config: Config) -> Issue | None:
    payload = gh_json(
        [
            "issue",
            "list",
            "--repo",
            config.github_repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,body,url,labels,createdAt",
        ],
        cwd=config.repo_dir,
    )
    if not payload:
        return None

    required_labels = {"codex-ready", "codex-low-risk"}
    excluded_labels = {
        "codex-in-progress",
        "codex-done",
        "codex-failed",
        "human-review-required",
        "codex-plan-only",
    }
    eligible = [
        item
        for item in payload
        if required_labels.issubset({label["name"] for label in item.get("labels", [])})
        and excluded_labels.isdisjoint({label["name"] for label in item.get("labels", [])})
    ]
    if not eligible:
        return None

    item = min(eligible, key=lambda issue: issue["createdAt"])
    return Issue(
        number=int(item["number"]),
        title=item["title"],
        body=item.get("body") or "",
        url=item["url"],
        labels={label["name"] for label in item.get("labels", [])},
    )


def add_label(config: Config, issue_number: int, label: str) -> None:
    run(
        ["gh", "issue", "edit", str(issue_number), "--repo", config.github_repo, "--add-label", label],
        cwd=config.repo_dir,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )


def remove_label(config: Config, issue_number: int, label: str) -> None:
    run(
        ["gh", "issue", "edit", str(issue_number), "--repo", config.github_repo, "--remove-label", label],
        cwd=config.repo_dir,
        check=False,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )


def comment_issue(config: Config, issue_number: int, body: str) -> None:
    run(
        ["gh", "issue", "comment", str(issue_number), "--repo", config.github_repo, "--body", body],
        cwd=config.repo_dir,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )


def slugify(value: str, max_length: int = 48) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    value = re.sub(r"-+", "-", value)
    return value[:max_length].strip("-") or "task"


def branch_name_for(issue: Issue) -> str:
    return f"codex/issue-{issue.number}-{slugify(issue.title)}"


def prepare_branch(config: Config, branch_name: str) -> None:
    run(["git", "fetch", "origin", config.base_branch], cwd=config.repo_dir)
    run(["git", "checkout", config.base_branch], cwd=config.repo_dir)
    run(["git", "pull", "--ff-only", "origin", config.base_branch], cwd=config.repo_dir)
    run(["git", "checkout", "-B", branch_name], cwd=config.repo_dir)


def issue_scope(issue: Issue) -> str:
    body = issue.body.lower()
    match = re.search(r"## scope\s*(.*?)(?:\n## |\Z)", body, flags=re.S)
    if not match:
        return "standard"

    section = match.group(1)
    for candidate in ("docs", "frontend", "backend", "full-stack", "migration", "security"):
        if candidate in section:
            return candidate
    return "standard"


def ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def match_pattern(path: str, pattern: str) -> bool:
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        return path == prefix.rstrip("/") or path.startswith(prefix)
    return fnmatch.fnmatch(path, pattern)


def choose_model(current: str | None, candidate: str | None) -> str | None:
    # The policy intentionally uses the strongest matching route model.
    # For now that means any real code route can escalate docs/default work to gpt-5.5.
    return candidate or current


def classify_paths(paths: list[str], profile: str, policy: dict[str, Any]) -> Workflow:
    profile_policy = policy["profiles"][profile]
    routes: set[str] = set()
    skills: list[str] = list(profile_policy["skills"])
    checks: list[str] = list(profile_policy["checks"])
    reviewers: list[str] = list(profile_policy["reviewers"])
    implementation_model = profile_policy.get("implementation_model")
    review_model = profile_policy.get("review_model")
    requires_human_review = False

    for route_name, route in policy["routes"].items():
        patterns = route.get("patterns", [])
        if any(match_pattern(path, pattern) for path in paths for pattern in patterns):
            routes.add(route_name)
            skills.extend(route.get("skills", []))
            checks.extend(route.get("checks", []))
            reviewers.extend(route.get("reviewers", []))
            implementation_model = choose_model(implementation_model, route.get("implementation_model"))
            review_model = choose_model(review_model, route.get("review_model"))
            requires_human_review = requires_human_review or route.get("requires_human_review", False)

    return Workflow(
        profile=profile,
        routes=routes,
        skills=ordered_unique(skills),
        checks=ordered_unique(checks),
        reviewers=ordered_unique(reviewers),
        implementation_model=implementation_model,
        review_model=review_model,
        requires_human_review=requires_human_review,
    )


def initial_workflow(issue: Issue, policy: dict[str, Any]) -> Workflow:
    scope = issue_scope(issue)
    hint = policy.get("issue_scope_hints", {}).get(scope)
    profile = hint["profile"] if hint else ("docs" if scope == "docs" else "standard")
    profile_policy = policy["profiles"][profile]

    skills = list(profile_policy["skills"])
    if hint:
        skills.extend(hint.get("skills", []))

    return Workflow(
        profile=profile,
        routes=set(),
        skills=ordered_unique(skills),
        checks=list(profile_policy["checks"]),
        reviewers=list(profile_policy["reviewers"]),
        implementation_model=profile_policy.get("implementation_model"),
        review_model=profile_policy.get("review_model"),
        requires_human_review=False,
    )


def render_prompt(issue: Issue, workflow: Workflow) -> str:
    template = (PROMPT_DIR / f"{workflow.profile}.md").read_text()
    suggested_skills = "\n".join(f"- {skill}" for skill in workflow.skills) or "- none"
    return template.format(
        issue_number=issue.number,
        issue_title=issue.title,
        issue_body=issue.body.strip() or "(No issue body provided.)",
        suggested_skills=suggested_skills,
    )


def render_review_prompt(issue: Issue, workflow: Workflow, files: list[str]) -> str:
    template = (PROMPT_DIR / "review.md").read_text()
    return template.format(
        issue_number=issue.number,
        issue_title=issue.title,
        issue_body=issue.body.strip() or "(No issue body provided.)",
        changed_files="\n".join(f"- {path}" for path in files),
        reviewers="\n".join(f"- {reviewer}" for reviewer in workflow.reviewers),
        routes="\n".join(f"- {route}" for route in sorted(workflow.routes)) or "- none",
    )


def clipped(value: str, limit: int = 12000) -> str:
    if len(value) <= limit:
        return value
    return value[-limit:].lstrip() + "\n... output clipped to most recent content ..."


def render_repair_prompt(
    issue: Issue,
    workflow: Workflow,
    files: list[str],
    failure: FailureContext,
    attempt: int,
    max_attempts: int,
) -> str:
    changed = "\n".join(f"- {path}" for path in files) or "- none detected"
    command = shlex.join(failure.command) if failure.command else "(not command-specific)"
    suggested_skills = "\n".join(f"- {skill}" for skill in workflow.skills) or "- none"

    return textwrap.dedent(
        f"""\
        You are continuing an autonomous Codex runner task in the Lynk repository.

        This is repair attempt {attempt} of {max_attempts}. The previous attempt failed.
        Inspect the current worktree, diagnose the failure below, implement the smallest safe fix,
        and rerun the relevant check if possible.

        Read and follow:
        - AGENTS.md
        - backend/AGENTS.md or frontend/AGENTS.md when relevant
        - the task-relevant skills under .codex/skills/

        Suggested relevant skills for this repair:
        {suggested_skills}

        Original issue #{issue.number}: {issue.title}

        {issue.body.strip() or "(No issue body provided.)"}

        Current changed files:
        {changed}

        Failure stage:
        {failure.stage}

        Failure summary:
        {failure.summary}

        Failed command:
        {command}

        STDOUT:
        {clipped(failure.stdout)}

        STDERR:
        {clipped(failure.stderr)}

        Repair rules:
        - Keep the existing task scope. Do not broaden into nearby roadmap work.
        - Preserve any correct work already in the worktree.
        - Do not commit, push, open PRs, or change GitHub issue labels.
        - You may rerun only relevant checks while iterating.
        - If a command needs host permissions you cannot obtain, do not try to bypass approval.
          State the exact command/permission needed and mark the task blocked.
        - If the failure is environmental and not fixable in the repo, leave code unchanged where possible and mark blocked.

        Final response format:

        ## Summary
        - What changed

        ## Verification
        - Commands run and their result

        ## Risk
        - Remaining risk, or "none identified"

        ## Status
        - `completed` if the repair was safely implemented
        - `blocked` if it should not continue automatically
        """
    )


def workflow_summary(workflow: Workflow) -> str:
    return (
        f"profile={workflow.profile}; "
        f"routes={','.join(sorted(workflow.routes)) or 'none'}; "
        f"skills={','.join(workflow.skills) or 'none'}; "
        f"checks={','.join(workflow.checks) or 'none'}; "
        f"reviewers={','.join(workflow.reviewers) or 'none'}; "
        f"impl_model={workflow.implementation_model or 'default'}; "
        f"review_model={workflow.review_model or 'default'}; "
        f"human_review={workflow.requires_human_review}"
    )


def run_codex(
    config: Config,
    prompt: str,
    log_file: Path,
    model: str | None,
    *,
    heading: str = "CODEX",
) -> subprocess.CompletedProcess[str]:
    args = [
        "codex",
        "exec",
        "--cd",
        str(config.repo_dir),
    ]
    if config.codex_bypass_approvals_and_sandbox:
        args.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        args.extend(["--sandbox", config.codex_sandbox])
    args.extend(config.codex_extra_args)
    if model:
        args.extend(["--model", model])
    args.append(prompt)

    result = run(
        args,
        cwd=config.repo_dir,
        capture=True,
        check=False,
        timeout=config.codex_timeout_seconds,
    )
    if log_file.exists():
        append_log(log_file, heading, result)
    else:
        log_file.write_text(
            f"$ {shlex.join(args[:-1])} <PROMPT>\n\n"
            f"=== {heading} ===\n"
            f"exit={result.returncode}\n"
            f"STDOUT:\n{result.stdout}\n\n"
            f"STDERR:\n{result.stderr}\n"
        )
    return result


def changed_files(config: Config) -> list[str]:
    # Include both tracked modifications and new untracked files.
    # `git diff --name-only` misses new files until they are staged, which is
    # unsafe for migrations, new modules, tests, and any other newly-created path.
    output = run(["git", "status", "--porcelain"], cwd=config.repo_dir).stdout

    files: list[str] = []
    for line in output.splitlines():
        if not line.strip():
            continue

        # Porcelain v1 format is XY<space>PATH. Renames may show OLD -> NEW;
        # classify/review the destination path.
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        files.append(path)

    return files


def git_diff_exists(config: Config) -> bool:
    return bool(changed_files(config))


def codex_reported_blocked(result: subprocess.CompletedProcess[str]) -> bool:
    output = result.stdout.lower()
    status_section = re.search(r"## status\s*\n\s*-?\s*`?(completed|blocked)`?", output)
    return bool(status_section and status_section.group(1) == "blocked")


def review_reported_block(result: subprocess.CompletedProcess[str]) -> bool:
    output = result.stdout.lower()
    verdict_section = re.search(r"## verdict\s*\n\s*-?\s*`?(pass|block)`?", output)
    return bool(verdict_section and verdict_section.group(1) == "block")


def run_review(
    config: Config,
    prompt: str,
    log_file: Path,
    model: str | None,
) -> subprocess.CompletedProcess[str]:
    args = [
        "codex",
        "exec",
        "--sandbox",
        "read-only",
        "--cd",
        str(config.repo_dir),
    ]
    if model:
        args.extend(["--model", model])
    args.append(prompt)

    result = run(
        args,
        cwd=config.repo_dir,
        capture=True,
        check=False,
        timeout=config.codex_timeout_seconds,
    )
    append_log(log_file, "REVIEW", result)
    return result


def codex_failure_context(result: subprocess.CompletedProcess[str], log_file: Path, heading: str) -> FailureContext:
    return FailureContext(
        stage=heading,
        summary=f"Codex exited with status {result.returncode}. See {log_file}",
        command=["codex", "exec"],
        stdout=result.stdout,
        stderr=result.stderr,
    )


def append_log(log_file: Path, heading: str, result: subprocess.CompletedProcess[str]) -> None:
    with log_file.open("a") as handle:
        handle.write(
            f"\n\n=== {heading} ===\n"
            f"exit={result.returncode}\n"
            f"STDOUT:\n{result.stdout}\n\n"
            f"STDERR:\n{result.stderr}\n"
        )


def services_for_checks(checks: list[str]) -> list[str]:
    needed: set[str] = set()

    for check in checks:
        if check.startswith("backend_") or check.startswith("migration_"):
            needed.add("backend")
        if check.startswith("frontend_"):
            needed.add("frontend")

    # Compose brings transitive dependencies up through depends_on.
    return sorted(needed)


def ensure_services_for_checks(config: Config, workflow: Workflow, log_file: Path) -> None:
    services = services_for_checks(workflow.checks)
    if not services:
        return

    result = run(
        ["docker", "compose", "up", "-d", *services],
        cwd=config.repo_dir,
        capture=True,
        check=False,
    )
    append_log(log_file, "ENSURE SERVICES", result)
    if result.returncode != 0:
        raise RunnerError(f"Could not start required services: {', '.join(services)}. See {log_file}")


def run_check(config: Config, check_name: str, log_file: Path) -> subprocess.CompletedProcess[str]:
    if check_name not in CHECK_COMMANDS:
        raise RunnerError(f"Unknown check: {check_name}")
    result = run(CHECK_COMMANDS[check_name], cwd=config.repo_dir, capture=True, check=False)
    append_log(log_file, f"CHECK {check_name}", result)
    return result


def run_workflow_checks(config: Config, workflow: Workflow, log_file: Path) -> None:
    ensure_services_for_checks(config, workflow, log_file)

    for check_name in workflow.checks:
        result = run_check(config, check_name, log_file)
        if result.returncode != 0:
            raise RepairableRunnerError(
                FailureContext(
                    stage=f"check:{check_name}",
                    summary=f"Check failed: {check_name}. See {log_file}",
                    command=CHECK_COMMANDS.get(check_name),
                    stdout=result.stdout,
                    stderr=result.stderr,
                )
            )


def commit_changes(config: Config, issue: Issue) -> None:
    run(["git", "add", "-A"], cwd=config.repo_dir)
    run(["git", "commit", "-m", f"codex: resolve issue #{issue.number}"], cwd=config.repo_dir)


def push_branch(config: Config, branch_name: str) -> None:
    run(["git", "push", "-u", "origin", branch_name, "--force-with-lease"], cwd=config.repo_dir)


def find_pr_by_branch(config: Config, branch_name: str) -> dict[str, Any] | None:
    result = run(
        [
            "gh",
            "pr",
            "view",
            branch_name,
            "--repo",
            config.github_repo,
            "--json",
            "number,url,title",
        ],
        cwd=config.repo_dir,
        check=False,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )
    if result.returncode != 0:
        return None

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def create_pr(config: Config, issue: Issue, branch_name: str, workflow: Workflow) -> dict[str, Any]:
    routes = ", ".join(sorted(workflow.routes)) or workflow.profile
    checks = ", ".join(workflow.checks) or "none"
    reviewers = ", ".join(workflow.reviewers) or "none"
    body = textwrap.dedent(
        f"""\
        ## Summary
        Autonomous Codex runner output for #{issue.number}.

        Closes #{issue.number}

        ## Workflow
        - Profile: `{workflow.profile}`
        - Matched routes: `{routes}`
        - Checks run: `{checks}`
        - Suggested reviewers: `{reviewers}`
        - Implementation model: `{workflow.implementation_model or 'default'}`
        - Review model: `{workflow.review_model or 'default'}`

        ## Review notes
        - This PR was created automatically as a draft.
        - Please review before merge.
        """
    )

    existing = find_pr_by_branch(config, branch_name)
    if existing:
        return existing

    args = [
        "pr",
        "create",
        "--repo",
        config.github_repo,
        "--base",
        config.base_branch,
        "--head",
        branch_name,
        "--title",
        f"[Codex] {issue.title}",
        "--body",
        body,
    ]
    if config.create_draft_pr:
        args.append("--draft")

    create_result = run(
        ["gh", *args],
        cwd=config.repo_dir,
        check=False,
        retries=3,
        retry_delay_seconds=2.0,
        retry_transient_github_only=True,
    )

    if create_result.returncode != 0:
        recovered = find_pr_by_branch(config, branch_name)
        if recovered:
            return recovered
        raise RunnerError(command_failed_message(["gh", *args], create_result))

    recovered = find_pr_by_branch(config, branch_name)
    if recovered:
        return recovered

    raise RunnerError("PR creation appeared to succeed, but PR metadata could not be recovered by branch.")


def discord_safe_message(message: str, limit: int = 1900) -> str:
    # Discord allows 2000 characters. Leave headroom so notifications never fail
    # just because an exception contains a long command output.
    if len(message) <= limit:
        return message
    return message[: limit - 15].rstrip() + "\n...truncated"


def notify_discord(config: Config, message: str) -> None:
    payload = json.dumps({"content": discord_safe_message(message)}).encode()
    request = urllib.request.Request(
        config.discord_webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Lynk-Codex-Runner/2.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15):
        pass


def notify_discord_best_effort(config: Config, message: str) -> None:
    try:
        notify_discord(config, message)
    except Exception as exc:
        print(f"WARNING: Discord notification failed: {exc}", file=sys.stderr)


def reset_to_base(config: Config) -> None:
    run(["git", "checkout", config.base_branch], cwd=config.repo_dir, check=False)
    run(["git", "reset", "--hard", f"origin/{config.base_branch}"], cwd=config.repo_dir, check=False)
    run(["git", "clean", "-fd"], cwd=config.repo_dir, check=False)


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run autonomous Lynk Codex issues.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the next eligible issue and initial workflow without changing anything or spending Codex tokens.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Keep processing eligible issues until the queue is empty or one issue fails.",
    )
    parser.add_argument(
        "--continue-on-failure",
        action="store_true",
        help="With --all, continue to later issues even if one issue fails.",
    )
    return parser.parse_args()


def process_one_issue(config: Config, policy: dict[str, Any], *, dry_run: bool = False) -> int | None:
    ensure_clean_worktree(config)

    issue = fetch_next_issue(config)
    if issue is None:
        print("No eligible Codex issues found.")
        return None

    branch_name = branch_name_for(issue)
    log_file = LOG_DIR / f"issue-{issue.number}-{now_slug()}.log"
    initial = initial_workflow(issue, policy)

    print(f"Issue: #{issue.number} {issue.title}")
    print(f"Initial workflow: {workflow_summary(initial)}")

    if dry_run:
        print("Dry run only. No labels changed, no branch created, no Codex tokens spent.")
        return 0

    try:
        add_label(config, issue.number, "codex-in-progress")
        comment_issue(
            config,
            issue.number,
            f"🤖 Codex runner claimed this issue and is starting work on `{branch_name}` with `{initial.profile}` profile.",
        )
        notify_discord_best_effort(
            config,
            f"🤖 Lynk Codex runner started issue #{issue.number}: {issue.title}\n"
            f"Profile: {initial.profile}\n{issue.url}",
        )

        prepare_branch(config, branch_name)
        prompt = render_prompt(issue, initial)
        codex_result = run_codex(config, prompt, log_file, initial.implementation_model, heading="CODEX INITIAL")

        final: Workflow | None = None
        files: list[str] = []
        repairs_used = 0

        for repair_attempt in range(0, config.max_repair_attempts + 1):
            try:
                if codex_result.returncode != 0:
                    raise RepairableRunnerError(
                        codex_failure_context(codex_result, log_file, f"codex attempt {repair_attempt}")
                    )
                if codex_reported_blocked(codex_result):
                    raise RunnerError("Codex reported the task as blocked for autonomous implementation.")
                if not git_diff_exists(config):
                    raise RepairableRunnerError(
                        FailureContext(
                            stage="codex:no-diff",
                            summary="Codex finished without producing any repository changes.",
                            stdout=codex_result.stdout,
                            stderr=codex_result.stderr,
                        )
                    )

                files = changed_files(config)
                final = classify_paths(files, initial.profile, policy)
                print(f"Changed files: {', '.join(files)}")
                print(f"Final workflow: {workflow_summary(final)}")

                if final.requires_human_review:
                    raise RunnerError(
                        "Diff touched automation or agent-control files that require human review: "
                        + ", ".join(files)
                    )

                run_workflow_checks(config, final, log_file)

                if final.reviewers:
                    review_prompt = render_review_prompt(issue, final, files)
                    review_result = run_review(config, review_prompt, log_file, final.review_model)
                    if review_result.returncode != 0:
                        raise RepairableRunnerError(
                            FailureContext(
                                stage="review:execution",
                                summary=f"Review pass exited with status {review_result.returncode}. See {log_file}",
                                command=["codex", "exec", "--sandbox", "read-only"],
                                stdout=review_result.stdout,
                                stderr=review_result.stderr,
                            )
                        )
                    if review_reported_block(review_result):
                        raise RepairableRunnerError(
                            FailureContext(
                                stage="review:blocking-findings",
                                summary="Reviewer agents blocked autonomous completion. See runner log for findings.",
                                command=["codex", "exec", "--sandbox", "read-only"],
                                stdout=review_result.stdout,
                                stderr=review_result.stderr,
                            )
                        )

                break

            except RepairableRunnerError as exc:
                if repair_attempt >= config.max_repair_attempts:
                    raise RunnerError(
                        f"{exc.failure.summary} Repair attempts exhausted "
                        f"({config.max_repair_attempts}). See {log_file}"
                    ) from exc

                repairs_used += 1
                active_workflow = final or initial
                repair_prompt = render_repair_prompt(
                    issue,
                    active_workflow,
                    files,
                    exc.failure,
                    repairs_used,
                    config.max_repair_attempts,
                )
                append_log(
                    log_file,
                    f"REPAIR REQUEST {repairs_used}",
                    subprocess.CompletedProcess(
                        args=["codex", "repair-prompt"],
                        returncode=0,
                        stdout=repair_prompt,
                        stderr="",
                    ),
                )
                codex_result = run_codex(
                    config,
                    repair_prompt,
                    log_file,
                    active_workflow.implementation_model,
                    heading=f"CODEX REPAIR {repairs_used}",
                )

        if final is None:
            raise RunnerError("Runner reached an invalid state: final workflow was not selected.")

        commit_changes(config, issue)
        push_branch(config, branch_name)
        pr = create_pr(config, issue, branch_name, final)

        remove_label(config, issue.number, "codex-ready")
        remove_label(config, issue.number, "codex-in-progress")
        remove_label(config, issue.number, "codex-failed")
        add_label(config, issue.number, "codex-done")
        comment_issue(
            config,
            issue.number,
            f"🤖 Codex runner created draft PR #{pr['number']}: {pr['url']}",
        )
        notify_discord_best_effort(
            config,
            f"✅ Lynk Codex runner completed issue #{issue.number}: {issue.title}\n"
            f"Profile: {final.profile}\n"
            f"Routes: {', '.join(sorted(final.routes)) or 'none'}\n"
            f"Draft PR #{pr['number']}: {pr['url']}",
        )
        print(f"Created draft PR #{pr['number']}: {pr['url']}")
        return 0

    except Exception as exc:
        remove_label(config, issue.number, "codex-in-progress")
        add_label(config, issue.number, "codex-failed")
        comment_issue(
            config,
            issue.number,
            f"🤖 Codex runner failed: `{exc}`\n\nCheck local runner logs for details.",
        )
        notify_discord_best_effort(
            config,
            f"❌ Lynk Codex runner failed issue #{issue.number}: {issue.title}\n"
            f"{issue.url}\n"
            f"Reason: {exc}",
        )
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    finally:
        reset_to_base(config)


def main() -> int:
    args = parse_args()
    config = load_config()
    policy = load_policy()
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        result = process_one_issue(config, policy, dry_run=True)
        return 0 if result is None else result

    if not args.all:
        result = process_one_issue(config, policy)
        return 0 if result is None else result

    completed = 0
    failed = 0

    while True:
        result = process_one_issue(config, policy)
        if result is None:
            print(f"Queue finished. completed={completed}; failed={failed}")
            return 0 if failed == 0 else 1

        if result == 0:
            completed += 1
            continue

        failed += 1
        if not args.continue_on_failure:
            print(f"Queue stopped after failure. completed={completed}; failed={failed}")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
