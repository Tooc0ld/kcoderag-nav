#!/usr/bin/env python3
"""Safely install KCodeRag navigation assets into one trusted project.

Only paths beneath the explicit target's ``.codex`` and ``.agents`` directories are
eligible for mutation. Diagnostics contain paths and reason codes, never MCP values.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, TypedDict

try:
    from .generate_plugins import (
        CanonicalInputs,
        GenerationError,
        _read_normalized,
        _render_template,
        canonical_json,
        load_inputs,
        load_routing,
        render_routing_markdown,
        resolve_route,
    )
except ImportError:  # Direct script execution keeps the scripts directory on sys.path.
    from generate_plugins import (
        CanonicalInputs,
        GenerationError,
        _read_normalized,
        _render_template,
        canonical_json,
        load_inputs,
        load_routing,
        render_routing_markdown,
        resolve_route,
    )


STATE_VERSION = 1
STATE_RELATIVE = ".codex/kcoderag-nav/install-state.json"
CONFIG_RELATIVE = ".codex/config.toml"
HOOKS_RELATIVE = ".codex/hooks.json"
SKILL_RELATIVE = ".agents/skills/kcoderag-nav/SKILL.md"
MANAGED_ROOT = ".codex/kcoderag-nav"
INSTALL_ENVIRONMENT_CHOICES = ("qa", "dev")
UNINSTALL_ENVIRONMENT_CHOICES = ("qa", "dev")
HOOK_PAYLOAD_FILENAMES = ("grep_nudge.py", "run_hook.sh", "run_hook.cmd")
TOML_TABLE_RE = re.compile(r"(?m)^\s*\[\s*mcp_servers\.(?:\"?)(kcoderag-(?:qa|dev))(?:\"?)\s*\]")


class InstallError(RuntimeError):
    """A path-only installer error safe for command-line output."""

    def __init__(self, code: str, path: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.path = path


def _single_environment(environments: set[str], path: str = STATE_RELATIVE) -> str:
    if len(environments) != 1 or not environments.issubset({"qa", "dev"}):
        raise InstallError("unsupported_environment_set", path)
    return next(iter(environments))


class StatusIssue(TypedDict):
    code: str
    path: str


class StatusResult(TypedDict):
    schema_version: int
    status: str
    active_environments: list[str]
    issues: list[StatusIssue]


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _encode_original(payload: bytes | None) -> dict[str, object]:
    if payload is None:
        return {"existed": False, "base64": ""}
    return {"existed": True, "base64": base64.b64encode(payload).decode("ascii")}


def _decode_original(record: object, relative_path: str) -> bytes | None:
    if not isinstance(record, dict) or set(record) != {"existed", "base64"}:
        raise InstallError("invalid_state", relative_path)
    existed = record["existed"]
    encoded = record["base64"]
    if not isinstance(existed, bool) or not isinstance(encoded, str):
        raise InstallError("invalid_state", relative_path)
    if not existed:
        if encoded:
            raise InstallError("invalid_state", relative_path)
        return None
    try:
        return base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise InstallError("invalid_state", relative_path) from exc


def _read_optional(path: Path) -> bytes | None:
    try:
        return path.read_bytes() if path.exists() else None
    except OSError as exc:
        raise InstallError("unreadable", path.name) from exc


def _safe_target(raw_target: Path) -> Path:
    if not raw_target.exists() or not raw_target.is_dir() or raw_target.is_symlink():
        raise InstallError("invalid_target", str(raw_target))
    try:
        return raw_target.resolve(strict=True)
    except OSError as exc:
        raise InstallError("invalid_target", str(raw_target)) from exc


def _assert_managed_path(target: Path, relative_path: str) -> Path:
    if not (relative_path.startswith(".codex/") or relative_path.startswith(".agents/")):
        raise InstallError("outside_managed_roots", relative_path)
    candidate = target.joinpath(*relative_path.split("/"))
    current = candidate
    while current != target:
        if current.exists() and current.is_symlink():
            raise InstallError("symlink_escape", relative_path)
        current = current.parent
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(target)
    except (OSError, ValueError) as exc:
        raise InstallError("path_escape", relative_path) from exc
    return candidate


def _load_state(target: Path) -> dict[str, Any] | None:
    path = _assert_managed_path(target, STATE_RELATIVE)
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise InstallError("invalid_state", STATE_RELATIVE) from exc
    if not isinstance(state, dict) or state.get("version") != STATE_VERSION:
        raise InstallError("invalid_state", STATE_RELATIVE)
    active = state.get("active_environments")
    originals = state.get("originals")
    digests = state.get("digests")
    if (
        not isinstance(active, list)
        or not active
        or not all(item in {"qa", "dev"} for item in active)
        or len(set(active)) != len(active)
        or not isinstance(originals, dict)
        or not isinstance(digests, dict)
    ):
        raise InstallError("invalid_state", STATE_RELATIVE)
    allowed_paths = _all_managed_paths({"qa", "dev"}) | LEGACY_PRIVATE_HOOKS - {STATE_RELATIVE}
    if not set(originals).issubset(allowed_paths) or not set(digests).issubset(allowed_paths):
        raise InstallError("invalid_state", STATE_RELATIVE)
    return state


def _all_managed_paths(environments: set[str]) -> set[str]:
    paths = {CONFIG_RELATIVE, HOOKS_RELATIVE, SKILL_RELATIVE, STATE_RELATIVE}
    for environment in environments:
        for filename in HOOK_PAYLOAD_FILENAMES:
            paths.add(f"{MANAGED_ROOT}/{environment}/hooks/{filename}")
    return paths


def _legacy_payload_paths() -> frozenset[str]:
    """Payload copies older installer revisions wrote but nothing consumes."""
    return frozenset(
        f"{MANAGED_ROOT}/{environment}/hooks/hooks.json" for environment in ("qa", "dev")
    )


LEGACY_PRIVATE_HOOKS = _legacy_payload_paths()


def _verify_digests(target: Path, state: dict[str, Any]) -> None:
    digests = state["digests"]
    for relative_path, expected in digests.items():
        if not isinstance(relative_path, str) or not isinstance(expected, str):
            raise InstallError("invalid_state", STATE_RELATIVE)
        current = _read_optional(_assert_managed_path(target, relative_path))
        if current is None or _sha256(current) != expected:
            raise InstallError("managed_content_changed", relative_path)


def _environment_map(inputs: CanonicalInputs) -> dict[str, dict[str, str]]:
    return {item["id"]: item for item in inputs.environments}


def _mcp_entry(inputs: CanonicalInputs, environment: str) -> dict[str, Any]:
    metadata = _environment_map(inputs)[environment]
    try:
        document = json.loads((inputs.root / metadata["mcp_source"]).read_text(encoding="utf-8"))
        entry = document["mcpServers"][metadata["server_name"]]
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise InstallError("invalid_mcp_source", metadata["mcp_source"]) from exc
    if not isinstance(entry, dict) or not isinstance(entry.get("url"), str):
        raise InstallError("invalid_mcp_source", metadata["mcp_source"])
    headers = entry.get("http_headers", entry.get("headers"))
    if not isinstance(headers, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in headers.items()
    ):
        raise InstallError("invalid_mcp_source", metadata["mcp_source"])
    return {"url": entry["url"], "http_headers": headers}


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _config_block(inputs: CanonicalInputs, environment: str) -> bytes:
    metadata = _environment_map(inputs)[environment]
    entry = _mcp_entry(inputs, environment)
    header_items = ", ".join(
        f"{_toml_string(key)} = {_toml_string(value)}"
        for key, value in sorted(entry["http_headers"].items())
    )
    text = (
        f"# BEGIN KCODERAG-NAV {environment}\n"
        f"[mcp_servers.{_toml_string(metadata['server_name'])}]\n"
        f"url = {_toml_string(entry['url'])}\n"
        f"http_headers = {{ {header_items} }}\n"
        f"# END KCODERAG-NAV {environment}\n"
    )
    return text.encode("utf-8")


def _render_config(inputs: CanonicalInputs, original: bytes | None, active: set[str]) -> bytes:
    base = original or b""
    try:
        original_text = base.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InstallError("invalid_utf8", CONFIG_RELATIVE) from exc
    if "# BEGIN KCODERAG-NAV" in original_text or TOML_TABLE_RE.search(original_text):
        raise InstallError("unmanaged_name_conflict", CONFIG_RELATIVE)
    if not active:
        return base
    separator = b"" if not base or base.endswith(b"\n\n") else (b"\n" if base.endswith(b"\n") else b"\n\n")
    blocks = b"\n".join(_config_block(inputs, environment) for environment in sorted(active))
    return base + separator + blocks


def _parse_hooks(original: bytes | None) -> dict[str, Any]:
    if original is None:
        document: dict[str, Any] = {"hooks": {}}
    else:
        try:
            document = json.loads(original.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise InstallError("invalid_json", HOOKS_RELATIVE) from exc
    if not isinstance(document, dict):
        raise InstallError("invalid_json", HOOKS_RELATIVE)
    hooks = document.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise InstallError("invalid_json", HOOKS_RELATIVE)
    pre_tool_use = hooks.setdefault("PreToolUse", [])
    if not isinstance(pre_tool_use, list) or not all(isinstance(item, dict) for item in pre_tool_use):
        raise InstallError("invalid_json", HOOKS_RELATIVE)
    encoded = json.dumps(document, ensure_ascii=False)
    if ".codex/kcoderag-nav/" in encoded or ".codex\\kcoderag-nav\\" in encoded:
        raise InstallError("unmanaged_name_conflict", HOOKS_RELATIVE)
    return document


def _project_hook(inputs: CanonicalInputs, environment: str) -> dict[str, Any]:
    try:
        source = json.loads((inputs.root / "plugin-src/hooks/hooks.json").read_text(encoding="utf-8"))
        entry = copy.deepcopy(source["hooks"]["PreToolUse"][0])
        command = entry["hooks"][0]
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise InstallError("invalid_hook_source", "plugin-src/hooks/hooks.json") from exc
    relative_posix = f".codex/kcoderag-nav/{environment}/hooks/run_hook.sh"
    relative_windows = relative_posix.replace("/", "\\").removesuffix("run_hook.sh")
    relative_windows += "run_hook.cmd"
    command["command"] = f'sh "{relative_posix}"'
    command["commandWindows"] = f'call "{relative_windows}"'
    command["statusMessage"] = f"Checking code lookup strategy ({environment.upper()})"
    return entry


def _render_hooks(inputs: CanonicalInputs, original: bytes | None, active: set[str]) -> bytes:
    document = _parse_hooks(original)
    pre_tool_use = document["hooks"]["PreToolUse"]
    pre_tool_use.extend(_project_hook(inputs, environment) for environment in sorted(active))
    return canonical_json(document)


def _render_skill(inputs: CanonicalInputs, active: set[str]) -> bytes:
    environment = _single_environment(active, SKILL_RELATIVE)
    metadata = _environment_map(inputs)
    display_name = metadata[environment]["display_name"]
    try:
        text = (inputs.root / "plugin-src/skills/code-lookup-discipline/SKILL.md").read_text(
            encoding="utf-8"
        )
    except (OSError, UnicodeError) as exc:
        raise InstallError("invalid_skill_source", "plugin-src/skills/code-lookup-discipline/SKILL.md") from exc
    text = text.replace("{{display_name}}", display_name)
    text = text.replace("{{routing_policy}}", render_routing_markdown(load_routing(inputs.root)))
    if "{{" in text:
        raise InstallError("invalid_skill_source", "plugin-src/skills/code-lookup-discipline/SKILL.md")
    return (text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n") + "\n").encode("utf-8")


def _private_payloads(inputs: CanonicalInputs, environment: str) -> dict[str, bytes]:
    """Render one environment's hook source and copy its runtime launchers."""
    metadata = _environment_map(inputs)[environment]
    package = metadata["plugin_name"]
    replacements = {
        "environment": environment,
        "environment_upper": environment.upper(),
        "plugin_name": package,
        "display_name": metadata["display_name"],
        "tool_prefix": metadata["agent_tool_prefix"],
    }
    try:
        hook_source = inputs.root / "plugin-src" / "hooks"
        payload = _render_template(hook_source / "grep_nudge.py", replacements)
        posix_launcher = _read_normalized(hook_source / "run_hook.sh")
        windows_launcher = _read_normalized(hook_source / "run_hook.cmd")
    except GenerationError as exc:
        raise InstallError(exc.code, "plugin-src/hooks/grep_nudge.py") from exc
    prefix = f"{MANAGED_ROOT}/{environment}/hooks"
    return {
        f"{prefix}/grep_nudge.py": payload,
        f"{prefix}/run_hook.sh": posix_launcher,
        f"{prefix}/run_hook.cmd": windows_launcher,
    }


