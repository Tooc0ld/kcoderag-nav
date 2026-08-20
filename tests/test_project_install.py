"""Project-scoped installer lifecycle tests."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import manage_project_install as installer


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "manage_project_install.py"


def snapshot_tree(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def run_installer(
    target: Path,
    *arguments: str,
    process_environment: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(INSTALLER), *arguments, "--target", str(target)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=process_environment,
    )


class ProjectInstallTests(unittest.TestCase):
    def test_status_distinguishes_fresh_target_from_healthy_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            before = snapshot_tree(target)
            self.assertEqual(
                installer.inspect_status(target, ROOT),
                {
                    "schema_version": 1,
                    "status": "not_installed",
                    "active_environments": [],
                    "issues": [],
                },
            )
            self.assertEqual(snapshot_tree(target), before)

            self.assertEqual(
                run_installer(target, "install", "--environment", "both").returncode,
                0,
            )
            installed = snapshot_tree(target)
            self.assertEqual(
                installer.inspect_status(target, ROOT),
                {
                    "schema_version": 1,
                    "status": "healthy",
                    "active_environments": ["qa", "dev"],
                    "issues": [],
                },
            )
            self.assertEqual(snapshot_tree(target), installed)

    def test_unowned_legacy_payloads_refuse_install_without_deletion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            legacy_hook = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "hooks.json"
            legacy_hook.parent.mkdir(parents=True)
            legacy_hook.write_bytes(b'{"manual": true}\n')
            before = snapshot_tree(target)

            install = run_installer(target, "install")

            self.assertNotEqual(install.returncode, 0)
            self.assertIn("unmanaged_name_conflict", install.stderr)
            self.assertEqual(snapshot_tree(target), before)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            self.assertEqual(run_installer(target, "install").returncode, 0)
            legacy_hook = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "hooks.json"
            legacy_hook.write_bytes(b'{"manual": true}\n')
            before_repeat = snapshot_tree(target)

            repeat = run_installer(target, "install")

            self.assertNotEqual(repeat.returncode, 0)
            self.assertIn("unmanaged_name_conflict", repeat.stderr)
            self.assertEqual(snapshot_tree(target), before_repeat)

    def test_install_renders_hook_scripts_without_placeholders(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            install = run_installer(target, "install", "--environment", "both")
            self.assertEqual(install.returncode, 0, "both install failed")
            for environment in ("qa", "dev"):
                hooks_directory = target / ".codex" / "kcoderag-nav" / environment / "hooks"
                script = hooks_directory / "grep_nudge.py"
                text = script.read_text(encoding="utf-8")
                self.assertNotIn("{{", text, f"{environment} hook still has unresolved placeholders")
                self.assertIn("default to QA", text, f"{environment} hook lost the routing guidance")
                self.assertFalse(
                    (hooks_directory / "hooks.json").exists(),
                    f"{environment} must not ship the unconsumed inner hooks.json payload",
                )
                for launcher in ("run_hook.sh", "run_hook.cmd"):
                    self.assertEqual(
                        (hooks_directory / launcher).read_bytes(),
                        (ROOT / "plugin-src" / "hooks" / launcher).read_bytes(),
                    )

            registrations = json.loads(
                (target / ".codex" / "hooks.json").read_text(encoding="utf-8")
            )["hooks"]["PreToolUse"]
            self.assertEqual(len(registrations), 2)
            for environment, registration in zip(("dev", "qa"), registrations, strict=True):
                handler = registration["hooks"][0]
                self.assertIn(
                    f".codex/kcoderag-nav/{environment}/hooks/run_hook.sh",
                    handler["command"],
                )
                self.assertNotIn("grep_nudge.py", handler["command"])
                self.assertIn(
                    f".codex\\kcoderag-nav\\{environment}\\hooks\\run_hook.cmd",
                    handler["commandWindows"],
                )
                self.assertNotIn("grep_nudge.py", handler["commandWindows"])

            environment = os.environ.copy()
            environment["KCODERAG_NAV_DEDUP_DIR"] = str(target / "dedup")
            codex_payload = {
                "hook_event_name": "PreToolUse",
                "session_id": "synthetic-session",
                "turn_id": "synthetic-turn",
                "tool_use_id": "synthetic-tool-use",
                "tool_name": "Bash",
                "tool_input": {"command": "rg KPlayer::GetLevel src"},
            }
            installed_script = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "grep_nudge.py"
            result = subprocess.run(
                [sys.executable, str(installed_script)],
                input=json.dumps(codex_payload),
                capture_output=True,
                text=True,
                check=False,
                env=environment,
                timeout=5,
            )
            self.assertEqual(result.returncode, 0)
            output = json.loads(result.stdout)
            self.assertIn("additionalContext", output["hookSpecificOutput"])
            self.assertNotIn("{{", output["hookSpecificOutput"]["additionalContext"])

    def test_legacy_payloads_are_retired_without_resurrection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            before = snapshot_tree(target)

            legacy_files = {
                ".codex/config.toml": b"[mcp_servers.legacy]\nurl = \"synthetic\"\n",
                ".codex/hooks.json": b'{"hooks": {"PreToolUse": []}}\n',
                ".agents/skills/kcoderag-nav/SKILL.md": b"legacy-skill\n",
                ".codex/kcoderag-nav/qa/hooks/grep_nudge.py": b'ROUTING_GUIDANCE = "{{routing_nudge}}"\n',
                ".codex/kcoderag-nav/qa/hooks/hooks.json": b'{"legacy": true}\n',
            }
            for relative_path, payload in legacy_files.items():
                path = target.joinpath(*relative_path.split("/"))
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)
            state = {
                "version": 1,
                "active_environments": ["qa"],
                "originals": {
                    relative_path: {"existed": False, "base64": ""}
                    for relative_path in legacy_files
                },
                "digests": {
                    relative_path: hashlib.sha256(payload).hexdigest()
                    for relative_path, payload in legacy_files.items()
                },
            }
            state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
            state_path.write_text(json.dumps(state), encoding="utf-8")

            upgrade = run_installer(target, "install", "--environment", "qa")
            self.assertEqual(upgrade.returncode, 0, "legacy upgrade refused")
            legacy_hook = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "hooks.json"
            self.assertFalse(legacy_hook.exists(), "legacy inner hooks.json must be retired")
            script_text = (
                target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "grep_nudge.py"
            ).read_text(encoding="utf-8")
            self.assertNotIn("{{", script_text)
            upgraded_state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertFalse(
                any(path.endswith("hooks/hooks.json") for path in upgraded_state["digests"]),
                "retired payload must leave the digest set",
            )

            uninstall = run_installer(target, "uninstall", "--environment", "qa")
            self.assertEqual(uninstall.returncode, 0, "post-upgrade uninstall failed")
            self.assertFalse(legacy_hook.exists(), "legacy payload must not be resurrected")
            self.assertEqual(snapshot_tree(target), before)

    def test_default_qa_round_trip_preserves_project_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            (target / ".codex").mkdir()
            (target / ".codex" / "config.toml").write_bytes(
                b"# existing project settings\n[features]\nexample = true\n"
            )
            (target / "sentinel.bin").write_bytes(b"unrelated-project-bytes\x00")
            before = snapshot_tree(target)

            install = subprocess.run(
                [sys.executable, str(INSTALLER), "install", "--target", str(target)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(install.returncode, 0, "default QA install failed")
            config = (target / ".codex" / "config.toml").read_text(encoding="utf-8")
            self.assertIn("kcoderag-qa", config)
            self.assertNotIn("kcoderag-dev", config)
            self.assertTrue((target / ".codex" / "kcoderag-nav" / "qa" / "hooks").is_dir())
            self.assertTrue((target / ".agents" / "skills" / "kcoderag-nav" / "SKILL.md").is_file())

            uninstall = subprocess.run(
                [
                    sys.executable,
                    str(INSTALLER),
                    "uninstall",
                    "--target",
                    str(target),
                    "--environment",
                    "qa",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(uninstall.returncode, 0, "QA uninstall failed")
            self.assertEqual(snapshot_tree(target), before)

    def test_explicit_dev_and_both_installs_are_idempotent(self) -> None:
        for environment, expected in (("dev", {"dev"}), ("both", {"qa", "dev"})):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                install = run_installer(target, "install", "--environment", environment)
                self.assertEqual(install.returncode, 0, f"{environment} install failed")
                state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
                state = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(set(state["active_environments"]), expected)
                for active in expected:
                    self.assertTrue(
                        (target / ".codex" / "kcoderag-nav" / active / "hooks" / "grep_nudge.py").is_file()
                    )
                before_repeat = snapshot_tree(target)
                repeat = run_installer(target, "install", "--environment", environment)
                self.assertEqual(repeat.returncode, 0, f"{environment} repeat install failed")
                self.assertEqual(snapshot_tree(target), before_repeat)

    def test_dual_install_supports_independent_uninstall(self) -> None:
        for removed, remaining in (("qa", "dev"), ("dev", "qa")):
            with self.subTest(removed=removed), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                before = snapshot_tree(target)
                self.assertEqual(
                    run_installer(target, "install", "--environment", "both").returncode,
                    0,
                )

                uninstall = run_installer(target, "uninstall", "--environment", removed)
                self.assertEqual(uninstall.returncode, 0, f"uninstall {removed} failed")
                state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
                state = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(state["active_environments"], [remaining])
                config = (target / ".codex" / "config.toml").read_text(encoding="utf-8")
                self.assertIn(f"kcoderag-{remaining}", config)
                self.assertNotIn(f"kcoderag-{removed}", config)
                skill = (target / ".agents" / "skills" / "kcoderag-nav" / "SKILL.md").read_text(
                    encoding="utf-8"
                )
                self.assertIn(remaining.upper() if remaining == "qa" else "Dev", skill)
                self.assertFalse((target / ".codex" / "kcoderag-nav" / removed).exists())

                final = run_installer(target, "uninstall", "--environment", remaining)
                self.assertEqual(final.returncode, 0, f"uninstall {remaining} failed")
                self.assertEqual(snapshot_tree(target), before)

    def test_install_permutations_preserve_project_and_user_boundaries(self) -> None:
        scenarios = [
            ([], ["qa"]),
            (["dev"], ["dev"]),
            (["both"], ["qa", "dev"]),
            (["qa", "dev"], ["qa", "dev"]),
            (["dev", "qa"], ["dev", "qa"]),
        ]
        for install_sequence, active in scenarios:
            with self.subTest(sequence=install_sequence), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                target = base / "target"
                target.mkdir()
                (target / ".codex").mkdir()
                (target / ".codex" / "config.toml").write_bytes(
                    b"# unrelated config bytes\n[features]\nexample = true\n"
                )
                unrelated_hook = {
                    "hooks": {
                        "PreToolUse": [
                            {
                                "matcher": "Read",
                                "hooks": [{"type": "command", "command": "python unrelated.py"}],
                            }
                        ]
                    },
                    "unrelated": {"preserve": True},
                }
                (target / ".codex" / "hooks.json").write_text(
                    json.dumps(unrelated_hook, indent=4) + "\n", encoding="utf-8"
                )
                unrelated_skill = target / ".agents" / "skills" / "unrelated" / "SKILL.md"
                unrelated_skill.parent.mkdir(parents=True)
                unrelated_skill.write_bytes(b"unrelated-skill-bytes\n")
                (target / "ordinary.bin").write_bytes(b"ordinary-project-bytes\x00")
                before_target = snapshot_tree(target)

                fake_codex_home = base / "fake-user-codex"
                (fake_codex_home / "cache").mkdir(parents=True)
                (fake_codex_home / "config.toml").write_bytes(b"user-config-sentinel\n")
                (fake_codex_home / "cache" / "sentinel.bin").write_bytes(b"user-cache-sentinel\x00")
                before_user = snapshot_tree(fake_codex_home)
                environment = os.environ.copy()
                environment["CODEX_HOME"] = str(fake_codex_home)

                sequence = install_sequence or [None]
                for selected in sequence:
                    arguments = ["install"]
                    if selected is not None:
                        arguments.extend(["--environment", selected])
                    result = run_installer(
                        target,
                        *arguments,
                        process_environment=environment,
                    )
                    self.assertEqual(result.returncode, 0, "project install permutation failed")
                self.assertEqual(snapshot_tree(fake_codex_home), before_user)
                self.assertEqual((target / "ordinary.bin").read_bytes(), b"ordinary-project-bytes\x00")
                installed_hooks = json.loads(
                    (target / ".codex" / "hooks.json").read_text(encoding="utf-8")
                )
                self.assertIn(unrelated_hook["hooks"]["PreToolUse"][0], installed_hooks["hooks"]["PreToolUse"])
                self.assertEqual(installed_hooks["unrelated"], unrelated_hook["unrelated"])

                for selected in reversed(active):
                    result = run_installer(
                        target,
                        "uninstall",
                        "--environment",
                        selected,
                        process_environment=environment,
                    )
                    self.assertEqual(result.returncode, 0, "project uninstall permutation failed")
                self.assertEqual(snapshot_tree(target), before_target)
                self.assertEqual(snapshot_tree(fake_codex_home), before_user)

    def test_conflicts_and_symlink_escape_fail_before_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "conflict"
            (target / ".codex").mkdir(parents=True)
            (target / ".codex" / "config.toml").write_bytes(
                b'[mcp_servers."kcoderag-qa"]\nurl = "synthetic"\n'
            )
            before = snapshot_tree(target)
            conflict = run_installer(target, "install")
            self.assertNotEqual(conflict.returncode, 0)
            self.assertEqual(snapshot_tree(target), before)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            self.assertEqual(run_installer(target, "install").returncode, 0)
            managed = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "grep_nudge.py"
            managed.write_bytes(managed.read_bytes() + b"# synthetic user edit\n")
            before_refusal = snapshot_tree(target)
            refused = run_installer(target, "uninstall", "--environment", "qa")
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(snapshot_tree(target), before_refusal)

        with tempfile.TemporaryDirectory() as target_directory, tempfile.TemporaryDirectory() as outside_directory:
            target = Path(target_directory)
            outside = Path(outside_directory)
            (outside / "sentinel.bin").write_bytes(b"outside-sentinel\x00")
            link = target / ".codex"
            try:
                os.symlink(outside, link, target_is_directory=True)
            except OSError:
                junction = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(link), str(outside)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(junction.returncode, 0, "could not create test junction")
            before_outside = snapshot_tree(outside)
            try:
                escaped = run_installer(target, "install")
                self.assertNotEqual(escaped.returncode, 0)
                self.assertEqual(snapshot_tree(outside), before_outside)
            finally:
                if link.exists() or link.is_symlink():
                    os.rmdir(link)


if __name__ == "__main__":
    unittest.main()
