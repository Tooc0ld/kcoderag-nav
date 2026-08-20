#!/usr/bin/env python3
"""Explicitly refresh a KCodeRag marketplace plugin after user confirmation."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from collections.abc import Callable


MARKETPLACE = "kcoderag-nav"
COMMAND_TIMEOUT_SECONDS = 30


def _result(
    ok: bool,
    host: str,
    environment: str,
    status: str,
    stage: str,
    reason: str | None,
    exit_code: int,
) -> dict[str, object]:
    return {
        "ok": ok,
        "host": host,
        "environment": environment,
        "status": status,
        "stage": stage,
        "reason": reason,
        "exit_code": exit_code,
        "restart_required": ok,
    }


def _failed(
    host: str, environment: str, stage: str, reason: str, exit_code: int
) -> dict[str, object]:
    return _result(False, host, environment, "failed", stage, reason, exit_code)


def run_marketplace_update(
    host: str,
    environment: str,
    *,
    scope: str = "project",
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, object]:
    """Run fixed host commands in order and return only stable, safe metadata."""
    if environment not in {"qa", "dev"}:
        return _failed(host, environment, "preflight", "invalid_environment", 2)
    if host not in {"codex", "claude"}:
        return _failed(host, environment, "preflight", "unsupported_host", 2)
    if scope not in {"project", "local", "user"}:
        return _failed(host, environment, "preflight", "unsupported_scope", 2)
    if host == "codex" and scope != "project":
        return _failed(host, environment, "preflight", "unsupported_scope", 2)

    run = runner or subprocess.run
    executable = host if runner is not None else shutil.which(host)
    if executable is None:
        return _failed(host, environment, "preflight", "cli_not_found", 127)
    if host == "codex":
        commands = [
            (
                "marketplace",
                [executable, "plugin", "marketplace", "upgrade", MARKETPLACE, "--json"],
                "marketplace_refresh_failed",
            ),
            (
                "plugin",
                [
                    executable,
                    "plugin",
                    "add",
                    f"kcoderag-{environment}@{MARKETPLACE}",
                    "--json",
                ],
                "plugin_update_failed",
            ),
        ]
        success_status = "reinstall_completed"
    else:
        commands = [
            (
                "marketplace",
                [executable, "plugin", "marketplace", "update", MARKETPLACE],
                "marketplace_refresh_failed",
            ),
            (
                "plugin",
                [
                    executable,
                    "plugin",
                    "update",
                    f"kcoderag-{environment}@{MARKETPLACE}",
                    "--scope",
                    scope,
                ],
                "plugin_update_failed",
            ),
        ]
        success_status = "update_completed"
    for stage, argv, nonzero_reason in commands:
        try:
            completed = run(
                argv,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=False,
                timeout=COMMAND_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return _failed(host, environment, stage, "timeout", 124)
        except (FileNotFoundError, OSError):
            return _failed(host, environment, stage, "cli_not_found", 127)
        if completed.returncode != 0:
            return _failed(host, environment, stage, nonzero_reason, completed.returncode)
    return _result(
        True,
        host,
        environment,
        success_status,
        "complete",
        None,
        0,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=("codex", "claude"), required=True)
    parser.add_argument("--environment", choices=("qa", "dev"), required=True)
    parser.add_argument("--scope", choices=("project", "local", "user"), default="project")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = run_marketplace_update(
        args.host, args.environment, scope=args.scope
    )
    if result["ok"]:
        print(
            f"updated: host={result['host']} environment={result['environment']} "
            f"result={result['status']}; start a new session"
        )
        return 0
    print(
        f"update failed ({result['reason']}): stage={result['stage']}",
        file=sys.stderr,
    )
    return int(result["exit_code"])


if __name__ == "__main__":
    sys.exit(main())