def _capture_new_state(target: Path, managed_paths: set[str]) -> dict[str, Any]:
    originals: dict[str, object] = {}
    for relative_path in sorted(managed_paths - {STATE_RELATIVE}):
        current = _read_optional(_assert_managed_path(target, relative_path))
        if relative_path == SKILL_RELATIVE and current is not None:
            raise InstallError("unmanaged_name_conflict", relative_path)
        if relative_path.startswith(f"{MANAGED_ROOT}/") and current is not None:
            raise InstallError("unmanaged_name_conflict", relative_path)
        originals[relative_path] = _encode_original(current)
    return {
        "version": STATE_VERSION,
        "active_environments": [],
        "originals": originals,
        "digests": {},
    }


def _desired_install(
    target: Path, inputs: CanonicalInputs, state: dict[str, Any] | None, requested: set[str]
) -> tuple[dict[str, bytes | None], dict[str, Any]]:
    requested_environment = _single_environment(requested)
    legacy_present = frozenset(
        relative_path
        for relative_path in sorted(LEGACY_PRIVATE_HOOKS)
        if _read_optional(_assert_managed_path(target, relative_path)) is not None
    )
    if state is None:
        state = _capture_new_state(target, _all_managed_paths(requested) | legacy_present)
        owned_legacy = frozenset()
    else:
        _verify_digests(target, state)
        owned_legacy = legacy_present & set(state["digests"])
        unowned_legacy = legacy_present - owned_legacy
        if unowned_legacy:
            raise InstallError("unmanaged_name_conflict", sorted(unowned_legacy)[0])
        missing_originals = _all_managed_paths(requested) - {STATE_RELATIVE} - set(state["originals"])
        for relative_path in sorted(missing_originals):
            current = _read_optional(_assert_managed_path(target, relative_path))
            if current is not None:
                raise InstallError("unmanaged_name_conflict", relative_path)
            state["originals"][relative_path] = _encode_original(None)

    active = {requested_environment}
    existing = set(state["active_environments"])
    if existing and existing != active:
        raise InstallError("environment_conflict", STATE_RELATIVE)
    config_original = _decode_original(state["originals"][CONFIG_RELATIVE], CONFIG_RELATIVE)
    hooks_original = _decode_original(state["originals"][HOOKS_RELATIVE], HOOKS_RELATIVE)
    desired: dict[str, bytes | None] = {
        CONFIG_RELATIVE: _render_config(inputs, config_original, active),
        HOOKS_RELATIVE: _render_hooks(inputs, hooks_original, active),
        SKILL_RELATIVE: _render_skill(inputs, active),
    }
    for environment in active:
        desired.update(_private_payloads(inputs, environment))
    for relative_path in sorted(owned_legacy):
        desired[relative_path] = None

    state["active_environments"] = sorted(active)
    state["digests"] = {
        relative_path: _sha256(payload)
        for relative_path, payload in sorted(desired.items())
        if payload is not None
    }
    desired[STATE_RELATIVE] = canonical_json(state)
    return desired, state


