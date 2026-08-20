"""End-to-end tests for deterministic plugin generation."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate_plugins.py"
EXPECTED_FILES = {
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "agents/kcode-explorer.md",
    "hooks/grep_nudge.py",
    "hooks/hooks.json",
    "hooks/test_grep_nudge.py",
    "settings.json",
    "skills/code-lookup-discipline/SKILL.md",
}


class GenerationTests(unittest.TestCase):
    def test_generation_check_accepts_tracked_outputs(self) -> None:
        result = subprocess.run(
            [sys.executable, str(GENERATOR), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, "generation check failed")

    def test_generated_packages_are_self_contained(self) -> None:
        for environment in ("qa", "dev"):
            package = ROOT / f"kcoderag-{environment}"
            paths = {
                path.relative_to(package).as_posix()
                for path in package.rglob("*")
                if path.is_file() and "__pycache__" not in path.parts
            }
            self.assertEqual(paths, EXPECTED_FILES)
            self.assertFalse(any(path.is_symlink() for path in package.rglob("*")))

            manifest = json.loads((package / ".codex-plugin" / "plugin.json").read_text())
            self.assertEqual(manifest["name"], f"kcoderag-{environment}")
            self.assertEqual(manifest["mcpServers"], "./.mcp.json")
            self.assertEqual(manifest["skills"], "./skills/")


if __name__ == "__main__":
    unittest.main()
