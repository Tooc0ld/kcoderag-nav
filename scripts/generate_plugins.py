#!/usr/bin/env python3
"""Deterministically render the QA, Dev, and Cursor plugin distribution trees.

The generator deliberately reports only relative paths. Canonical MCP inputs contain
internal connection details and must never be copied into diagnostics.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
PLACEHOLDER_RE = re.compile(r"\{\{[a-z_]+\}\}")
CACHEBUSTER_HEX_LENGTH = 16
CURSOR_PACKAGE = "kcoderag-cursor"
CURSOR_PLUGIN_NAME = "kcoderag-nav"
SHARED_FILES = {
    "hooks/hooks.json": "plugin-src/hooks/hooks.json",
    "hooks/run_hook.cmd": "plugin-src/hooks/run_hook.cmd",
    "hooks/run_hook.sh": "plugin-src/hooks/run_hook.sh",
    "hooks/test_grep_nudge.py": "plugin-src/hooks/test_grep_nudge.py",
    "hooks/update_check.py": "plugin-src/hooks/update_check.py",
}


class GenerationError(RuntimeError):
    """A safe-to-report generation failure."""

    def __init__(self, code: str, path: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.path = path


@dataclass(frozen=True)
class CanonicalInputs:
    root: Path
    version: str
    environments: tuple[dict[str, str], ...]


def canonical_json(value: object) -> bytes:
    """Encode generated JSON with stable key order, UTF-8, and LF."""
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise GenerationError("invalid_json", path.name) from exc


def load_inputs(root: Path) -> CanonicalInputs:
    """Load and cross-check canonical metadata without exposing field values."""
    source = root / "plugin-src"
    try:
        version = (source / "version.txt").read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as exc:
        raise GenerationError("invalid_version", "plugin-src/version.txt") from exc
    if not VERSION_RE.fullmatch(version):
        raise GenerationError("invalid_version", "plugin-src/version.txt")

    metadata = _load_json(source / "environments.json")
    raw_environments = metadata.get("environments") if isinstance(metadata, dict) else None
    if not isinstance(raw_environments, list) or not raw_environments:
        raise GenerationError("invalid_metadata", "plugin-src/environments.json")

    required = {
        "id",
        "plugin_name",
        "server_name",
        "mcp_source",
        "permission_namespace",
        "agent_tool_prefix",
        "display_name",
        "short_description",
        "long_description",
        "manifest_description",
        "claude_description",
        "marketplace_description",
        "brand_color",
    }
    environments: list[dict[str, str]] = []
    for item in raw_environments:
        if not isinstance(item, dict) or set(item) != required:
            raise GenerationError("invalid_metadata", "plugin-src/environments.json")
        if not all(isinstance(item[key], str) and item[key] for key in required):
            raise GenerationError("invalid_metadata", "plugin-src/environments.json")
        environment = dict(item)
        environment_id = environment["id"]
        expected_name = f"kcoderag-{environment_id}"
        expected_prefix = f"mcp__plugin_{expected_name}_{expected_name}__"
        if (
            environment["plugin_name"] != expected_name
            or environment["server_name"] != expected_name
            or environment["agent_tool_prefix"] != expected_prefix
            or environment["permission_namespace"] != expected_prefix + "*"
        ):
            raise GenerationError("environment_mismatch", "plugin-src/environments.json")
        mcp_path = root / environment["mcp_source"]
        mcp = _load_json(mcp_path)
        servers = mcp.get("mcpServers") if isinstance(mcp, dict) else None
        if not isinstance(servers, dict) or list(servers) != [expected_name]:
            raise GenerationError("environment_mismatch", environment["mcp_source"])
        environments.append(environment)

    if [item["id"] for item in environments] != ["qa", "dev"]:
        raise GenerationError("environment_order", "plugin-src/environments.json")
    return CanonicalInputs(root=root, version=version, environments=tuple(environments))


def load_routing(root: Path) -> dict[str, Any]:
    """Load and validate the single executable routing decision table."""
    path = root / "plugin-src" / "routing.json"
    routing = _load_json(path)
    rules = routing.get("rules") if isinstance(routing, dict) else None
    if (
        not isinstance(routing, dict)
        or set(routing) != {"version", "mutually_exclusive", "rules"}
        or routing.get("version") != 2
        or routing.get("mutually_exclusive") != ["qa", "dev"]
        or not isinstance(rules, list)
        or not rules
    ):
        raise GenerationError("invalid_routing", "plugin-src/routing.json")
    seen: set[tuple[tuple[str, ...], str]] = set()
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {"installed", "intent", "routes"}:
            raise GenerationError("invalid_routing", "plugin-src/routing.json")
        installed = rule["installed"]
        routes = rule["routes"]
        intent = rule["intent"]
        if (
            not isinstance(installed, list)
            or len(installed) != 1
            or installed[0] not in {"qa", "dev"}
            or not isinstance(routes, list)
            or routes != installed
            or not isinstance(intent, str)
            or intent != "default"
        ):
            raise GenerationError("invalid_routing", "plugin-src/routing.json")
        key = (tuple(installed), intent)
        if key in seen:
            raise GenerationError("duplicate_routing", "plugin-src/routing.json")
        seen.add(key)
    if seen != {(("qa",), "default"), (("dev",), "default")}:
        raise GenerationError("incomplete_routing", "plugin-src/routing.json")
    return routing


def resolve_route(
    routing: dict[str, Any],
    installed: set[str],
    intent: str,
    *,
    reachable: set[str] | None = None,
) -> dict[str, Any]:
    """Resolve an environment route without fallback after selection."""
    installed_key = [environment for environment in ("qa", "dev") if environment in installed]
    for rule in routing.get("rules", []):
        if rule.get("installed") == installed_key and rule.get("intent") == intent:
            routes = list(rule["routes"])
            if reachable is not None:
                unavailable = [environment for environment in routes if environment not in reachable]
                if unavailable:
                    return {
                        "routes": [],
                        "error": {"code": "unreachable", "environments": unavailable},
                    }
            return {"routes": routes, "error": None}
    return {
        "routes": [],
        "error": {"code": "unsupported_route", "environments": installed_key},
    }


def render_routing_markdown(routing: dict[str, Any]) -> str:
    """Render the mutually exclusive environment policy into user guidance."""
    lines = [
        "## Environment selection",
        "",
        "QA and Dev plugins are mutually exclusive. Install exactly one environment at a time.",
        "",
        "| Installed plugin | Query environment |",
        "|---|---|",
    ]
    labels = {"qa": "QA", "dev": "Dev"}
    for rule in routing["rules"]:
        installed = labels[rule["installed"][0]]
        route = labels[rule["routes"][0]]
        lines.append(f"| {installed} | {route} |")
    lines.extend(
        [
            "",
            "If the installed KCodeRag environment is unreachable, report it instead of querying",
            "the other environment. Local search remains an explicit fallback when the index is",
            "unavailable or stale.",
        ]
    )
    return "\n".join(lines)


def _read_normalized(path: Path) -> bytes:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise GenerationError("invalid_text", path.name) from exc
    return (text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n") + "\n").encode(
        "utf-8"
    )


def _render_template(path: Path, replacements: dict[str, str]) -> bytes:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise GenerationError("invalid_template", path.name) from exc
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    for name, value in replacements.items():
        text = text.replace("{{" + name + "}}", value)
    if PLACEHOLDER_RE.search(text):
        raise GenerationError("unresolved_placeholder", path.name)
    return (text.rstrip("\n") + "\n").encode("utf-8")


def _codex_mcp_document(root: Path, environment: dict[str, str]) -> dict[str, object]:
    """Build the Codex-shaped MCP document (``mcp_servers`` wrapper, codex field names).

    Claude Code requires the ``mcpServers`` wrapper in ``.mcp.json`` while Codex only
    accepts a direct server map or an ``mcp_servers`` wrapper, so each host gets its own
    file and each manifest points at its own one.
    """
    mcp = _load_json(root / environment["mcp_source"])
    entry = mcp["mcpServers"][environment["server_name"]]
    url = entry.get("url")
    headers = entry.get("http_headers", entry.get("headers"))
    if (
        not isinstance(url, str)
        or not isinstance(headers, dict)
        or not all(isinstance(key, str) and isinstance(value, str) for key, value in headers.items())
    ):
        raise GenerationError("environment_mismatch", environment["mcp_source"])
    return {
        "mcp_servers": {
            environment["server_name"]: {"url": url, "http_headers": dict(sorted(headers.items()))}
        }
    }


def _codex_manifest(environment: dict[str, str], version: str) -> dict[str, object]:
    return {
        "name": environment["plugin_name"],
        "version": version,
        "description": environment["manifest_description"],
        "author": {"name": "KCodeRag"},
        "keywords": ["code-navigation", "knowledge-graph", "mcp"],
        "skills": "./skills/",
        "mcpServers": "./.codex.mcp.json",
        "interface": {
            "displayName": environment["display_name"],
            "shortDescription": environment["short_description"],
            "longDescription": environment["long_description"],
            "developerName": "KCodeRag",
            "category": "Developer Tools",
            "capabilities": ["Read"],
            "defaultPrompt": ["Find a symbol and explain its callers and callees"],
            "brandColor": environment["brand_color"],
        },
    }


def _cursor_connection_defaults(inputs: CanonicalInputs) -> tuple[str, str | None]:
    """Return safe Cursor defaults; allow the bearer value to be admin-supplied."""
    qa = next((item for item in inputs.environments if item["id"] == "qa"), None)
    if qa is None:
        raise GenerationError("environment_mismatch", "plugin-src/environments.json")
    mcp = _load_json(inputs.root / qa["mcp_source"])
    entry = mcp["mcpServers"][qa["server_name"]]
    if not isinstance(entry, dict):
        raise GenerationError("environment_mismatch", qa["mcp_source"])
    url = entry.get("url")
    headers = entry.get("http_headers", entry.get("headers"))
    authorization = headers.get("Authorization") if isinstance(headers, dict) else None
    if not isinstance(url, str) or not url:
        raise GenerationError("environment_mismatch", qa["mcp_source"])
    if authorization is None:
        return url, None
    if (
        not isinstance(authorization, str)
        or not authorization.startswith("Bearer ")
        or not authorization.removeprefix("Bearer ").strip()
    ):
        raise GenerationError("environment_mismatch", qa["mcp_source"])
    return url, authorization.removeprefix("Bearer ").strip()


def _cursor_routing_policy() -> str:
    return "\n".join(
        [
            "## Environment selection",
            "",
            "This Cursor plugin exposes exactly one configured KCodeRag environment.",
            "The bundled defaults select QA. To test Dev, replace the MCP URL and bearer",
            "token together in Cursor's plugin configuration; never configure both environments.",
            "",
            "If the configured environment is unreachable, report it instead of querying another",
            "KCodeRag environment. Local search remains an explicit fallback when the index is",
            "unavailable or stale.",
        ]
    )


def _cursor_manifest(inputs: CanonicalInputs, version: str) -> dict[str, object]:
    url, bearer_token = _cursor_connection_defaults(inputs)
    bearer_variable = {
        "type": "string",
        "title": "KCodeRag bearer token",
        "description": "Internal QA by default; replace together with the MCP URL for Dev.",
    }
    if bearer_token is not None:
        bearer_variable["default"] = bearer_token
    return {
        "name": CURSOR_PLUGIN_NAME,
        "version": version,
        "description": "Graph-first structural code navigation with one configured KCodeRag environment.",
        "author": {"name": "KCodeRag"},
        "keywords": ["code-navigation", "knowledge-graph", "mcp"],
        "skills": "./skills/",
        "rules": "./rules/",
        "mcpServers": "./mcp.json",
        "variables": {
            "type": "object",
            "properties": {
                "KCODERAG_MCP_URL": {
                    "type": "string",
                    "title": "KCodeRag MCP URL",
                    "description": (
                        "Internal QA by default; replace together with the bearer token for Dev."
                    ),
                    "default": url,
                },
                "KCODERAG_BEARER_TOKEN": bearer_variable,
            },
            "required": ["KCODERAG_MCP_URL", "KCODERAG_BEARER_TOKEN"],
        },
    }


def _cursor_package_outputs(inputs: CanonicalInputs, version: str) -> dict[str, bytes]:
    """Render the single-environment Cursor package."""
    source = inputs.root / "plugin-src"
    replacements = {
        "display_name": "configured KCodeRag",
        "routing_policy": _cursor_routing_policy(),
        "plugin_version": version,
    }
    return dict(
        sorted(
            {
                ".cursor-plugin/plugin.json": canonical_json(
                    _cursor_manifest(inputs, version)
                ),
                "mcp.json": canonical_json(
                    {
                        "mcpServers": {
                            "kcoderag": {
                                "url": "${KCODERAG_MCP_URL}",
                                "headers": {
                                    "Authorization": "Bearer ${KCODERAG_BEARER_TOKEN}"
                                },
                            }
                        }
                    }
                ),
                "skills/code-lookup-discipline/SKILL.md": _render_template(
                    source / "skills" / "code-lookup-discipline" / "SKILL.md",
                    replacements,
                ),
                "rules/kcoderag-navigation.mdc": _read_normalized(
                    source / "cursor" / "rules" / "kcoderag-navigation.mdc"
                ),
                "README.md": _render_template(
                    source / "cursor" / "README.md.tmpl", replacements
                ),
            }.items()
        )
    )


def _package_outputs(
    inputs: CanonicalInputs,
    environment: dict[str, str],
    version: str,
    shared: dict[str, bytes],
    routing_policy: str,
) -> dict[str, bytes]:
    """Render one self-contained package with an explicit non-recursive version."""
    root = inputs.root
    source = root / "plugin-src"
    env_id = environment["id"]
    package = environment["plugin_name"]
    replacements = {
        "environment": env_id,
        "environment_upper": env_id.upper(),
        "plugin_name": package,
        "display_name": environment["display_name"],
        "tool_prefix": environment["agent_tool_prefix"],
        "routing_policy": routing_policy,
        "plugin_version": version,
    }
    outputs: dict[str, bytes] = {
        ".claude-plugin/plugin.json": canonical_json(
            {
                "name": package,
                "description": environment["claude_description"],
                "version": version,
                "author": {"name": "KCodeRag"},
            }
        ),
        ".codex-plugin/plugin.json": canonical_json(_codex_manifest(environment, version)),
        ".codex.mcp.json": canonical_json(_codex_mcp_document(root, environment)),
    }
    try:
        outputs[".mcp.json"] = (root / environment["mcp_source"]).read_bytes()
    except OSError as exc:
        raise GenerationError("missing_input", environment["mcp_source"]) from exc
    outputs.update(shared)
    outputs["hooks/grep_nudge.py"] = _render_template(
        source / "hooks" / "grep_nudge.py", replacements
    )
    outputs["skills/code-lookup-discipline/SKILL.md"] = _render_template(
        source / "skills" / "code-lookup-discipline" / "SKILL.md", replacements
    )
    outputs["agents/kcode-explorer.md"] = _render_template(
        source / "agents" / "kcode-explorer.md.tmpl", replacements
    )
    outputs["README.md"] = _render_template(source / "README.md.tmpl", replacements)
    return dict(sorted(outputs.items()))


def _content_identity(package: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for relative_path, payload in sorted(package.items()):
        encoded_path = relative_path.encode("utf-8")
        digest.update(len(encoded_path).to_bytes(8, "big"))
        digest.update(encoded_path)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()[:CACHEBUSTER_HEX_LENGTH]


def _render_context(inputs: CanonicalInputs) -> tuple[dict[str, bytes], str]:
    shared = {
        destination: _read_normalized(inputs.root / origin)
        for destination, origin in SHARED_FILES.items()
    }
    routing_policy = render_routing_markdown(load_routing(inputs.root))
    return shared, routing_policy


def _effective_version(
    inputs: CanonicalInputs,
    environment: dict[str, str],
    shared: dict[str, bytes],
    routing_policy: str,
) -> str:
    provisional = _package_outputs(
        inputs, environment, inputs.version, shared, routing_policy
    )
    return f"{inputs.version}+codex.{_content_identity(provisional)}"


def effective_version(inputs: CanonicalInputs, environment: str) -> str:
    """Return a deterministic version derived from one environment's package bytes."""
    metadata = next((item for item in inputs.environments if item["id"] == environment), None)
    if metadata is None:
        raise GenerationError("unknown_environment", "plugin-src/environments.json")
    shared, routing_policy = _render_context(inputs)
    return _effective_version(inputs, metadata, shared, routing_policy)