def _desired_uninstall(
    inputs: CanonicalInputs, state: dict[str, Any], environment: str
) -> dict[str, bytes | None]:
    active = set(state["active_environments"])
    if environment not in active:
        raise InstallError("environment_not_installed", STATE_RELATIVE)
    remaining = active - {environment}
    originals = state["originals"]
    desired: dict[str, bytes | None] = {}
    private_prefix = f"{MANAGED_ROOT}/{environment}/"
    for relative_path in state["digests"]:
        if relative_path.startswith(private_prefix):
            if relative_path in LEGACY_PRIVATE_HOOKS:
                desired[relative_path] = None  # Retire dead payloads; never resurrect them.
            else:
                desired[relative_path] = _decode_original(originals[relative_path], relative_path)

    if not remaining:
        for relative_path in (CONFIG_RELATIVE, HOOKS_RELATIVE, SKILL_RELATIVE):
            desired[relative_path] = _decode_original(originals[relative_path], relative_path)
        desired[STATE_RELATIVE] = None
        return desired

    config_original = _decode_original(originals[CONFIG_RELATIVE], CONFIG_RELATIVE)
    hooks_original = _decode_original(originals[HOOKS_RELATIVE], HOOKS_RELATIVE)
    shared = {
        CONFIG_RELATIVE: _render_config(inputs, config_original, remaining),
        HOOKS_RELATIVE: _render_hooks(inputs, hooks_original, remaining),
        SKILL_RELATIVE: _render_skill(inputs, remaining),
    }
    desired.update(shared)
    state["active_environments"] = sorted(remaining)
    state["digests"] = {
        relative_path: digest
        for relative_path, digest in state["digests"].items()
        if not relative_path.startswith(private_prefix)
    }
    state["digests"].update(
        {relative_path: _sha256(payload) for relative_path, payload in shared.items()}
    )
    desired[STATE_RELATIVE] = canonical_json(state)
    return desired


