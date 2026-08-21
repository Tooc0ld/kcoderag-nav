"""Contracts for the repository-owned plugin generation pre-commit hook."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "pre_commit_generate.py"
HOOK = ROOT / ".githooks" / "pre-commit"


def run(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        command,
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


class PreCommitGenerationTests(unittest.TestCase):
    def test_maintainer_docs_define_generation_and_cursor_update_boundaries(self) -> None:
        documents = ((ROOT / "README.md").read_text(encoding="utf-8"),)

        for document in documents:
            self.assertIn("git config core.hooksPath .githooks", document)
            self.assertIn("scripts/generate_plugins.py --write", document)
            self.assertIn("plugin-src/version.txt", document)
            self.assertIn("不会自动执行 `git add`", document)
            self.assertIn("QA、Dev 与 Cursor", document)
            self.assertIn("scripts/manage_cursor_local_install.py update", document)
            self.assertIn("不需要 Cursor Team", document)

    def test_versioned_hook_invokes_helper_without_auto_staging(self) -> None:
        hook = HOOK.read_text(encoding="utf-8")
        lowered = hook.lower()

        self.assertTrue(hook.startswith("#!/bin/sh"))
        self.assertIn("scripts/pre_commit_generate.py", hook)
        self.assertNotIn("git add", lowered)
        self.assertIn("python3", lowered)
        self.assertIn("python", lowered)

    def test_real_git_lifecycle_is_safe_and_covers_cursor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(
                ROOT,
                isolated,
                ignore=shutil.ignore_patterns(".git", ".planning", "__pycache__", "*.pyc"),
            )
            self._initialize_repository(isolated)

            clean = self._run_helper(isolated)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            self.assertEqual(clean.stdout, "")

            canonical = isolated / "plugin-src" / "cursor" / "rules" / "kcoderag-navigation.mdc"
            canonical.write_text(
                canonical.read_text(encoding="utf-8") + "\nCursor pre-commit probe.\n",
                encoding="utf-8",
            )
            self.assertEqual(run(["git", "add", canonical.as_posix()], cwd=isolated).returncode, 0)

            generated = self._run_helper(isolated)
            self.assertEqual(generated.returncode, 1)
            self.assertEqual(
                generated.stderr.strip(),
                "Generated plugin files changed. Review and git add them, then commit again.",
            )
            staged = self._git_names(isolated, "--cached")
            unstaged = self._git_names(isolated)
            self.assertIn("plugin-src/cursor/rules/kcoderag-navigation.mdc", staged)
            self.assertNotIn("kcoderag-cursor/.cursor-plugin/plugin.json", staged)
            self.assertIn("kcoderag-cursor/.cursor-plugin/plugin.json", unstaged)
            self.assertIn(".cursor-plugin/marketplace.json", unstaged)

            self.assertEqual(run(["git", "add", "-A"], cwd=isolated).returncode, 0)
            ready = self._run_helper(isolated)
            self.assertEqual(ready.returncode, 0, ready.stderr)

    def test_partial_staging_is_rejected_before_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(
                ROOT,
                isolated,
                ignore=shutil.ignore_patterns(".git", ".planning", "__pycache__", "*.pyc"),
            )
            self._initialize_repository(isolated)

            canonical = isolated / "plugin-src" / "hooks" / "grep_nudge.py"
            canonical.write_text(
                canonical.read_text(encoding="utf-8") + "\n# staged pre-commit probe\n",
                encoding="utf-8",
            )
            self.assertEqual(run(["git", "add", canonical.as_posix()], cwd=isolated).returncode, 0)
            canonical.write_text(
                canonical.read_text(encoding="utf-8") + "# unstaged pre-commit probe\n",
                encoding="utf-8",
            )
            generated_before = (
                isolated / "kcoderag-qa" / ".codex-plugin" / "plugin.json"
            ).read_bytes()

            result = self._run_helper(isolated)

            self.assertEqual(result.returncode, 1)
            self.assertEqual(
                result.stderr.strip(),
                "Canonical generator inputs have unstaged changes. Stage or restore them first.",
            )
            self.assertEqual(
                (isolated / "kcoderag-qa" / ".codex-plugin" / "plugin.json").read_bytes(),
                generated_before,
            )

    def _initialize_repository(self, root: Path) -> None:
        commands = (
            ["git", "init", "-q"],
            ["git", "config", "user.name", "KCodeRag Test"],
            ["git", "config", "user.email", "kcoderag@example.invalid"],
            ["git", "config", "core.autocrlf", "false"],
            ["git", "add", "-A"],
            ["git", "commit", "-q", "--no-verify", "-m", "baseline"],
        )
        for command in commands:
            result = run(command, cwd=root)
            self.assertEqual(result.returncode, 0, result.stderr)

    def _run_helper(self, root: Path) -> subprocess.CompletedProcess[str]:
        return run([sys.executable, "scripts/pre_commit_generate.py"], cwd=root)

    def _git_names(self, root: Path, *extra: str) -> set[str]:
        result = run(["git", "diff", "--name-only", *extra], cwd=root)
        self.assertEqual(result.returncode, 0, result.stderr)
        return {line.strip() for line in result.stdout.splitlines() if line.strip()}


if __name__ == "__main__":
    unittest.main()
