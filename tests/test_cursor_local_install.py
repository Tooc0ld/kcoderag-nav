"""Cursor free local-plugin installer lifecycle contracts."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import manage_cursor_local_install as installer


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "manage_cursor_local_install.py"


def snapshot_tree(root: Path) -> dict[str, bytes]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def copy_source(destination: Path) -> Path:
    source = destination / "source"
    shutil.copytree(ROOT / "kcoderag-cursor", source)
    return source


def run_installer(
    local_root: Path,
    source: Path,
    command: str,
    *arguments: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(INSTALLER),
            command,
            "--local-root",
            str(local_root),
            "--source",
            str(source),
            *arguments,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


class CursorLocalInstallTests(unittest.TestCase):
    def test_default_root_is_cursor_official_local_plugin_directory(self) -> None:
        home = Path("C:/Users/example") if os.name == "nt" else Path("/home/example")
        self.assertEqual(
            installer.default_local_root(home),
            home / ".cursor" / "plugins" / "local",
        )

    def test_install_status_and_idempotent_repeat_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / ".cursor" / "plugins" / "local"
            source = copy_source(base)

            first = run_installer(local_root, source, "install")
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("installed", first.stdout)
            target = local_root / "kcoderag-nav"
            self.assertEqual(snapshot_tree(target), snapshot_tree(source))

            status = run_installer(local_root, source, "status", "--json")
            self.assertEqual(status.returncode, 0, status.stderr)
            document = json.loads(status.stdout)
            self.assertEqual(document["status"], "healthy")
            self.assertEqual(document["issues"], [])
            self.assertRegex(document["package_version"], r"^0\.1\.\d+$")

            installed = snapshot_tree(local_root)
            repeated = run_installer(local_root, source, "install")
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            self.assertIn("already current", repeated.stdout)
            self.assertEqual(snapshot_tree(local_root), installed)

    def test_status_and_update_distinguish_source_change_from_local_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / "local"
            source = copy_source(base)
            self.assertEqual(run_installer(local_root, source, "install").returncode, 0)

            source_readme = source / "README.md"
            source_readme.write_text(
                source_readme.read_text(encoding="utf-8") + "\nSource update probe.\n",
                encoding="utf-8",
            )
            available = json.loads(
                run_installer(local_root, source, "status", "--json").stdout
            )
            self.assertEqual(available["status"], "update_available")
            self.assertEqual(
                available["issues"],
                [{"code": "source_update_available", "path": "kcoderag-nav"}],
            )

            updated = run_installer(local_root, source, "update")
            self.assertEqual(updated.returncode, 0, updated.stderr)
            self.assertIn("updated", updated.stdout)
            self.assertEqual(
                (local_root / "kcoderag-nav" / "README.md").read_bytes(),
                source_readme.read_bytes(),
            )

            installed_rule = local_root / "kcoderag-nav" / "rules" / "kcoderag-navigation.mdc"
            installed_rule.write_bytes(installed_rule.read_bytes() + b"\nlocal drift\n")
            before = snapshot_tree(local_root)
            drifted = json.loads(
                run_installer(local_root, source, "status", "--json").stdout
            )
            self.assertEqual(drifted["status"], "drifted")
            self.assertEqual(
                drifted["issues"],
                [
                    {
                        "code": "managed_content_changed",
                        "path": "rules/kcoderag-navigation.mdc",
                    }
                ],
            )
            refused = run_installer(local_root, source, "update")
            self.assertEqual(refused.returncode, 2)
            self.assertIn("managed_content_changed", refused.stderr)
            self.assertEqual(snapshot_tree(local_root), before)

    def test_unmanaged_target_is_never_overwritten_or_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = copy_source(base)

            unmanaged_root = base / "unmanaged"
            unmanaged = unmanaged_root / "kcoderag-nav"
            unmanaged.mkdir(parents=True)
            (unmanaged / "owned-by-user.txt").write_text("keep", encoding="utf-8")
            before = snapshot_tree(unmanaged_root)
            for command in ("install", "update", "uninstall"):
                with self.subTest(command=command):
                    result = run_installer(unmanaged_root, source, command)
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(snapshot_tree(unmanaged_root), before)

    def test_symlink_target_is_never_followed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = copy_source(base)
            link_root = base / "symlink-root"
            outside = base / "outside"
            outside.mkdir()
            link_root.mkdir()
            if hasattr(os, "symlink"):
                try:
                    os.symlink(outside, link_root / "kcoderag-nav", target_is_directory=True)
                except OSError:
                    self.skipTest("directory symlinks are unavailable on this host")
                result = run_installer(link_root, source, "install")
                self.assertEqual(result.returncode, 2)
                self.assertIn("symlink_target", result.stderr)
                self.assertEqual(snapshot_tree(outside), {})
            else:
                self.skipTest("symlinks are unavailable on this host")

    def test_uninstall_requires_unchanged_owned_tree_and_removes_exact_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / "local"
            source = copy_source(base)
            self.assertEqual(run_installer(local_root, source, "install").returncode, 0)
            unrelated = local_root / "other-plugin" / "keep.txt"
            unrelated.parent.mkdir()
            unrelated.write_text("keep", encoding="utf-8")

            extra = local_root / "kcoderag-nav" / "user-extra.txt"
            extra.write_text("do not delete", encoding="utf-8")
            refused = run_installer(local_root, source, "uninstall")
            self.assertEqual(refused.returncode, 2)
            self.assertTrue(extra.exists())
            extra.unlink()

            removed = run_installer(local_root, source, "uninstall")
            self.assertEqual(removed.returncode, 0, removed.stderr)
            self.assertIn("uninstalled", removed.stdout)
            self.assertFalse((local_root / "kcoderag-nav").exists())
            self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep")
            status = json.loads(
                run_installer(local_root, source, "status", "--json").stdout
            )
            self.assertEqual(status["status"], "not_installed")

    def test_invalid_source_and_diagnostics_do_not_expose_package_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / "local"
            source = copy_source(base)
            manifest = source / ".cursor-plugin" / "plugin.json"
            secret_probe = "secret-probe-must-not-print"
            manifest.write_text(secret_probe, encoding="utf-8")

            result = run_installer(local_root, source, "install")

            self.assertEqual(result.returncode, 2)
            self.assertIn("invalid_source", result.stderr)
            self.assertNotIn(secret_probe, result.stdout + result.stderr)
            self.assertEqual(snapshot_tree(local_root), {})

    def test_atomic_replace_failure_preserves_previous_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / "local"
            source = copy_source(base)
            installer.install(local_root, source)
            source_readme = source / "README.md"
            source_readme.write_bytes(source_readme.read_bytes() + b"\nnew source\n")
            before = snapshot_tree(local_root)

            real_replace = os.replace
            calls = 0

            def fail_second_replace(source_path: object, target_path: object) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("synthetic replace failure")
                real_replace(source_path, target_path)

            with mock.patch.object(installer.os, "replace", side_effect=fail_second_replace):
                with self.assertRaises(installer.CursorInstallError):
                    installer.update(local_root, source)

            self.assertEqual(snapshot_tree(local_root), before)

    def test_rollback_failure_keeps_previous_tree_for_manual_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            local_root = base / "local"
            source = copy_source(base)
            installer.install(local_root, source)
            source_readme = source / "README.md"
            source_readme.write_bytes(source_readme.read_bytes() + b"\nnew source\n")

            real_replace = os.replace
            calls = 0

            def fail_install_and_rollback(source_path: object, target_path: object) -> None:
                nonlocal calls
                calls += 1
                if calls in {2, 3}:
                    raise OSError("synthetic replace failure")
                real_replace(source_path, target_path)

            with mock.patch.object(
                installer.os, "replace", side_effect=fail_install_and_rollback
            ):
                with self.assertRaisesRegex(installer.CursorInstallError, "rollback_failed"):
                    installer.update(local_root, source)

            recovery_trees = list(local_root.glob(".kcoderag-nav-stage-*/previous-install"))
            self.assertEqual(len(recovery_trees), 1)
            self.assertTrue(
                recovery_trees[0].joinpath(*installer.MANIFEST_RELATIVE.split("/")).is_file()
            )


if __name__ == "__main__":
    unittest.main()