def _write_temporary(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".kcoderag-install-", dir=path.parent)
    temporary = Path(name)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    return temporary


def _restore_path(path: Path, original: bytes | None) -> None:
    if original is None:
        path.unlink(missing_ok=True)
        return
    temporary = _write_temporary(path, original)
    os.replace(temporary, path)


def _apply_transaction(target: Path, desired: dict[str, bytes | None]) -> None:
    paths = {relative: _assert_managed_path(target, relative) for relative in desired}
    originals = {relative: _read_optional(path) for relative, path in paths.items()}
    temporary_files: dict[str, Path] = {}
    try:
        for relative_path, payload in desired.items():
            if payload is not None:
                temporary_files[relative_path] = _write_temporary(paths[relative_path], payload)
        for relative_path in sorted(desired, key=lambda item: item == STATE_RELATIVE):
            payload = desired[relative_path]
            path = paths[relative_path]
            if payload is None:
                path.unlink(missing_ok=True)
            else:
                os.replace(temporary_files.pop(relative_path), path)
    except Exception as exc:
        for temporary in temporary_files.values():
            temporary.unlink(missing_ok=True)
        rollback_failed = False
        for relative_path, original in originals.items():
            try:
                _restore_path(paths[relative_path], original)
            except Exception:
                rollback_failed = True
        code = "rollback_failed" if rollback_failed else "transaction_failed"
        raise InstallError(code) from exc


