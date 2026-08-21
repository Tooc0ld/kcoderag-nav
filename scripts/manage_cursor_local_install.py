#!/usr/bin/env python3
"""Manage the free Cursor local-plugin install without a Team subscription.

The manager owns exactly ``kcoderag-nav`` plus one sibling state file beneath
Cursor's official local plugin directory. Errors expose reason codes and paths,
never MCP configuration values or file contents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, TypedDict


PLUGIN_NAME = "kcoderag-nav"
STATE_NAME = ".kcoderag-nav.install-state.json"
STATE_VERSION = 1
MANIFEST_RELATIVE = ".cursor-plugin/plugin.json"
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


class CursorInstallError(RuntimeError):
    """A credential-safe lifecycle error."""

    def __init__(self, code: str, path: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.path = path


class StatusIssue(TypedDict):
    code: str
    path: str


class StatusResult(TypedDict):
    schema_version: int
    status: str
    package_version: str
    issues: list[StatusIssue]


class PackageRecord(TypedDict):
    package_version: str
    files: dict[str, str]
    tree_digest: str


def default_local_root(home: Path | None = None) -> Path:
    """Return Cursor's documented per-user local plugin directory."""
    return (home or Path.home()) / ".cursor" / "plugins" / "local"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _tree_digest(files: dict[str, str]) -> str:
    identity = "".join(f"{path}\0{digest}\n" for path, digest in sorted(files.items()))
    return _sha256(identity.encode("utf-8"))


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _tree_files(root: Path, error_code: str) -> dict[str, str]:
    """Hash a regular, self-contained tree and reject links."""
    files: dict[str, str] = {}
    try:
        entries = sorted(root.rglob("*"), key=lambda item: item.as_posix())
        for entry in entries:
            relative = _relative(entry, root)
            if entry.is_symlink():
                raise CursorInstallError(error_code, relative)
            if entry.is_file():
                files[relative] = _sha256(entry.read_bytes())
            elif not entry.is_dir():
                raise CursorInstallError(error_code, relative)
    except CursorInstallError:
        raise
    except OSError as exc:
        raise CursorInstallError(error_code, root.name) from exc
    return files


