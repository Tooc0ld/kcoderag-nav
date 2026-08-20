"""Project-scoped installer lifecycle tests."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "manage_project_install.py"


def snapshot_tree(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def run_installer(target: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(INSTALLER), *arguments, "--target", str(target)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class ProjectInstallTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
