"""Routing policy and generated hook integration tests."""

from __future__ import annotations

import json
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True

from scripts import generate_plugins, manage_project_install as installer


ROOT = Path(__file__).resolve().parents[1]
ROUTING_PATH = ROOT / "plugin-src" / "routing.json"
HOOKS = [
    ROOT / "kcoderag-qa" / "hooks" / "grep_nudge.py",
    ROOT / "kcoderag-dev" / "hooks" / "grep_nudge.py",
]


def run_hook(script: Path, payload: dict[str, object], dedup_directory: Path) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["KCODERAG_NAV_DEDUP_DIR"] = str(dedup_directory)
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
        env=environment,
        timeout=5,
    )


def load_hook(script: Path, prefix: str) -> object:
    """Load one generated hook package for behavior-level assertions."""
    spec = importlib.util.spec_from_file_location(f"{prefix}_{script.parent.parent.name}", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RoutingTests(unittest.TestCase):
    def test_routing_rules_and_unreachable_behavior(self) -> None:
        routing = json.loads(ROUTING_PATH.read_text(encoding="utf-8"))
        for rule in routing["rules"]:
            with self.subTest(installed=rule["installed"], intent=rule["intent"]):
                result = installer.resolve_route(routing, set(rule["installed"]), rule["intent"])
                self.assertEqual(result, {"routes": rule["routes"], "error": None})
                for unavailable in rule["routes"]:
                    reachable = set(rule["installed"]) - {unavailable}
                    failed = installer.resolve_route(
                        routing,
                        set(rule["installed"]),
                        rule["intent"],
                        reachable=reachable,
                    )
                    self.assertEqual(failed["routes"], [])
                    self.assertEqual(failed["error"]["code"], "unreachable")
                    self.assertIn(unavailable, failed["error"]["environments"])

    def test_generated_guidance_comes_from_routing_table(self) -> None:
        routing = generate_plugins.load_routing(ROOT)
        policy = generate_plugins.render_routing_markdown(routing)
        nudge = generate_plugins.render_routing_nudge(routing)
        for environment in ("qa", "dev"):
            package = ROOT / f"kcoderag-{environment}"
            for relative_path in (
                "skills/code-lookup-discipline/SKILL.md",
                "agents/kcode-explorer.md",
                "README.md",
            ):
                self.assertIn(policy, (package / relative_path).read_text(encoding="utf-8"))
            script = package / "hooks" / "grep_nudge.py"
            spec = importlib.util.spec_from_file_location(f"routing_{environment}", script)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.assertIn(nudge, module.NUDGE)


class HookCommandParsingTests(unittest.TestCase):
    def test_pipeline_preserves_single_file_scope(self) -> None:
        command = "rg KPlayer one.cpp | head -1"
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name):
                module = load_hook(script, "pipeline_scope")
                self.assertEqual(module.shell_lookup_patterns(command), [])
                self.assertIsNone(module.hook_output({"tool_input": {"command": command}}))


