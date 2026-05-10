#!/usr/bin/env python3
from __future__ import annotations

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
PROMPT_TEMPLATE = AUTOMATION_DIR / "prompt-template.md"


@dataclass(frozen=True)
class Config:
    github_repo: str
    base_branch: str
    repo_dir: Path
    discord_webhook_url: str
    codex_model: str | None
    codex_timeout_seconds: int
    run_full_checks: bool
    create_draft_pr: bool


@dataclass(frozen=True)
class Issue:
    number: int
    title: str
    body: str
    url: str
    labels: set[str]


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
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


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
    codex_model = os.environ.get("CODEX_MODEL", "").strip() or None
    timeout_raw = os.environ.get("CODEX_TIMEOUT_SECONDS", "7200").strip()

    if not github_repo:
        raise RunnerError("GITHUB_REPO is required in automation/.env")
    if not discord_webhook_url:
        raise RunnerError("DISCORD_WEBHOOK_URL is required in automation/.env")
    if not repo_dir.exists():
        raise RunnerError(f"REPO_DIR does not exist: {repo_dir}")

    try:
        timeout = int(timeout_raw)
    except ValueError as exc:
        raise RunnerError("CODEX_TIMEOUT_SECONDS must be an integer") from exc

    return Config(
        github_repo=github_repo,
        base_branch=base_branch,
        repo_dir=repo_dir,
        discord_webhook_url=discord_webhook_url,
        codex_model=codex_model,
        codex_timeout_seconds=timeout,
        run_full_checks=env_bool("RUN_FULL_CHECKS", True),
        create_draft_pr=env_bool("CREATE_DRAFT_PR", True),
    )


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
        command = shlex.join(args)
        raise RunnerError(
            f"Command failed ({result.returncode}): {command}\n"
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
            "1",
            "--json",
            "number,title,body,url,labels",
        ],
        cwd=config.repo_dir,
    )
    if not payload:
        return None

    item = payload[0]
    labels = {label["name"] for label in item.get("labels", [])}
    return Issue(
        number=int(item["number"]),
        title=item["title"],
        body=item.get("body") or "",
        url=item["url"],
        labels=labels,
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
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    value = re.sub(r"-+", "-", value)
    return value[:max_length].strip("-") or "task"


def branch_name_for(issue: Issue) -> str:
    return f"codex/issue-{issue.number}-{slugify(issue.title)}"


def prepare_branch(config: Config, branch_name: str) -> None:
    run(["git", "fetch", "origin", config.base_branch], cwd=config.repo_dir)
    run(["git", "checkout", config.base_branch], cwd=config.repo_dir)
    run(["git", "pull", "--ff-only", "origin", config.base_branch], cwd=config.repo_dir)
    run(["git", "checkout", "-B", branch_name], cwd=config.repo_dir)


def render_prompt(issue: Issue) -> str:
    template = PROMPT_TEMPLATE.read_text()
    return template.format(
        issue_number=issue.number,
        issue_title=issue.title,
        issue_body=issue.body.strip() or "(No issue body provided.)",
    )


def run_codex(config: Config, issue: Issue, prompt: str, log_file: Path) -> subprocess.CompletedProcess[str]:
    args = [
        "codex",
        "exec",
        "--ask-for-approval",
        "never",
        "--sandbox",
        "workspace-write",
        "--cd",
        str(config.repo_dir),
    ]
    if config.codex_model:
        args.extend(["--model", config.codex_model])
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


def git_diff_exists(config: Config) -> bool:
    return bool(run(["git", "status", "--porcelain"], cwd=config.repo_dir).stdout.strip())


def codex_reported_blocked(result: subprocess.CompletedProcess[str]) -> bool:
    output = f"{result.stdout}\n{result.stderr}".lower()
    return "## status" in output and "`blocked`" in output


def full_checks(config: Config, log_file: Path) -> subprocess.CompletedProcess[str]:
    result = run(
        ["./scripts/codex-check.sh"],
        cwd=config.repo_dir,
        capture=True,
        check=False,
    )
    with log_file.open("a") as handle:
        handle.write(
            f"\n\n=== FULL CHECKS ===\n"
            f"exit={result.returncode}\n"
            f"STDOUT:\n{result.stdout}\n\n"
            f"STDERR:\n{result.stderr}\n"
        )
    return result


def commit_changes(config: Config, issue: Issue) -> None:
    run(["git", "add", "-A"], cwd=config.repo_dir)
    run(["git", "commit", "-m", f"codex: resolve issue #{issue.number}"], cwd=config.repo_dir)


def push_branch(config: Config, branch_name: str) -> None:
    run(["git", "push", "-u", "origin", branch_name, "--force-with-lease"], cwd=config.repo_dir)


def create_pr(config: Config, issue: Issue, branch_name: str, checks_passed: bool) -> dict[str, Any]:
    body = textwrap.dedent(
        f"""\
        ## Summary
        Autonomous Codex runner output for #{issue.number}.

        Closes #{issue.number}

        ## Verification
        - Full runner checks: {'passed' if checks_passed else 'failed'}

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
        "--json",
        "number,url,title",
    ]
    if config.create_draft_pr:
        args.append("--draft")
    return gh_json(args, cwd=config.repo_dir)


def notify_discord(config: Config, message: str) -> None:
    payload = json.dumps({"content": message}).encode()
    request = urllib.request.Request(
        config.discord_webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15):
        pass


def reset_to_base(config: Config) -> None:
    run(["git", "checkout", config.base_branch], cwd=config.repo_dir, check=False)
    run(["git", "reset", "--hard", f"origin/{config.base_branch}"], cwd=config.repo_dir, check=False)


def now_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def main() -> int:
    config = load_config()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ensure_clean_worktree(config)

    issue = fetch_next_issue(config)
    if issue is None:
        print("No eligible Codex issues found.")
        return 0

    branch_name = branch_name_for(issue)
    log_file = LOG_DIR / f"issue-{issue.number}-{now_slug()}.log"

    try:
        add_label(config, issue.number, "codex-in-progress")
        comment_issue(
            config,
            issue.number,
            f"🤖 Codex runner claimed this issue and is starting work on `{branch_name}`.",
        )
        notify_discord_best_effort(
            config,
            f"🤖 Lynk Codex runner started issue #{issue.number}: {issue.title}\n{issue.url}",
        )

        prepare_branch(config, branch_name)
        prompt = render_prompt(issue)
        codex_result = run_codex(config, issue, prompt, log_file)

        if codex_result.returncode != 0:
            raise RunnerError(f"Codex exited with status {codex_result.returncode}. See {log_file}")

        if codex_reported_blocked(codex_result):
            raise RunnerError("Codex reported the task as blocked for autonomous implementation.")

        if not git_diff_exists(config):
            raise RunnerError("Codex finished without producing any repository changes.")

        checks_passed = True
        if config.run_full_checks:
            checks_result = full_checks(config, log_file)
            checks_passed = checks_result.returncode == 0
            if not checks_passed:
                raise RunnerError(f"Full checks failed. See {log_file}")

        commit_changes(config, issue)
        push_branch(config, branch_name)
        pr = create_pr(config, issue, branch_name, checks_passed)

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
        try:
            notify_discord_best_effort(
                config,
                f"❌ Lynk Codex runner failed issue #{issue.number}: {issue.title}\n"
                f"{issue.url}\n"
                f"Reason: {exc}",
            )
        except Exception:
            pass
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    finally:
        reset_to_base(config)


if __name__ == "__main__":
    raise SystemExit(main())
