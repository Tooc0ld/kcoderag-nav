#!/usr/bin/env python3
"""Run optional Claude Code or Codex smoke checks against a loopback MCP stub."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Sequence, TypedDict

try:
    from . import generate_plugins
    from . import manage_project_install
except ImportError:
    import generate_plugins
    import manage_project_install


SMOKE_PROMPT = (
    "Use a structural code search for SyntheticSymbol so the installed advisory hook runs, "
    "then call the synthetic search_code MCP tool exactly once."
)


class SmokeResult(TypedDict):
    schema_version: int
    status: str
    host: str
    reason: str
    hook_event: bool
    tool_event: bool
    stub_receipt: bool
    config_wired: bool


def _result(
    host: str,
    status: str,
    reason: str,
    *,
    hook_event: bool = False,
    tool_event: bool = False,
    stub_receipt: bool = False,
    config_wired: bool = False,
) -> SmokeResult:
    return {
        "schema_version": 1,
        "status": status,
        "host": host,
        "reason": reason,
        "hook_event": hook_event,
        "tool_event": tool_event,
        "stub_receipt": stub_receipt,
        "config_wired": config_wired,
    }


def build_host_command(
    host: str,
    executable: Sequence[str],
    *,
    workspace: Path,
    plugin_dir: Path,
    mcp_config: Path,
) -> list[str]:
    """Build a host command without weakening the read-only sandbox boundary."""
    prefix = list(executable)
    if host == "codex":
        return prefix + [
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--dangerously-bypass-hook-trust",
            "--json",
            "--sandbox",
            "read-only",
            "--cd",
            str(workspace),
            SMOKE_PROMPT,
        ]
    if host == "claude":
        return prefix + [
            "-p",
            SMOKE_PROMPT,
            "--plugin-dir",
            str(plugin_dir),
            "--mcp-config",
            str(mcp_config),
            "--strict-mcp-config",
            "--output-format",
            "stream-json",
            "--verbose",
        ]
    raise ValueError("unsupported_host")


def _write_synthetic_mcp_sources(source_root: Path, stub_url: str) -> None:
    metadata_path = source_root / "plugin-src" / "environments.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    for environment in metadata["environments"]:
        relative_path = Path(environment["mcp_source"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("invalid_mcp_source_path")
        document = {
            "mcpServers": {
                environment["server_name"]: {
                    "type": "http",
                    "url": stub_url,
                    "headers": {},
                }
            }
        }
        destination = source_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(generate_plugins.canonical_json(document))


def _prepare_synthetic_environment(
    repository_root: Path,
    temporary_root: Path,
    stub_url: str,
) -> tuple[Path, Path, Path, bool]:
    source_root = temporary_root / "synthetic-source"
    shutil.copytree(
        repository_root / "plugin-src",
        source_root / "plugin-src",
        ignore=shutil.ignore_patterns("*.mcp.json", "__pycache__", "*.pyc"),
    )
    _write_synthetic_mcp_sources(source_root, stub_url)
    inputs = generate_plugins.load_inputs(source_root)
    generate_plugins.write_outputs(source_root, generate_plugins.render_outputs(inputs))

    workspace = temporary_root / "workspace"
    workspace.mkdir()
    (workspace / "synthetic.cpp").write_text(
        "int SyntheticSymbol() { return 7; }\n",
        encoding="utf-8",
        newline="\n",
    )
    manage_project_install.install(workspace, source_root, {"qa"})

    mcp_config = temporary_root / "strict-mcp.json"
    mcp_config.write_bytes(
        generate_plugins.canonical_json(
            {
                "mcpServers": {
                    "kcoderag-qa": {
                        "type": "http",
                        "url": stub_url,
                    }
                }
            }
        )
    )
    plugin_dir = source_root / "kcoderag-qa"

    package_wired = True
    for environment in ("qa", "dev"):
        package_mcp = json.loads(
            (source_root / f"kcoderag-{environment}" / ".mcp.json").read_text(
                encoding="utf-8"
            )
        )
        entry = package_mcp["mcpServers"][f"kcoderag-{environment}"]
        package_wired = package_wired and entry.get("url") == stub_url
    project_config = (workspace / ".codex" / "config.toml").read_text(encoding="utf-8")
    project_wired = (
        project_config.count(stub_url) == 1
        and "kcoderag-qa" in project_config
        and "kcoderag-dev" not in project_config
    )
    strict_wired = json.loads(mcp_config.read_text(encoding="utf-8"))["mcpServers"][
        "kcoderag-qa"
    ]["url"] == stub_url
    return workspace, plugin_dir, mcp_config, package_wired and project_wired and strict_wired


def _structured_evidence(output: str) -> tuple[bool, bool]:
    hook_event = False
    tool_event = False

    def inspect(value: object) -> None:
        nonlocal hook_event, tool_event
        if isinstance(value, dict):
            event_name = value.get("hook_event_name", value.get("hookEventName"))
            event_type = value.get("type")
            if event_name == "PreToolUse" and event_type in {
                "hook_event",
                "hook_started",
                "hook_response",
                "hook_progress",
            }:
                hook_event = True
            if value.get("tool_name") == "search_code" and event_type in {
                "mcp_tool_call",
                "tool_call",
                "tool_use",
            }:
                tool_event = True
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    for line in output.splitlines():
        try:
            inspect(json.loads(line))
        except json.JSONDecodeError:
            continue
    return hook_event, tool_event


def _command_available(executable: Sequence[str]) -> bool:
    if not executable:
        return False
    command = executable[0]
    candidate = Path(command)
    if candidate.is_file():
        return True
    return shutil.which(command) is not None


def run_smoke(
    host: str,
    *,
    executable: Sequence[str] | None = None,
    repository_root: Path | None = None,
    process_environment: dict[str, str] | None = None,
    timeout_seconds: float = 120,
) -> SmokeResult:
    """Run one isolated real or fake host and return only safe structured evidence."""
    repository_root = (repository_root or Path(__file__).resolve().parents[1]).resolve()
    selected = tuple(executable or (host,))
    if not _command_available(selected):
        return _result(host, "NOT_RUN", "cli_missing")

    if str(repository_root) not in sys.path:
        sys.path.insert(0, str(repository_root))
    from tests.stub_mcp_server import StubMCPServer, read_receipts

    with tempfile.TemporaryDirectory(prefix="kcoderag-host-smoke-") as directory:
        temporary_root = Path(directory)
        receipt_path = temporary_root / "stub-receipts.jsonl"
        try:
            with StubMCPServer(receipt_path=receipt_path) as server:
                workspace, plugin_dir, mcp_config, config_wired = (
                    _prepare_synthetic_environment(repository_root, temporary_root, server.url)
                )
                if not config_wired:
                    return _result(host, "FAIL", "synthetic_config_mismatch")
                git = shutil.which("git")
                if git is None:
                    return _result(host, "NOT_RUN", "git_missing", config_wired=True)
                initialized = subprocess.run(
                    [git, "init", "--quiet"],
                    cwd=workspace,
                    capture_output=True,
                    check=False,
                    timeout=10,
                )
                if initialized.returncode != 0:
                    return _result(host, "FAIL", "workspace_init_failed", config_wired=True)

                host_home = temporary_root / "host-home"
                host_home.mkdir()
                environment = dict(process_environment or os.environ)
                environment.update(
                    {
                        "CODEX_HOME": str(host_home),
                        "CLAUDE_CONFIG_DIR": str(host_home),
                        "KCODERAG_NAV_STUB_URL": server.url,
                    }
                )
                command = build_host_command(
                    host,
                    selected,
                    workspace=workspace,
                    plugin_dir=plugin_dir,
                    mcp_config=mcp_config,
                )
                try:
                    completed = subprocess.run(
                        command,
                        cwd=workspace,
                        env=environment,
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=timeout_seconds,
                    )
                except subprocess.TimeoutExpired:
                    return _result(host, "FAIL", "timeout", config_wired=True)

                receipts = read_receipts(receipt_path)
                stub_receipt = any(
                    receipt.get("method") == "tools/call"
                    and receipt.get("tool_name") == "search_code"
                    for receipt in receipts
                )
                if completed.returncode != 0:
                    diagnostic = (completed.stdout + "\n" + completed.stderr).lower()
                    auth_markers = ("authentication", "not logged in", "unauthorized", "login")
                    reason = "auth_missing" if any(item in diagnostic for item in auth_markers) else "host_execution_failed"
                    status = "NOT_RUN" if reason == "auth_missing" else "FAIL"
                    return _result(
                        host,
                        status,
                        reason,
                        stub_receipt=stub_receipt,
                        config_wired=True,
                    )
                hook_event, tool_event = _structured_evidence(completed.stdout)
                if not (hook_event and tool_event and stub_receipt):
                    return _result(
                        host,
                        "FAIL",
                        "structured_evidence_incomplete",
                        hook_event=hook_event,
                        tool_event=tool_event,
                        stub_receipt=stub_receipt,
                        config_wired=True,
                    )
                return _result(
                    host,
                    "PASS",
                    "verified",
                    hook_event=True,
                    tool_event=True,
                    stub_receipt=True,
                    config_wired=True,
                )
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            return _result(host, "FAIL", "harness_setup_failed")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=("codex", "claude"), required=True)
    parser.add_argument("--json", action="store_true", dest="json_output")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = run_smoke(args.host)
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(f"{result['host']}: {result['status']} ({result['reason']})")
    return 1 if result["status"] == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