class HookDedupTests(unittest.TestCase):
    def test_concurrent_generated_hooks_emit_one_context_per_tool_call(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dedup_directory = Path(directory) / "dedup"
            payload: dict[str, object] = {
                "hook_event_name": "PreToolUse",
                "session_id": "synthetic-session",
                "turn_id": "synthetic-turn",
                "tool_use_id": "synthetic-tool-use-1",
                "tool_name": "Bash",
                "tool_input": {"command": "rg SyntheticSecretSymbol src"},
            }
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(
                    pool.map(
                        lambda script: run_hook(script, payload, dedup_directory),
                        HOOKS,
                    )
                )
            self.assertEqual([result.returncode for result in results], [0, 0])
            outputs = [result.stdout for result in results if result.stdout]
            self.assertEqual(len(outputs), 1)
            parsed = json.loads(outputs[0])
            self.assertIn("additionalContext", parsed["hookSpecificOutput"])

            payload["tool_use_id"] = "synthetic-tool-use-2"
            later = [run_hook(script, payload, dedup_directory) for script in HOOKS]
            self.assertEqual(sum(bool(result.stdout) for result in later), 1)

            markers = list(dedup_directory.glob("*.marker"))
            self.assertEqual(len(markers), 2)
            for marker in markers:
                self.assertRegex(marker.name, r"^[0-9a-f]{64}\.marker$")
                self.assertEqual(marker.read_bytes(), b"")
                self.assertNotIn("SyntheticSecretSymbol", marker.name)

    def test_dedup_and_identity_failures_are_silent(self) -> None:
        payload: dict[str, object] = {
            "hook_event_name": "PreToolUse",
            "session_id": "synthetic-session",
            "turn_id": "synthetic-turn",
            "tool_use_id": {"malformed": True},
            "tool_name": "Bash",
            "tool_input": {"command": "rg SyntheticSecretSymbol src"},
        }
        with tempfile.TemporaryDirectory() as directory:
            blocked_directory = Path(directory) / "not-a-directory"
            blocked_directory.write_bytes(b"sentinel")
            for script in HOOKS:
                malformed = run_hook(script, payload, Path(directory) / "dedup")
                self.assertEqual((malformed.returncode, malformed.stdout), (0, ""))

                valid_payload = dict(payload, tool_use_id="synthetic-tool-use")
                blocked = run_hook(script, valid_payload, blocked_directory)
                self.assertEqual((blocked.returncode, blocked.stdout), (0, ""))

                environment = os.environ.copy()
                environment["KCODERAG_NAV_DEDUP_DIR"] = str(Path(directory) / "oversized")
                oversized = subprocess.run(
                    [sys.executable, str(script)],
                    input="{" + "x" * 131_073,
                    capture_output=True,
                    text=True,
                    check=False,
                    env=environment,
                    timeout=5,
                )
                self.assertEqual((oversized.returncode, oversized.stdout), (0, ""))

                spec = importlib.util.spec_from_file_location(f"dedup_{script.parent.parent.name}", script)
                self.assertIsNotNone(spec)
                self.assertIsNotNone(spec.loader)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                claim_payload = dict(valid_payload)
                with mock.patch.object(module.os, "scandir", side_effect=OSError("synthetic")):
                    self.assertFalse(module._claim_nudge(claim_payload))
                with mock.patch.object(module.os, "open", side_effect=OSError("synthetic")):
                    self.assertFalse(module._claim_nudge(claim_payload))

    def test_repeated_dedup_and_dual_host_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dedup_directory = Path(directory) / "dedup"
            for index in range(5):
                payload: dict[str, object] = {
                    "hook_event_name": "PreToolUse",
                    "session_id": "synthetic-session",
                    "turn_id": f"synthetic-turn-{index}",
                    "tool_use_id": f"synthetic-tool-{index}",
                    "tool_name": "Bash",
                    "tool_input": {"command": "rg KPlayer::GetLevel src"},
                }
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(
                        pool.map(lambda script: run_hook(script, payload, dedup_directory), HOOKS)
                    )
                self.assertEqual(sum(bool(result.stdout) for result in results), 1)

            fallback_payload: dict[str, object] = {
                "hook_event_name": "PreToolUse",
                "session_id": "synthetic-session",
                "turn_id": "synthetic-fallback-turn",
                "tool_name": "Grep",
                "tool_input": {"pattern": "KPlayer::GetLevel"},
            }
            with ThreadPoolExecutor(max_workers=2) as pool:
                fallback = list(
                    pool.map(
                        lambda script: run_hook(script, fallback_payload, dedup_directory),
                        HOOKS,
                    )
                )
            self.assertEqual(sum(bool(result.stdout) for result in fallback), 1)

            stale = dedup_directory / ("0" * 64 + ".marker")
            stale.write_bytes(b"")
            old = time.time() - 1_000
            os.utime(stale, (old, old))
            cleanup_payload = dict(fallback_payload, turn_id="synthetic-cleanup-turn")
            cleanup = run_hook(HOOKS[0], cleanup_payload, dedup_directory)
            self.assertEqual(cleanup.returncode, 0)
            self.assertFalse(stale.exists())

            for script in HOOKS:
                claude = run_hook(
                    script,
                    dict(fallback_payload, turn_id=f"claude-{script.parent.parent.name}"),
                    dedup_directory,
                )
                codex = run_hook(
                    script,
                    {
                        "hook_event_name": "PreToolUse",
                        "session_id": "synthetic-session",
                        "turn_id": f"codex-{script.parent.parent.name}",
                        "tool_name": "Bash",
                        "tool_input": {"command": "rg KPlayer::GetLevel src"},
                    },
                    dedup_directory,
                )
                mechanical = run_hook(
                    script,
                    {
                        "hook_event_name": "PreToolUse",
                        "session_id": "synthetic-session",
                        "turn_id": f"mechanical-{script.parent.parent.name}",
                        "tool_name": "Bash",
                        "tool_input": {"command": "rg TODO logs"},
                    },
                    dedup_directory,
                )
                self.assertTrue(claude.stdout)
                self.assertTrue(codex.stdout)
                self.assertEqual(mechanical.stdout, "")


if __name__ == "__main__":
    unittest.main()