def cursor_effective_version(inputs: CanonicalInputs) -> str:
    """Return a deterministic version derived from the Cursor package bytes."""
    provisional = _cursor_package_outputs(inputs, inputs.version)
    return f"{inputs.version}+cursor.{_content_identity(provisional)}"


def render_outputs(inputs: CanonicalInputs) -> dict[str, bytes]:
    """Return every generated path and byte payload without touching disk."""
    outputs: dict[str, bytes] = {}
    marketplace_plugins: list[dict[str, str]] = []
    shared, routing_policy = _render_context(inputs)
    versions: dict[str, str] = {}

    for environment in inputs.environments:
        env_id = environment["id"]
        package = environment["plugin_name"]
        version = _effective_version(inputs, environment, shared, routing_policy)
        versions[env_id] = version
        for relative_path, payload in _package_outputs(
            inputs, environment, version, shared, routing_policy
        ).items():
            outputs[f"{package}/{relative_path}"] = payload
        marketplace_plugins.append(
            {
                "name": package,
                "source": f"./{package}",
                "description": environment["marketplace_description"],
            }
        )

    cursor_version = cursor_effective_version(inputs)
    for relative_path, payload in _cursor_package_outputs(inputs, cursor_version).items():
        outputs[f"{CURSOR_PACKAGE}/{relative_path}"] = payload

    outputs["kcoderag-update.json"] = canonical_json(
        {
            "schema_version": 1,
            "repository": "Tooc0ld/kcoderag-nav",
            "channel": "master",
            "versions": versions,
        }
    )

    outputs[".claude-plugin/marketplace.json"] = canonical_json(
        {"owner": {"name": "Tooc0ld"}, "name": "kcoderag-nav", "plugins": marketplace_plugins}
    )
    outputs[".agents/plugins/marketplace.json"] = canonical_json(
        {
            "name": "kcoderag-nav",
            "interface": {"displayName": "KCodeRag Nav"},
            "plugins": [
                {
                    "name": item["name"],
                    "source": item["source"],
                    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                    "category": "Developer Tools",
                }
                for item in marketplace_plugins
            ],
        }
    )
    outputs[".cursor-plugin/marketplace.json"] = canonical_json(
        {
            "name": CURSOR_PLUGIN_NAME,
            "owner": {"name": "Tooc0ld"},
            "metadata": {
                "description": "Private KCodeRag navigation plugins for internal teams."
            },
            "plugins": [
                {
                    "name": CURSOR_PLUGIN_NAME,
                    "source": CURSOR_PACKAGE,
                    "description": (
                        "Graph-first navigation through one configured internal KCodeRag environment."
                    ),
                    "version": cursor_version,
                    "category": "Developer Tools",
                    "keywords": ["code-navigation", "knowledge-graph", "mcp"],
                }
            ],
        }
    )
    return dict(sorted(outputs.items()))


