#!/usr/bin/env python3
"""Regenerate plugin packages without silently changing the staged commit.

Diagnostics are deliberately fixed strings. Canonical MCP inputs can contain
credentials, so subprocess output and file contents must never be relayed here.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


CANONICAL_PATHS = (
    "plugin-src",
    "scripts/generate_plugins.py",
)
GENERATED_PATHS = (
    ".agents/plugins",
    ".claude-plugin",
    ".cursor-plugin",
    "kcoderag-qa",
    "kcoderag-dev",
    "kcoderag-cursor",
    "kcoderag-update.json",
)
NODE_LAUNCHER_PATHS = {
    "plugin-src/hooks/run_hook.cmd",
    "plugin-src/hooks/run_hook.sh",
}


def _run(
    command: list[str],
    *,
    root: Path,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        command,
        cwd=root,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def _git(root: Path, *arguments: str) -> subprocess.CompletedProcess[bytes]:
    return _run(["git", *arguments], root=root)


def _has_unstaged_tracked_changes(root: Path, paths: tuple[str, ...]) -> bool | None:
    result = _git(root, "diff", "--quiet", "--exit-code", "--", *paths)
    if result.returncode == 0:
        return False
    if result.returncode == 1:
        return True
    return None


def _has_untracked_files(root: Path, paths: tuple[str, ...]) -> bool | None:
    result = _git(root, "ls-files", "--others", "--exclude-standard", "--", *paths)
    if result.returncode != 0:
        return None
    return bool(result.stdout.strip())


def _path_state(root: Path, paths: tuple[str, ...]) -> bool | None:
    """Return whether paths differ from the index, or None when Git failed."""
    tracked = _has_unstaged_tracked_changes(root, paths)
    untracked = _has_untracked_files(root, paths)
    if tracked is None or untracked is None:
        return None
    return tracked or untracked


def _staged_canonical_paths(root: Path) -> set[str] | None:
    result = _git(root, "diff", "--cached", "--name-only", "--", *CANONICAL_PATHS)
    if result.returncode != 0:
        return None
    return {
        line.replace(os.sep, "/")
        for line in result.stdout.decode("utf-8", errors="surrogateescape").splitlines()
        if line
    }


def _legacy_generation_is_deferred(root: Path) -> bool | None:
    """Keep the Python generator dormant during the ordered Node runtime migration."""
    if not (root / "scripts" / "generate_plugins.py").is_file():
        return False
    for relative_path in NODE_LAUNCHER_PATHS:
        launcher = root / relative_path
        try:
            source = launcher.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return False
        if "grep-nudge.cjs" not in source or "grep_nudge.py" in source:
            return False
    staged = _staged_canonical_paths(root)
    if staged is None:
        return None
    return not staged or staged <= NODE_LAUNCHER_PATHS


def _fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    repository = _git(root, "rev-parse", "--show-toplevel")
    if repository.returncode != 0:
        return _fail("Cannot locate the Git worktree for plugin generation.")

    canonical_state = _path_state(root, CANONICAL_PATHS)
    if canonical_state is None:
        return _fail("Cannot inspect canonical generator inputs with Git.")
    if canonical_state:
        return _fail(
            "Canonical generator inputs have unstaged changes. Stage or restore them first."
        )

    generation_deferred = _legacy_generation_is_deferred(root)
    if generation_deferred is None:
        return _fail("Cannot inspect staged canonical generator inputs with Git.")
    if generation_deferred:
        return 0

    generator = root / "scripts" / "generate_plugins.py"
    generated = _run([sys.executable, str(generator), "--write"], root=root)
    if generated.returncode != 0:
        return _fail("Plugin generation failed. Run the generator manually for details.")

    generated_state = _path_state(root, GENERATED_PATHS)
    if generated_state is None:
        return _fail("Cannot inspect generated plugin files with Git.")
    if generated_state:
        return _fail(
            "Generated plugin files changed. Review and git add them, then commit again."
        )

    checked = _run([sys.executable, str(generator), "--check"], root=root)
    if checked.returncode != 0:
        return _fail("Generated plugin files are inconsistent. Run the generator manually.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
