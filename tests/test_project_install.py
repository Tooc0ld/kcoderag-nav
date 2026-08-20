"""Project-scoped installer lifecycle tests."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
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


def copy_canonical_source(destination: Path) -> Path:
    source = destination / "source"
    shutil.copytree(ROOT / "plugin-src", source / "plugin-src")
    metadata = json.loads(
        (ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8")
    )
    for environment in metadata["environments"]:
        relative = Path(environment["mcp_source"])
        target = source / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    return source


class ProjectInstallTests(unittest.TestCase):
    def test_update_project_keeps_active_qa_and_applies_current_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "target"
            target.mkdir()
            (target / "ordinary.bin").write_bytes(b"unrelated-project-bytes\x00")
            self.assertEqual(run_installer(target, "install").returncode, 0)
            synthetic_source = copy_canonical_source(base)
            source_launcher = synthetic_source / "plugin-src" / "hooks" / "run_hook.sh"
            source_launcher.write_bytes(source_launcher.read_bytes() + b"# source-update\n")

            result = installer.update_project(target, synthetic_source)

            self.assertEqual(result, "updated: qa")
            self.assertEqual(
                installer.inspect_status(target, synthetic_source),
                {
                    "schema_version": 1,
                    "status": "healthy",
                    "active_environments": ["qa"],
                    "issues": [],
                },
            )
            self.assertEqual((target / "ordinary.bin").read_bytes(), b"unrelated-project-bytes\x00")
            self.assertFalse((target / ".codex" / "kcoderag-nav" / "dev").exists())
            updated_tree = snapshot_tree(target)
            self.assertEqual(installer.update_project(target, synthetic_source), "already current: qa")
            self.assertEqual(snapshot_tree(target), updated_tree)

    def test_update_project_refuses_missing_drifted_and_environment_argument_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            before = snapshot_tree(target)
            with self.assertRaisesRegex(installer.InstallError, "not_installed"):
                installer.update_project(target, ROOT)
            self.assertEqual(snapshot_tree(target), before)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            self.assertEqual(run_installer(target, "install").returncode, 0)
            hook = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "grep_nudge.py"
            hook.write_bytes(hook.read_bytes() + b"# user-drift\n")
            before = snapshot_tree(target)
            result = run_installer(target, "update")
            self.assertEqual(result.returncode, 2)
            self.assertIn("managed_content_changed", result.stderr)
            self.assertNotIn("digest", result.stderr.lower())
            self.assertEqual(snapshot_tree(target), before)

            argument_result = run_installer(target, "update", "--environment", "dev")
            self.assertNotEqual(argument_result.returncode, 0)
            self.assertEqual(snapshot_tree(target), before)

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
                run_installer(target, "install").returncode,
                0,
            )
            installed = snapshot_tree(target)
            self.assertEqual(
                installer.inspect_status(target, ROOT),
                {
                    "schema_version": 1,
                    "status": "healthy",
                    "active_environments": ["qa"],
                    "issues": [],
                },
            )
            self.assertEqual(snapshot_tree(target), installed)

    def test_status_separates_managed_drift_from_source_update(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "target"
            target.mkdir()
            self.assertEqual(run_installer(target, "install").returncode, 0)
            launcher = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "run_hook.sh"
            launcher.write_bytes(b"synthetic-local-change\n")
            drifted_tree = snapshot_tree(target)

            drifted = installer.inspect_status(target, ROOT)

            self.assertEqual(drifted["status"], "drifted")
            self.assertEqual(
                drifted["issues"],
                [
                    {
                        "code": "managed_content_changed",
                        "path": ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
                    }
                ],
            )
            self.assertEqual(snapshot_tree(target), drifted_tree)
            serialized = json.dumps(drifted)
            self.assertNotIn("synthetic-local-change", serialized)
            self.assertNotIn("digest", serialized.lower())

            launcher.unlink()
            missing_tree = snapshot_tree(target)
            missing = installer.inspect_status(target, ROOT)
            self.assertEqual(missing["status"], "drifted")
            self.assertEqual(
                missing["issues"],
                [
                    {
                        "code": "managed_file_missing",
                        "path": ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
                    }
                ],
            )
            self.assertEqual(snapshot_tree(target), missing_tree)

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "target"
            target.mkdir()
            self.assertEqual(run_installer(target, "install").returncode, 0)
            installed_tree = snapshot_tree(target)
            synthetic_source = copy_canonical_source(base)
            source_launcher = synthetic_source / "plugin-src" / "hooks" / "run_hook.sh"
            source_launcher.write_bytes(source_launcher.read_bytes() + b"# synthetic-update\n")

            available = installer.inspect_status(target, synthetic_source)

            self.assertEqual(available["status"], "update_available")
            self.assertEqual(
                available["issues"],
                [
                    {
                        "code": "source_update_available",
                        "path": ".codex/kcoderag-nav/qa/hooks/grep_nudge.py",
                    },
                    {
                        "code": "source_update_available",
                        "path": ".codex/kcoderag-nav/qa/hooks/run_hook.sh",
                    }
                ],
            )
            self.assertEqual(snapshot_tree(target), installed_tree)

    def test_status_reports_invalid_state_and_orphaned_managed_root_without_writes(self) -> None:
        cases = ("invalid_state", "orphan")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                managed_root = target / ".codex" / "kcoderag-nav"
                managed_root.mkdir(parents=True)
                if case == "invalid_state":
                    (managed_root / "install-state.json").write_text("not-json", encoding="utf-8")
                    expected_code = "invalid_state"
                    expected_path = ".codex/kcoderag-nav/install-state.json"
                else:
                    (managed_root / "orphan.txt").write_bytes(b"synthetic")
                    expected_code = "orphaned_managed_root"
                    expected_path = ".codex/kcoderag-nav"
                before = snapshot_tree(target)

                result = installer.inspect_status(target, ROOT)

                self.assertEqual(result["status"], "invalid")
                self.assertEqual(
                    result["issues"],
                    [{"code": expected_code, "path": expected_path}],
                )
                self.assertEqual(snapshot_tree(target), before)

    def test_status_rejects_incomplete_launcher_ownership_without_writes(self) -> None:
        for collection in ("originals", "digests"):
            for launcher in ("run_hook.sh", "run_hook.cmd"):
                with (
                    self.subTest(collection=collection, launcher=launcher),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    target = Path(directory)
                    self.assertEqual(run_installer(target, "install").returncode, 0)
                    state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                    managed_launcher = f".codex/kcoderag-nav/qa/hooks/{launcher}"
                    state[collection].pop(managed_launcher)
                    state_path.write_text(json.dumps(state), encoding="utf-8")
                    before = snapshot_tree(target)

                    result = installer.inspect_status(target, ROOT)

                    self.assertEqual(result["status"], "invalid")
                    self.assertEqual(
                        result["issues"],
                        [
                            {
                                "code": "ownership_incomplete",
                                "path": ".codex/kcoderag-nav/install-state.json",
                            }
                        ],
                    )
                    self.assertEqual(snapshot_tree(target), before)

    def test_cli_install_warns_when_no_supported_hook_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "cli"
            target.mkdir()
            environment = os.environ.copy()
            environment["PATH"] = ""

            result = run_installer(
                target,
                "install",
                process_environment=environment,
            )

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "installed: qa\n")
            self.assertEqual(
                result.stderr,
                "warning: hook_runtime_unavailable (python_3_10_required)\n",
            )

            programmatic_target = Path(directory) / "programmatic"
            programmatic_target.mkdir()
            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                installer.install(programmatic_target, ROOT, {"qa"})
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "")

    def test_programmatic_install_accepts_canonical_target_alias(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            canonical_target = root / "project"
            alias_parent = root / "alias"
            canonical_target.mkdir()
            alias_parent.mkdir()
            aliased_target = alias_parent / ".." / canonical_target.name

            installer.install(aliased_target, ROOT, {"qa"})

            self.assertTrue(
                (canonical_target / ".codex" / "kcoderag-nav" / "install-state.json").is_file()
            )
            self.assertEqual(installer.inspect_status(canonical_target, ROOT)["status"], "healthy")

    def test_status_cli_uses_stable_safe_schema_and_exit_codes(self) -> None:
        expected_keys = {
            "schema_version",
            "status",
            "active_environments",
            "issues",
        }
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            fresh_json = run_installer(target, "status", "--json")
            fresh_human = run_installer(target, "status")
            self.assertEqual(fresh_json.returncode, 1)
            self.assertEqual(fresh_human.returncode, 1)
            parsed = json.loads(fresh_json.stdout)
            self.assertEqual(set(parsed), expected_keys)
            self.assertEqual(parsed["status"], "not_installed")
            self.assertIn("not_installed", fresh_human.stdout)

            self.assertEqual(run_installer(target, "install").returncode, 0)
            healthy_json = run_installer(target, "status", "--json")
            self.assertEqual(healthy_json.returncode, 0)
            self.assertEqual(json.loads(healthy_json.stdout)["status"], "healthy")

            managed = target / ".codex" / "kcoderag-nav" / "qa" / "hooks" / "grep_nudge.py"
            managed.write_bytes(b"synthetic-secret-material-must-not-appear\n")
            drifted = run_installer(target, "status", "--json")
            self.assertEqual(drifted.returncode, 1)
            self.assertEqual(json.loads(drifted.stdout)["status"], "drifted")
            self.assertNotIn("synthetic-secret-material", drifted.stdout)

        with tempfile.TemporaryDirectory() as directory:
            invalid_target = Path(directory) / "not-a-directory"
            invalid_target.write_bytes(b"synthetic")
            invalid = run_installer(invalid_target, "status", "--json")
            self.assertEqual(invalid.returncode, 2)
            self.assertEqual(json.loads(invalid.stdout)["status"], "invalid")

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
        for environment in ("qa", "dev"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                install = run_installer(target, "install", "--environment", environment)
                self.assertEqual(install.returncode, 0, f"{environment} install failed")
                hooks_directory = target / ".codex" / "kcoderag-nav" / environment / "hooks"
                script = hooks_directory / "grep_nudge.py"
                text = script.read_text(encoding="utf-8")
                self.assertNotIn("{{", text, f"{environment} hook still has unresolved placeholders")
                self.assertNotIn("QA and Dev", text)
                self.assertIn("index is unavailable or stale", text)
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
                self.assertEqual(len(registrations), 1)
                registration = registrations[0]
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

                codex_payload = {
                    "hook_event_name": "PreToolUse",
                    "tool_name": "Bash",
                    "tool_input": {"command": "rg KPlayer::GetLevel src"},
                }
                result = subprocess.run(
                    [sys.executable, str(script)],
                    input=json.dumps(codex_payload),
                    capture_output=True,
                    text=True,
                    check=False,
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

    def test_single_environment_installs_are_idempotent(self) -> None:
        for environment in ("qa", "dev"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                install = run_installer(target, "install", "--environment", environment)
                self.assertEqual(install.returncode, 0, f"{environment} install failed")
                state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
                state = json.loads(state_path.read_text(encoding="utf-8"))
                self.assertEqual(state["active_environments"], [environment])
                self.assertTrue(
                    (
                        target
                        / ".codex"
                        / "kcoderag-nav"
                        / environment
                        / "hooks"
                        / "grep_nudge.py"
                    ).is_file()
                )
                before_repeat = snapshot_tree(target)
                repeat = run_installer(target, "install", "--environment", environment)
                self.assertEqual(repeat.returncode, 0, f"{environment} repeat install failed")
                self.assertEqual(snapshot_tree(target), before_repeat)

    def test_cross_environment_and_both_installs_are_refused_without_writes(self) -> None:
        for installed, requested in (("qa", "dev"), ("dev", "qa")):
            with self.subTest(installed=installed), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                self.assertEqual(
                    run_installer(target, "install", "--environment", installed).returncode,
                    0,
                )
                before_conflict = snapshot_tree(target)

                conflict = run_installer(target, "install", "--environment", requested)

                self.assertEqual(conflict.returncode, 2)
                self.assertIn("environment_conflict", conflict.stderr)
                self.assertEqual(snapshot_tree(target), before_conflict)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            before = snapshot_tree(target)
            both = run_installer(target, "install", "--environment", "both")
            self.assertEqual(both.returncode, 2)
            self.assertEqual(snapshot_tree(target), before)

            with self.assertRaisesRegex(installer.InstallError, "unsupported_environment_set"):
                installer.install(target, ROOT, {"qa", "dev"})
            self.assertEqual(snapshot_tree(target), before)

    def test_environment_switch_requires_uninstall_first(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            before = snapshot_tree(target)
            self.assertEqual(run_installer(target, "install").returncode, 0)
            self.assertEqual(
                run_installer(target, "uninstall", "--environment", "qa").returncode,
                0,
            )
            self.assertEqual(snapshot_tree(target), before)

            self.assertEqual(
                run_installer(target, "install", "--environment", "dev").returncode,
                0,
            )
            state_path = target / ".codex" / "kcoderag-nav" / "install-state.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["active_environments"], ["dev"])
            self.assertEqual(
                run_installer(target, "uninstall", "--environment", "dev").returncode,
                0,
            )
            self.assertEqual(snapshot_tree(target), before)

    def test_install_permutations_preserve_project_and_user_boundaries(self) -> None:
        scenarios = [
            ([], ["qa"]),
            (["qa"], ["qa"]),
            (["dev"], ["dev"]),
            (["qa", "qa"], ["qa"]),
            (["dev", "dev"], ["dev"]),
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
                    try:
                        link.unlink()
                    except OSError:
                        if os.name != "nt":
                            raise
                        os.rmdir(link)


if __name__ == "__main__":
    unittest.main()
