"""Project-scoped installer lifecycle tests."""

from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
