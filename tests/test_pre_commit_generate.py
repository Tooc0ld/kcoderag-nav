"""Contracts for the repository-owned plugin generation pre-commit hook."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "dist" / "maintainer" / "pre-commit.cjs"
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
            self.assertIn("duplicate_same_environment", document)
            self.assertIn("environment_conflict", document)
            self.assertIn("direct server map", document)

    def test_versioned_hook_invokes_helper_without_auto_staging(self) -> None:
        hook = HOOK.read_text(encoding="utf-8")
        lowered = hook.lower()

        self.assertTrue(hook.startswith("#!/bin/sh"))
        self.assertIn("dist/maintainer/pre-commit.cjs", hook)
        self.assertNotIn("git add", lowered)
        self.assertIn("node", lowered)
        self.assertNotIn("python", lowered)

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
                "Generated KCodeRag files drifted. Run npm run generate, review, and stage them explicitly.",
            )
            staged = self._git_names(isolated, "--cached")
            unstaged = self._git_names(isolated)
            self.assertIn("plugin-src/cursor/rules/kcoderag-navigation.mdc", staged)
            self.assertNotIn("kcoderag-cursor/.cursor-plugin/plugin.json", staged)
            self.assertNotIn("kcoderag-cursor/.cursor-plugin/plugin.json", unstaged)
            self.assertNotIn(".cursor-plugin/marketplace.json", unstaged)

            npm = shutil.which("npm") or "npm"
            self.assertEqual(run([npm, "run", "generate"], cwd=isolated).returncode, 0)
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
                "Canonical KCodeRag inputs have unstaged changes. Review and stage them explicitly.",
            )
            self.assertEqual(
                (isolated / "kcoderag-qa" / ".codex-plugin" / "plugin.json").read_bytes(),
                generated_before,
            )

    def test_legacy_generator_defers_only_the_ordered_node_launcher_migration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(
                ROOT,
                isolated,
                ignore=shutil.ignore_patterns(".git", ".planning", "__pycache__", "*.pyc"),
            )
            self._initialize_repository(isolated)

            launcher = isolated / "plugin-src" / "hooks" / "run_hook.sh"
            launcher.write_text(
                launcher.read_text(encoding="utf-8") + "\n# staged migration probe\n",
                encoding="utf-8",
            )
            self.assertEqual(run(["git", "add", launcher.as_posix()], cwd=isolated).returncode, 0)
            generated = isolated / "kcoderag-qa" / "hooks" / "run_hook.sh"
            generated_before = generated.read_bytes()

            deferred = self._run_helper(isolated)

            self.assertEqual(deferred.returncode, 1)
            self.assertEqual(
                deferred.stderr.strip(),
                "Generated KCodeRag files drifted. Run npm run generate, review, and stage them explicitly.",
            )
            self.assertEqual(deferred.stdout, "")
            self.assertEqual(generated.read_bytes(), generated_before)

            canonical = isolated / "plugin-src" / "cursor" / "rules" / "kcoderag-navigation.mdc"
            canonical.write_text(
                canonical.read_text(encoding="utf-8") + "\nnon-launcher probe\n",
                encoding="utf-8",
            )
            self.assertEqual(run(["git", "add", canonical.as_posix()], cwd=isolated).returncode, 0)
            not_deferred = self._run_helper(isolated)
            self.assertEqual(not_deferred.returncode, 1)
            self.assertEqual(
                not_deferred.stderr.strip(),
                "Generated KCodeRag files drifted. Run npm run generate, review, and stage them explicitly.",
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
        return run(["node", "dist/maintainer/pre-commit.cjs"], cwd=root)

    def _git_names(self, root: Path, *extra: str) -> set[str]:
        result = run(["git", "diff", "--name-only", *extra], cwd=root)
        self.assertEqual(result.returncode, 0, result.stderr)
        return {line.strip() for line in result.stdout.splitlines() if line.strip()}


if __name__ == "__main__":
    unittest.main()