def _source_record(raw_source: Path) -> PackageRecord:
    source = raw_source.expanduser()
    if not source.exists() or not source.is_dir() or source.is_symlink():
        raise CursorInstallError("invalid_source", source.name or PLUGIN_NAME)
    try:
        source = source.resolve(strict=True)
        manifest_path = source.joinpath(*MANIFEST_RELATIVE.split("/"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CursorInstallError("invalid_source", MANIFEST_RELATIVE) from exc
    if (
        not isinstance(manifest, dict)
        or manifest.get("name") != PLUGIN_NAME
        or not isinstance(manifest.get("version"), str)
        or not manifest["version"]
    ):
        raise CursorInstallError("invalid_source", MANIFEST_RELATIVE)
    files = _tree_files(source, "invalid_source")
    if MANIFEST_RELATIVE not in files:
        raise CursorInstallError("invalid_source", MANIFEST_RELATIVE)
    return {
        "package_version": manifest["version"],
        "files": files,
        "tree_digest": _tree_digest(files),
    }


def _layout(raw_local_root: Path, *, create: bool) -> tuple[Path, Path, Path]:
    local_root = raw_local_root.expanduser()
    try:
        if create:
            local_root.mkdir(parents=True, exist_ok=True)
        if local_root.exists() and (not local_root.is_dir() or local_root.is_symlink()):
            raise CursorInstallError("invalid_local_root", local_root.name)
        resolved_root = local_root.resolve(strict=local_root.exists())
        target = local_root / PLUGIN_NAME
        state_path = local_root / STATE_NAME
        if target.is_symlink():
            raise CursorInstallError("symlink_target", PLUGIN_NAME)
        resolved_target = target.resolve(strict=False)
        resolved_target.relative_to(resolved_root)
        if resolved_target.parent != resolved_root or resolved_target.name != PLUGIN_NAME:
            raise CursorInstallError("path_escape", PLUGIN_NAME)
        resolved_state = state_path.resolve(strict=False)
        resolved_state.relative_to(resolved_root)
        if resolved_state.parent != resolved_root or resolved_state.name != STATE_NAME:
            raise CursorInstallError("path_escape", STATE_NAME)
    except CursorInstallError:
        raise
    except (OSError, ValueError) as exc:
        raise CursorInstallError("invalid_local_root", local_root.name) from exc
    return local_root, target, state_path


def _state_payload(record: PackageRecord) -> dict[str, object]:
    return {
        "schema_version": STATE_VERSION,
        "plugin_name": PLUGIN_NAME,
        "package_version": record["package_version"],
        "tree_digest": record["tree_digest"],
        "files": record["files"],
    }


def _load_state(state_path: Path) -> dict[str, Any] | None:
    if not state_path.exists():
        return None
    if state_path.is_symlink():
        raise CursorInstallError("invalid_state", STATE_NAME)
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CursorInstallError("invalid_state", STATE_NAME) from exc
    if not isinstance(state, dict) or set(state) != {
        "schema_version",
        "plugin_name",
        "package_version",
        "tree_digest",
        "files",
    }:
        raise CursorInstallError("invalid_state", STATE_NAME)
    files = state.get("files")
    if (
        state.get("schema_version") != STATE_VERSION
        or state.get("plugin_name") != PLUGIN_NAME
        or not isinstance(state.get("package_version"), str)
        or not isinstance(state.get("tree_digest"), str)
        or not DIGEST_RE.fullmatch(state["tree_digest"])
        or not isinstance(files, dict)
        or not files
    ):
        raise CursorInstallError("invalid_state", STATE_NAME)
    for relative, digest in files.items():
        if (
            not isinstance(relative, str)
            or not relative
            or relative.startswith("/")
            or ".." in Path(relative).parts
            or not isinstance(digest, str)
            or not DIGEST_RE.fullmatch(digest)
        ):
            raise CursorInstallError("invalid_state", STATE_NAME)
    if _tree_digest(files) != state["tree_digest"]:
        raise CursorInstallError("invalid_state", STATE_NAME)
    return state


def _expected_directories(files: dict[str, str]) -> set[str]:
    directories: set[str] = set()
    for relative in files:
        parent = Path(relative).parent
        while parent != Path("."):
            directories.add(parent.as_posix())
            parent = parent.parent
    return directories


def _installed_issues(target: Path, state: dict[str, Any]) -> list[StatusIssue]:
    expected: dict[str, str] = state["files"]
    issues: list[StatusIssue] = []
    try:
        entries = sorted(target.rglob("*"), key=lambda item: item.as_posix())
        actual_files: dict[str, str] = {}
        actual_directories: set[str] = set()
        for entry in entries:
            relative = _relative(entry, target)
            if entry.is_symlink():
                issues.append({"code": "managed_symlink_present", "path": relative})
            elif entry.is_file():
                actual_files[relative] = _sha256(entry.read_bytes())
            elif entry.is_dir():
                actual_directories.add(relative)
            else:
                issues.append({"code": "managed_special_path", "path": relative})
    except OSError as exc:
        raise CursorInstallError("unreadable_install", PLUGIN_NAME) from exc

    for relative, digest in sorted(expected.items()):
        if relative not in actual_files:
            issues.append({"code": "managed_file_missing", "path": relative})
        elif actual_files[relative] != digest:
            issues.append({"code": "managed_content_changed", "path": relative})
    for relative in sorted(set(actual_files) - set(expected)):
        issues.append({"code": "unmanaged_file_present", "path": relative})
    for relative in sorted(actual_directories - _expected_directories(expected)):
        issues.append({"code": "unmanaged_directory_present", "path": relative})
    return sorted(issues, key=lambda item: (item["path"], item["code"]))


def inspect_status(raw_local_root: Path, raw_source: Path) -> StatusResult:
    """Inspect ownership and update state without writing."""
    try:
        _, target, state_path = _layout(raw_local_root, create=False)
    except CursorInstallError as exc:
        return {
            "schema_version": STATE_VERSION,
            "status": "invalid",
            "package_version": "",
            "issues": [{"code": exc.code, "path": exc.path}],
        }
    target_exists = target.exists() or target.is_symlink()
    state_exists = state_path.exists() or state_path.is_symlink()
    if not target_exists and not state_exists:
        return {
            "schema_version": STATE_VERSION,
            "status": "not_installed",
            "package_version": "",
            "issues": [],
        }
    if target.is_symlink():
        return {
            "schema_version": STATE_VERSION,
            "status": "invalid",
            "package_version": "",
            "issues": [{"code": "symlink_target", "path": PLUGIN_NAME}],
        }
    if target_exists and not state_exists:
        return {
            "schema_version": STATE_VERSION,
            "status": "invalid",
            "package_version": "",
            "issues": [{"code": "unmanaged_target", "path": PLUGIN_NAME}],
        }
    if state_exists and not target_exists:
        return {
            "schema_version": STATE_VERSION,
            "status": "invalid",
            "package_version": "",
            "issues": [{"code": "orphaned_state", "path": STATE_NAME}],
        }
    try:
        state = _load_state(state_path)
        if state is None:
            raise CursorInstallError("invalid_state", STATE_NAME)
        issues = _installed_issues(target, state)
        if issues:
            return {
                "schema_version": STATE_VERSION,
                "status": "drifted",
                "package_version": state["package_version"],
                "issues": issues,
            }
        source = _source_record(raw_source)
    except CursorInstallError as exc:
        return {
            "schema_version": STATE_VERSION,
            "status": "invalid",
            "package_version": "",
            "issues": [{"code": exc.code, "path": exc.path}],
        }
    if state["tree_digest"] != source["tree_digest"]:
        return {
            "schema_version": STATE_VERSION,
            "status": "update_available",
            "package_version": state["package_version"],
            "issues": [{"code": "source_update_available", "path": PLUGIN_NAME}],
        }
    return {
        "schema_version": STATE_VERSION,
        "status": "healthy",
        "package_version": state["package_version"],
        "issues": [],
    }


def _raise_for_owned_install(local_root: Path, source: Path) -> tuple[StatusResult, dict[str, Any]]:
    status = inspect_status(local_root, source)
    if status["status"] not in {"healthy", "update_available"}:
        issue = status["issues"][0] if status["issues"] else {
            "code": "not_installed",
            "path": PLUGIN_NAME,
        }
        raise CursorInstallError(issue["code"], issue["path"])
    _, _, state_path = _layout(local_root, create=False)
    state = _load_state(state_path)
    if state is None:
        raise CursorInstallError("not_installed", PLUGIN_NAME)
    return status, state


def _remove_exact_target(local_root: Path, target: Path) -> None:
    """Remove only the verified direct child owned by this manager."""
    resolved_root = local_root.resolve(strict=True)
    resolved_target = target.resolve(strict=True)
    if resolved_target.parent != resolved_root or resolved_target.name != PLUGIN_NAME:
        raise CursorInstallError("path_escape", PLUGIN_NAME)
    shutil.rmtree(resolved_target)


def _replace_install(local_root: Path, source: Path, record: PackageRecord, *, fresh: bool) -> None:
    local_root, target, state_path = _layout(local_root, create=True)
    source_resolved = source.expanduser().resolve(strict=True)
    if source_resolved == target.resolve(strict=False):
        raise CursorInstallError("source_is_target", PLUGIN_NAME)
    stage_root = Path(tempfile.mkdtemp(prefix=".kcoderag-nav-stage-", dir=local_root))
    staged_target = stage_root / PLUGIN_NAME
    staged_state = stage_root / STATE_NAME
    backup = stage_root / "previous-install"
    cleanup_stage = True
    try:
        shutil.copytree(source_resolved, staged_target)
        if _tree_files(staged_target, "copy_failed") != record["files"]:
            raise CursorInstallError("copy_failed", PLUGIN_NAME)
        staged_state.write_text(
            json.dumps(_state_payload(record), ensure_ascii=True, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        if fresh:
            os.replace(staged_target, target)
            try:
                os.replace(staged_state, state_path)
            except OSError:
                _remove_exact_target(local_root, target)
                raise
        else:
            os.replace(target, backup)
            try:
                os.replace(staged_target, target)
                os.replace(staged_state, state_path)
            except OSError as install_error:
                try:
                    if target.exists():
                        _remove_exact_target(local_root, target)
                    os.replace(backup, target)
                except OSError as rollback_error:
                    cleanup_stage = False
                    recovery_path = f"{stage_root.name}/previous-install"
                    raise CursorInstallError("rollback_failed", recovery_path) from rollback_error
                raise install_error
    except CursorInstallError:
        raise
    except OSError as exc:
        raise CursorInstallError("install_failed", PLUGIN_NAME) from exc
    finally:
        if cleanup_stage:
            try:
                shutil.rmtree(stage_root)
            except OSError:
                pass


def install(raw_local_root: Path, raw_source: Path) -> str:
    """Install fresh, or safely refresh an existing managed install."""
    record = _source_record(raw_source)
    _, target, state_path = _layout(raw_local_root, create=False)
    if not (target.exists() or target.is_symlink() or state_path.exists() or state_path.is_symlink()):
        _replace_install(raw_local_root, raw_source, record, fresh=True)
        return f"installed: {record['package_version']}"
    status, _ = _raise_for_owned_install(raw_local_root, raw_source)
    if status["status"] == "healthy":
        return f"already current: {record['package_version']}"
    _replace_install(raw_local_root, raw_source, record, fresh=False)
    return f"updated: {record['package_version']}"


def update(raw_local_root: Path, raw_source: Path) -> str:
    """Update an unchanged managed install from the current checkout."""
    record = _source_record(raw_source)
    status, _ = _raise_for_owned_install(raw_local_root, raw_source)
    if status["status"] == "healthy":
        return f"already current: {record['package_version']}"
    _replace_install(raw_local_root, raw_source, record, fresh=False)
    return f"updated: {record['package_version']}"


def uninstall(raw_local_root: Path) -> str:
    """Remove only an unchanged install owned by this manager."""
    local_root, target, state_path = _layout(raw_local_root, create=False)
    if target.is_symlink():
        raise CursorInstallError("symlink_target", PLUGIN_NAME)
    if target.exists() and not state_path.exists():
        raise CursorInstallError("unmanaged_target", PLUGIN_NAME)
    if state_path.exists() and not target.exists():
        raise CursorInstallError("orphaned_state", STATE_NAME)
    if not target.exists() and not state_path.exists():
        raise CursorInstallError("not_installed", PLUGIN_NAME)
    state = _load_state(state_path)
    if state is None:
        raise CursorInstallError("invalid_state", STATE_NAME)
    issues = _installed_issues(target, state)
    if issues:
        raise CursorInstallError(issues[0]["code"], issues[0]["path"])
    try:
        _remove_exact_target(local_root, target)
        state_path.unlink()
    except OSError as exc:
        raise CursorInstallError("uninstall_failed", PLUGIN_NAME) from exc
    return f"uninstalled: {state['package_version']}"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage the free Cursor local installation of kcoderag-nav."
    )
    parser.add_argument("command", choices=("install", "status", "update", "uninstall"))
    parser.add_argument(
        "--local-root",
        type=Path,
        default=default_local_root(),
        help="Cursor local plugin directory (default: ~/.cursor/plugins/local)",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "kcoderag-cursor",
        help="Generated kcoderag-cursor package in this checkout",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable status JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    if arguments.json and arguments.command != "status":
        parser.error("--json is only valid with status")
    try:
        if arguments.command == "status":
            result = inspect_status(arguments.local_root, arguments.source)
            if arguments.json:
                print(json.dumps(result, ensure_ascii=True, sort_keys=True))
            else:
                print(f"{result['status']}: {result['package_version'] or '-'}")
                for issue in result["issues"]:
                    print(f"- {issue['code']}: {issue['path']}")
        elif arguments.command == "install":
            print(install(arguments.local_root, arguments.source))
        elif arguments.command == "update":
            print(update(arguments.local_root, arguments.source))
        else:
            print(uninstall(arguments.local_root))
    except CursorInstallError as exc:
        suffix = f": {exc.path}" if exc.path else ""
        print(f"error: {exc.code}{suffix}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
