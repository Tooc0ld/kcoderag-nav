#!/usr/bin/env python3
"""Deterministically render the QA and Dev plugin distribution trees.

The generator deliberately reports only relative paths. Canonical MCP inputs contain
internal connection details and must never be copied into diagnostics.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[+.-][A-Za-z0-9.-]+)?$")
PLACEHOLDER_RE = re.compile(r"\{\{[a-z_]+\}\}")
SHARED_FILES = {
    "hooks/hooks.json": "plugin-src/hooks/hooks.json",
    "hooks/test_grep_nudge.py": "plugin-src/hooks/test_grep_nudge.py",
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
        if environment["plugin_name"] != expected_name or environment["server_name"] != expected_name:
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
    if routing.get("version") != 1 or not isinstance(rules, list) or not rules:
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
            or not installed
            or installed != [item for item in ("qa", "dev") if item in set(installed)]
            or not set(installed).issubset({"qa", "dev"})
            or not isinstance(routes, list)
            or not routes
            or not set(routes).issubset(set(installed))
            or not isinstance(intent, str)
            or intent not in {"default", "qa", "dev", "compare"}
        ):
            raise GenerationError("invalid_routing", "plugin-src/routing.json")
        key = (tuple(installed), intent)
        if key in seen:
            raise GenerationError("duplicate_routing", "plugin-src/routing.json")
        seen.add(key)
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
    """Render the executable route table into host-neutral user guidance."""
    lines = [
        "## Environment routing",
        "",
        "| Installed environments | User intent | Query environments |",
        "|---|---|---|",
    ]
    labels = {"qa": "QA", "dev": "Dev"}
    intents = {
        "default": "No environment specified",
        "qa": "Explicit QA",
        "dev": "Explicit Dev",
        "compare": "Explicit environment comparison",
    }
    for rule in routing["rules"]:
        installed = " + ".join(labels[item] for item in rule["installed"])
        routes = " + ".join(labels[item] for item in rule["routes"])
        lines.append(f"| {installed} | {intents[rule['intent']]} | {routes} |")
    lines.extend(
        [
            "",
            "Choose the route before issuing a graph query. If any selected environment is",
            "unreachable, report that environment explicitly and do not query another environment",
            "as a fallback.",
        ]
    )
    return "\n".join(lines)


def render_routing_nudge(routing: dict[str, Any]) -> str:
    """Render a compact hook hint after proving the required decision rows exist."""
    expected = [
        ({"qa", "dev"}, "default", ["qa"]),
        ({"qa", "dev"}, "dev", ["dev"]),
        ({"qa", "dev"}, "compare", ["qa", "dev"]),
    ]
    for installed, intent, routes in expected:
        result = resolve_route(routing, installed, intent)
        if result != {"routes": routes, "error": None}:
            raise GenerationError("incomplete_routing", "plugin-src/routing.json")
    return (
        " When QA and Dev are both installed, default to QA; use only Dev for explicit "
        "Dev intent; query both only for explicit comparison; never fall back when a selected "
        "environment is unreachable."
    )


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


def _codex_manifest(environment: dict[str, str], version: str) -> dict[str, object]:
    return {
        "name": environment["plugin_name"],
        "version": version,
        "description": environment["manifest_description"],
        "author": {"name": "KCodeRag"},
        "keywords": ["code-navigation", "knowledge-graph", "mcp"],
        "skills": "./skills/",
        "mcpServers": "./.mcp.json",
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


def render_outputs(inputs: CanonicalInputs) -> dict[str, bytes]:
    """Return every generated path and byte payload without touching disk."""
    root = inputs.root
    source = root / "plugin-src"
    outputs: dict[str, bytes] = {}
    marketplace_plugins: list[dict[str, str]] = []
    shared = {destination: _read_normalized(root / origin) for destination, origin in SHARED_FILES.items()}
    routing = load_routing(root)
    routing_policy = render_routing_markdown(routing)
    routing_nudge = render_routing_nudge(routing)

    for environment in inputs.environments:
        env_id = environment["id"]
        package = environment["plugin_name"]
        prefix = f"{package}/"
        replacements = {
            "environment": env_id,
            "environment_upper": env_id.upper(),
            "plugin_name": package,
            "display_name": environment["display_name"],
            "tool_prefix": environment["agent_tool_prefix"],
            "routing_policy": routing_policy,
            "routing_nudge": routing_nudge,
        }
        outputs[prefix + ".claude-plugin/plugin.json"] = canonical_json(
            {
                "name": package,
                "description": environment["claude_description"],
                "version": inputs.version.split("+", 1)[0],
                "author": {"name": "KCodeRag"},
            }
        )
        outputs[prefix + ".codex-plugin/plugin.json"] = canonical_json(
            _codex_manifest(environment, inputs.version)
        )
        try:
            outputs[prefix + ".mcp.json"] = (root / environment["mcp_source"]).read_bytes()
        except OSError as exc:
            raise GenerationError("missing_input", environment["mcp_source"]) from exc
        outputs[prefix + "settings.json"] = canonical_json(
            {"permissions": {"allow": [environment["permission_namespace"]]}}
        )
        for relative_path, payload in shared.items():
            outputs[prefix + relative_path] = payload
        outputs[prefix + "hooks/grep_nudge.py"] = _render_template(
            source / "hooks" / "grep_nudge.py", replacements
        )
        outputs[prefix + "skills/code-lookup-discipline/SKILL.md"] = _render_template(
            source / "skills" / "code-lookup-discipline" / "SKILL.md", replacements
        )
        outputs[prefix + "agents/kcode-explorer.md"] = _render_template(
            source / "agents" / "kcode-explorer.md.tmpl", replacements
        )
        outputs[prefix + "README.md"] = _render_template(source / "README.md.tmpl", replacements)
        marketplace_plugins.append(
            {
                "name": package,
                "source": f"./{package}",
                "description": environment["marketplace_description"],
            }
        )

    outputs[".claude-plugin/marketplace.json"] = canonical_json(
        {"owner": {"name": "Tooc0ld"}, "name": "kcoderag-nav", "plugins": marketplace_plugins}
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

    for package in ("kcoderag-qa", "kcoderag-dev"):
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
