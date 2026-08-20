"""Routing policy and generated hook integration tests."""

from __future__ import annotations

import json
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

from scripts import generate_plugins, manage_project_install as installer


ROOT = Path(__file__).resolve().parents[1]
ROUTING_PATH = ROOT / "plugin-src" / "routing.json"
HOOKS = [
    ROOT / "kcoderag-qa" / "hooks" / "grep_nudge.py",
    ROOT / "kcoderag-dev" / "hooks" / "grep_nudge.py",
]


def run_hook(script: Path, payload: dict[str, object]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
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
        unsupported = installer.resolve_route(routing, {"qa", "dev"}, "default")
        self.assertEqual(unsupported["routes"], [])
        self.assertEqual(unsupported["error"]["code"], "unsupported_route")

    def test_generated_guidance_comes_from_routing_table(self) -> None:
        routing = generate_plugins.load_routing(ROOT)
        policy = generate_plugins.render_routing_markdown(routing)
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
            self.assertNotIn("QA and Dev", module.NUDGE)
            self.assertIn("index is unavailable or stale", module.NUDGE)


class HookCommandParsingTests(unittest.TestCase):
    def assert_command_patterns(self, command: str, expected: list[str]) -> None:
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name, command=command):
                module = load_hook(script, "compound_command")
                self.assertEqual(module.shell_lookup_patterns(command), expected)

    def test_pipeline_preserves_single_file_scope(self) -> None:
        command = "rg KPlayer one.cpp | head -1"
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name):
                module = load_hook(script, "pipeline_scope")
                self.assertEqual(module.shell_lookup_patterns(command), [])
                self.assertIsNone(module.hook_output({"tool_input": {"command": command}}))

    def test_pipeline_keeps_repository_scope_structural(self) -> None:
        command = "rg KPlayer src | head -1"
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name):
                module = load_hook(script, "pipeline_repository")
                self.assertEqual(module.shell_lookup_patterns(command), ["KPlayer"])
                self.assertIsNotNone(module.hook_output({"tool_input": {"command": command}}))

    def test_compound_separators_preserve_single_file_scope(self) -> None:
        for command in (
            "rg KPlayer one.cpp && echo done",
            "rg KPlayer one.cpp; echo done",
            "rg KPlayer one.cpp\necho done",
            "rg KPlayer one.cpp\r\necho done",
        ):
            self.assert_command_patterns(command, [])

    def test_later_repository_search_segment_is_still_detected(self) -> None:
        self.assert_command_patterns("echo ready && rg KPlayer src", ["KPlayer"])
        self.assert_command_patterns("rg TODO src; rg KPlayer src", ["TODO", "KPlayer"])

    def test_quoted_and_escaped_control_characters_remain_in_patterns(self) -> None:
        cases = {
            "rg 'KPlayer|GetLevel' src": ["KPlayer|GetLevel"],
            r"rg KPlayer\|GetLevel src": [r"KPlayer\|GetLevel"],
            'rg "KPlayer;GetLevel" src': ["KPlayer;GetLevel"],
            "rg KPlayer^|GetLevel src": ["KPlayer^|GetLevel"],
            "rg KPlayer`|GetLevel src": ["KPlayer`|GetLevel"],
        }
        for command, expected in cases.items():
            self.assert_command_patterns(command, expected)

    def test_shell_wrappers_reuse_compound_command_scope(self) -> None:
        self.assert_command_patterns('pwsh -Command "rg KPlayer one.cpp | head -1"', [])
        self.assert_command_patterns('cmd /c "rg KPlayer src | more"', ["KPlayer"])

    def test_malformed_or_excessive_segmentation_fails_open(self) -> None:
        self.assert_command_patterns("rg 'KPlayer src | head -1", [])
        excessive = ";".join(["rg KPlayer src"] * 65)
        self.assert_command_patterns(excessive, [])


class HookExecutionTests(unittest.TestCase):
    def test_each_single_environment_hook_emits_context(self) -> None:
        payload: dict[str, object] = {
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": "rg KPlayer::GetLevel src"},
        }
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name):
                result = run_hook(script, payload)
                self.assertEqual(result.returncode, 0)
                parsed = json.loads(result.stdout)
                self.assertIn("additionalContext", parsed["hookSpecificOutput"])

    def test_oversized_input_and_mechanical_search_fail_open(self) -> None:
        for script in HOOKS:
            with self.subTest(environment=script.parent.parent.name):
                oversized = subprocess.run(
                    [sys.executable, str(script)],
                    input="{" + "x" * 131_073,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=5,
                )
                self.assertEqual((oversized.returncode, oversized.stdout), (0, ""))
                mechanical = run_hook(
                    script,
                    {
                        "hook_event_name": "PreToolUse",
                        "tool_name": "Bash",
                        "tool_input": {"command": "rg TODO logs"},
                    },
                )
                self.assertEqual((mechanical.returncode, mechanical.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