def _prune_empty_directories(target: Path) -> None:
    candidates = [
        target / ".codex" / "kcoderag-nav" / "qa" / "hooks",
        target / ".codex" / "kcoderag-nav" / "qa",
        target / ".codex" / "kcoderag-nav" / "dev" / "hooks",
        target / ".codex" / "kcoderag-nav" / "dev",
        target / ".codex" / "kcoderag-nav",
        target / ".agents" / "skills" / "kcoderag-nav",
        target / ".agents" / "skills",
        target / ".agents",
        target / ".codex",
    ]
    for path in candidates:
        try:
            path.rmdir()
        except OSError:
            pass


def install(target: Path, source_root: Path, environments: set[str]) -> None:
    # Always recompute desired state: rendering upgrades must refresh installed bytes.
    target = _safe_target(target)
    inputs = load_inputs(source_root)
    state = _load_state(target)
    desired, _ = _desired_install(target, inputs, state, environments)
    _apply_transaction(target, desired)


def uninstall(target: Path, source_root: Path, environment: str) -> None:
    target = _safe_target(target)
    inputs = load_inputs(source_root)
    state = _load_state(target)
    if state is None:
        raise InstallError("not_installed", STATE_RELATIVE)
    _verify_digests(target, state)
    desired = _desired_uninstall(inputs, state, environment)
    _apply_transaction(target, desired)
    _prune_empty_directories(target)


def _status_issue(code: str, path: str = "") -> StatusIssue:
    normalized = path.replace("\\", "/") if path else "."
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:/", normalized):
        normalized = "."
    if any(part == ".." for part in normalized.split("/")):
        normalized = "."
    return {"code": code, "path": normalized}


def _status_result(
    status: str,
    active_environments: list[str] | None = None,
    issues: list[StatusIssue] | None = None,
) -> StatusResult:
    return {
        "schema_version": 1,
        "status": status,
        "active_environments": active_environments or [],
        "issues": sorted(issues or [], key=lambda issue: (issue["path"], issue["code"])),
    }