def _is_ignored_output(path: Path) -> bool:
    return "__pycache__" in path.parts or path.suffix in {".pyc", ".pyo"}


def compare_outputs(root: Path, outputs: dict[str, bytes]) -> list[str]:
    """Return path-only drift diagnostics."""
    issues: list[str] = []
    expected_paths = set(outputs)
    for relative_path, expected in outputs.items():
        path = root / relative_path
        if not path.is_file():
            issues.append(f"missing: {relative_path}")
            continue
        try:
            current = path.read_bytes()
        except OSError:
            issues.append(f"unreadable: {relative_path}")
            continue
        if current != expected:
            issues.append(f"drift: {relative_path}")

    for package in ("kcoderag-qa", "kcoderag-dev", CURSOR_PACKAGE):
        package_root = root / package
        if not package_root.is_dir():
            continue
        for path in package_root.rglob("*"):
            if not path.is_file() or _is_ignored_output(path):
                continue
            relative_path = path.relative_to(root).as_posix()
            if relative_path not in expected_paths:
                issues.append(f"extra: {relative_path}")
    return sorted(set(issues))


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".kcoderag-generate-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        finally:
            raise


def write_outputs(root: Path, outputs: dict[str, bytes]) -> None:
    for relative_path, payload in outputs.items():
        _atomic_write(root / relative_path, payload)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="render tracked distribution files")
    mode.add_argument("--check", action="store_true", help="check tracked outputs without writing")
    parser.add_argument("--root", type=Path, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    root = (args.root or Path(__file__).resolve().parents[1]).resolve()
    try:
        inputs = load_inputs(root)
        outputs = render_outputs(inputs)
        if args.check:
            issues = compare_outputs(root, outputs)
            for issue in issues:
                print(issue)
            return 1 if issues else 0
        write_outputs(root, outputs)
        print(f"generated {len(outputs)} files")
        return 0
    except GenerationError as exc:
        suffix = f": {exc.path}" if exc.path else ""
        print(f"generation failed ({exc.code}){suffix}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"generation failed ({type(exc).__name__})", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
