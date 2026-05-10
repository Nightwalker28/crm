#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import json
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


@dataclass(frozen=True)
class Config:
    github_repo: str
    base_branch: str
    repo_dir: Path
    discord_webhook_url: str
    codex_timeout_seconds: int
    create_draft_pr: bool


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


def load_config() -> Config:
    load_dotenv(ENV_FILE)

    github_repo = os.environ.get("GITHUB_REPO", "").strip()
    base_branch = os.environ.get("BASE_BRANCH", "main").strip()
    repo_dir = Path(os.environ.get("REPO_DIR", str(ROOT))).expanduser().resolve()
    discord_webhook_url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    try:
        timeout = int(os.environ.get("CODEX_TIMEOUT_SECONDS", "7200").strip())
    except ValueError as exc:
        raise RunnerError("CODEX_TIMEOUT_SECONDS must be an integer") from exc

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
    )


def load_policy() -> dict[str, Any]:
    return json.loads(POLICY_FILE.read_text())


def run(
    args: list[str],
    *,
    cwd: Path,
    capture: bool = True,
    check: bool = True,
    timeout: int | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        cwd=cwd,
        text=True,
        capture_output=capture,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise RunnerError(
            f"Command failed ({result.returncode}): {shlex.join(args)}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return result


def gh_json(args: list[str], *, cwd: Path) -> Any:
    result = run(["gh", *args], cwd=cwd)
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
    query = (
        f'repo:{config.github_repo} '
        'is:issue is:open '
        'label:"codex-ready" '
        'label:"codex-low-risk" '
        '-label:"codex-in-progress" '
        '-label:"codex-done" '
        '-label:"codex-failed" '
        '-label:"human-review-required" '
        '-label:"codex-plan-only"'
    )
    payload = gh_json(
        [
            "issue",
            "list",
            "--repo",
            config.github_repo,
            "--search",
            query,
            "--limit",
            "100",
            "--json",
            "number,title,body,url,labels,createdAt",
        ],
        cwd=config.repo_dir,
    )
    if not payload:
        return None

    item = min(payload, key=lambda issue: issue["createdAt"])
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
    )


def remove_label(config: Config, issue_number: int, label: str) -> None:
    run(
        ["gh", "issue", "edit", str(issue_number), "--repo", config.github_repo, "--remove-label", label],
        cwd=config.repo_dir,
        check=False,
    )


def comment_issue(config: Config, issue_number: int, body: str) -> None:
    run(
        ["gh", "issue", "comment", str(issue_number), "--repo", config.github_repo, "--body", body],
        cwd=config.repo_dir,
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
) -> subprocess.CompletedProcess[str]:
    args = [
        "codex",
        "exec",
        "--sandbox",
        "workspace-write",
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
    log_file.write_text(
        f"$ {shlex.join(args[:-1])} <PROMPT>\n\n"
        f"=== STDOUT ===\n{result.stdout}\n\n"
        f"=== STDERR ===\n{result.stderr}\n"
    )
    return result


def changed_files(config: Config) -> list[str]:
    output = run(["git", "diff", "--name-only"], cwd=config.repo_dir).stdout
    return [line.strip() for line in output.splitlines() if line.strip()]


def git_diff_exists(config: Config) -> bool:
    return bool(run(["git", "status", "--porcelain"], cwd=config.repo_dir).stdout.strip())


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


def append_log(log_file: Path, heading: str, result: subprocess.CompletedProcess[str]) -> None:
    with log_file.open("a") as handle:
        handle.write(
            f"\n\n=== {heading} ===\n"
            f"exit={result.returncode}\n"
            f"STDOUT:\n{result.stdout}\n\n"
            f"STDERR:\n{result.stderr}\n"
        )


def run_check(config: Config, check_name: str, log_file: Path) -> subprocess.CompletedProcess[str]:
    commands = {
        "docs_diff": ["git", "diff", "--check"],
        "backend_compile": ["docker", "compose", "exec", "-T", "backend", "python", "-m", "compileall", "app", "tests"],
        "backend_tests": ["docker", "compose", "exec", "-T", "backend", "python", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
        "frontend_lint": ["docker", "compose", "exec", "-T", "frontend", "npm", "run", "lint"],
        "frontend_build": ["docker", "compose", "exec", "-T", "frontend", "npm", "run", "build"],
        "migration_upgrade": ["docker", "compose", "exec", "-T", "backend", "alembic", "upgrade", "head"],
        "migration_current": ["docker", "compose", "exec", "-T", "backend", "alembic", "current"],
    }
    if check_name not in commands:
        raise RunnerError(f"Unknown check: {check_name}")
    result = run(commands[check_name], cwd=config.repo_dir, capture=True, check=False)
    append_log(log_file, f"CHECK {check_name}", result)
    return result


def run_workflow_checks(config: Config, workflow: Workflow, log_file: Path) -> None:
    for check_name in workflow.checks:
        result = run_check(config, check_name, log_file)
        if result.returncode != 0:
            raise RunnerError(f"Check failed: {check_name}. See {log_file}")


def commit_changes(config: Config, issue: Issue) -> None:
    run(["git", "add", "-A"], cwd=config.repo_dir)
    run(["git", "commit", "-m", f"codex: resolve issue #{issue.number}"], cwd=config.repo_dir)


def push_branch(config: Config, branch_name: str) -> None:
    run(["git", "push", "-u", "origin", branch_name, "--force-with-lease"], cwd=config.repo_dir)


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

    # gh pr create prints the PR URL in this GitHub CLI version; it does not support --json.
    run(["gh", *args], cwd=config.repo_dir)

    # Query the newly created PR separately so the rest of the runner gets structured data.
    return gh_json(
        [
            "pr",
            "view",
            branch_name,
            "--repo",
            config.github_repo,
            "--json",
            "number,url,title",
        ],
        cwd=config.repo_dir,
    )


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


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one autonomous Lynk Codex issue.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the next eligible issue and initial workflow without changing anything or spending Codex tokens.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config()
    policy = load_policy()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ensure_clean_worktree(config)

    issue = fetch_next_issue(config)
    if issue is None:
        print("No eligible Codex issues found.")
        return 0

    branch_name = branch_name_for(issue)
    log_file = LOG_DIR / f"issue-{issue.number}-{now_slug()}.log"
    initial = initial_workflow(issue, policy)

    print(f"Issue: #{issue.number} {issue.title}")
    print(f"Initial workflow: {workflow_summary(initial)}")

    if args.dry_run:
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
        codex_result = run_codex(config, prompt, log_file, initial.implementation_model)

        if codex_result.returncode != 0:
            raise RunnerError(f"Codex exited with status {codex_result.returncode}. See {log_file}")
        if codex_reported_blocked(codex_result):
            raise RunnerError("Codex reported the task as blocked for autonomous implementation.")
        if not git_diff_exists(config):
            raise RunnerError("Codex finished without producing any repository changes.")

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
                raise RunnerError(f"Review pass exited with status {review_result.returncode}. See {log_file}")
            if review_reported_block(review_result):
                raise RunnerError("Reviewer agents blocked autonomous completion. See runner log for findings.")

        commit_changes(config, issue)
        push_branch(config, branch_name)
        pr = create_pr(config, issue, branch_name, final)

        remove_label(config, issue.number, "codex-ready")
        remove_label(config, issue.number, "codex-in-progress")
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


if __name__ == "__main__":
    raise SystemExit(main())