def inspect_status(target: Path, source_root: Path) -> StatusResult:
    """Inspect managed installation health without changing the target tree."""
    try:
        target = _safe_target(target)
        inputs = load_inputs(source_root)
        state = _load_state(target)
    except (InstallError, GenerationError) as exc:
        return _status_result("invalid", issues=[_status_issue(exc.code, exc.path)])

    if state is None:
        try:
            managed_root = _assert_managed_path(target, MANAGED_ROOT)
        except InstallError as exc:
            return _status_result("invalid", issues=[_status_issue(exc.code, exc.path)])
        if managed_root.exists():
            return _status_result(
                "invalid",
                issues=[_status_issue("orphaned_managed_root", MANAGED_ROOT)],
            )
        return _status_result("not_installed")

    active = [item for item in ("qa", "dev") if item in state["active_environments"]]
    if len(active) != 1:
        return _status_result(
            "invalid",
            active,
            [_status_issue("environment_conflict", STATE_RELATIVE)],
        )
    required_owned = {CONFIG_RELATIVE, HOOKS_RELATIVE, SKILL_RELATIVE}
    required_owned.update(
        f"{MANAGED_ROOT}/{environment}/hooks/{filename}"
        for environment in active
        for filename in HOOK_PAYLOAD_FILENAMES
    )
    if not required_owned.issubset(state["originals"]) or not required_owned.issubset(
        state["digests"]
    ):
        return _status_result(
            "invalid",
            active,
            [_status_issue("ownership_incomplete", STATE_RELATIVE)],
        )

    try:
        for relative_path, original in state["originals"].items():
            _decode_original(original, relative_path)
        for digest in state["digests"].values():
            if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
                raise InstallError("invalid_state", STATE_RELATIVE)
    except InstallError as exc:
        return _status_result("invalid", active, [_status_issue(exc.code, exc.path)])

    drift: list[StatusIssue] = []
    try:
        for relative_path, expected in state["digests"].items():
            current = _read_optional(_assert_managed_path(target, relative_path))
            code = "managed_file_missing" if current is None else "managed_content_changed"
            if current is None or _sha256(current) != expected:
                drift.append(_status_issue(code, relative_path))
    except InstallError as exc:
        return _status_result("invalid", active, [_status_issue(exc.code, exc.path)])
    if drift:
        return _status_result("drifted", active, drift)

    try:
        desired, _ = _desired_install(target, inputs, copy.deepcopy(state), set(active))
        updates: list[StatusIssue] = []
        for relative_path, desired_payload in desired.items():
            if relative_path == STATE_RELATIVE:
                continue
            current = _read_optional(_assert_managed_path(target, relative_path))
            if current != desired_payload:
                updates.append(_status_issue("source_update_available", relative_path))
    except (InstallError, GenerationError) as exc:
        return _status_result("invalid", active, [_status_issue(exc.code, exc.path)])
    if updates:
        return _status_result("update_available", active, updates)
    return _status_result("healthy", active)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, help=argparse.SUPPRESS)
    commands = parser.add_subparsers(dest="command", required=True)
    install_parser = commands.add_parser("install")
    install_parser.add_argument("--target", type=Path, required=True)
    install_parser.add_argument("--environment", choices=INSTALL_ENVIRONMENT_CHOICES, default="qa")
    uninstall_parser = commands.add_parser("uninstall")
    uninstall_parser.add_argument("--target", type=Path, required=True)
    uninstall_parser.add_argument("--environment", choices=UNINSTALL_ENVIRONMENT_CHOICES, required=True)
    status_parser = commands.add_parser("status")
    status_parser.add_argument("--target", type=Path, required=True)
    status_parser.add_argument("--json", action="store_true", dest="json_output")
    return parser.parse_args(argv)


def _has_supported_hook_runtime() -> bool:
    candidates = (("py", "-3"), ("python3",), ("python",)) if os.name == "nt" else (
        ("python3",),
        ("python",),
    )
    probe = "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
    for executable, *arguments in candidates:
        resolved = shutil.which(executable)
        if resolved is None:
            continue
        try:
            result = subprocess.run(
                [resolved, *arguments, "-c", probe],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0:
            return True
    return False


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    source_root = (args.source_root or Path(__file__).resolve().parents[1]).resolve()
    if args.command == "status":
        result = inspect_status(args.target, source_root)
        if args.json_output:
            print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        else:
            print(f"status: {result['status']}")
            environments = result["active_environments"]
            if environments:
                print(f"active environments: {','.join(environments)}")
            for issue in result["issues"]:
                print(f"issue: {issue['code']} {issue['path']}")
        if result["status"] == "healthy":
            return 0
        return 2 if result["status"] == "invalid" else 1
    try:
        target = _safe_target(args.target)
        if args.command == "install":
            runtime_available = _has_supported_hook_runtime()
            install(target, source_root, {args.environment})
            print(f"installed: {args.environment}")
            if not runtime_available:
                print(
                    "warning: hook_runtime_unavailable (python_3_10_required)",
                    file=sys.stderr,
                )
        else:
            uninstall(target, source_root, args.environment)
            print(f"uninstalled: {args.environment}")
        return 0
    except (InstallError, GenerationError) as exc:
        code = exc.code
        path = exc.path
        suffix = f": {path}" if path else ""
        print(f"operation refused ({code}){suffix}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"operation failed ({type(exc).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
