"""Contract tests for explicit Codex and Claude marketplace updates."""

from __future__ import annotations

import importlib.util
import io
import subprocess
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "scripts" / "update_plugin.py"


def _load_updater():
    if not UPDATER.is_file():
        raise AssertionError("marketplace updater script is missing")
    spec = importlib.util.spec_from_file_location("update_plugin", UPDATER)
    if spec is None or spec.loader is None:
        raise AssertionError("cannot load marketplace updater")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PluginUpdateTests(unittest.TestCase):
    def test_failures_stop_at_stage_and_never_expose_captured_output(self) -> None:
        updater = _load_updater()

        marketplace_calls: list[list[str]] = []

        def marketplace_failure(
            argv: list[str], **_kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            marketplace_calls.append(argv)
            return subprocess.CompletedProcess(
                argv, 9, "Bearer synthetic-secret", "Authorization: synthetic-secret"
            )

        marketplace = updater.run_marketplace_update(
            "codex", "qa", runner=marketplace_failure
        )
        self.assertEqual(len(marketplace_calls), 1)
        self.assertEqual(marketplace["stage"], "marketplace")
        self.assertEqual(marketplace["reason"], "marketplace_refresh_failed")
        self.assertEqual(marketplace["exit_code"], 9)

        plugin_calls: list[list[str]] = []

        def plugin_failure(argv: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            plugin_calls.append(argv)
            return subprocess.CompletedProcess(
                argv,
                0 if len(plugin_calls) == 1 else 7,
                "Bearer synthetic-secret",
                "Authorization: synthetic-secret",
            )

        plugin = updater.run_marketplace_update("claude", "dev", runner=plugin_failure)
        self.assertEqual(len(plugin_calls), 2)
        self.assertEqual(plugin["stage"], "plugin")
        self.assertEqual(plugin["reason"], "plugin_update_failed")
        self.assertEqual(plugin["exit_code"], 7)

        timeout_calls: list[list[str]] = []

        def timeout(argv: list[str], **_kwargs: object):
            timeout_calls.append(argv)
            raise subprocess.TimeoutExpired(argv, 30, output="Bearer synthetic-secret")

        timed_out = updater.run_marketplace_update("codex", "qa", runner=timeout)
        self.assertEqual(len(timeout_calls), 1)
        self.assertEqual(timed_out["reason"], "timeout")
        self.assertEqual(timed_out["exit_code"], 124)

        with mock.patch.object(updater.shutil, "which", return_value=None):
            missing = updater.run_marketplace_update("codex", "qa")
        self.assertEqual(missing["stage"], "preflight")
        self.assertEqual(missing["reason"], "cli_not_found")
        self.assertEqual(missing["exit_code"], 127)

        safe_results = repr((marketplace, plugin, timed_out, missing))
        self.assertNotIn("synthetic-secret", safe_results)
        self.assertNotIn("Bearer", safe_results)
        self.assertNotIn("Authorization", safe_results)

        stderr = io.StringIO()
        with mock.patch.object(updater, "run_marketplace_update", return_value=marketplace):
            with redirect_stderr(stderr):
                exit_code = updater.main(["--host", "codex", "--environment", "qa"])
        self.assertEqual(exit_code, 9)
        self.assertEqual(
            stderr.getvalue(),
            "update failed (marketplace_refresh_failed): stage=marketplace\n",
        )

    def test_invalid_scope_is_rejected_before_host_commands(self) -> None:
        updater = _load_updater()
        calls: list[list[str]] = []

        result = updater.run_marketplace_update(
            "claude",
            "qa",
            scope="workspace",
            runner=lambda argv, **_kwargs: calls.append(argv),
        )

        self.assertEqual(calls, [])
        self.assertFalse(result["ok"])
        self.assertEqual(result["stage"], "preflight")
        self.assertEqual(result["reason"], "unsupported_scope")

    def test_claude_refreshes_marketplace_then_updates_project_plugin(self) -> None:
        updater = _load_updater()
        calls: list[list[str]] = []

        def runner(argv: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, "", "synthetic-secret-error")

        result = updater.run_marketplace_update("claude", "dev", runner=runner)

        self.assertEqual(
            calls,
            [
                ["claude", "plugin", "marketplace", "update", "kcoderag-nav"],
                [
                    "claude",
                    "plugin",
                    "update",
                    "kcoderag-dev@kcoderag-nav",
                    "--scope",
                    "project",
                ],
            ],
        )
        self.assertEqual(result["status"], "update_completed")
        self.assertTrue(result["restart_required"])
        self.assertNotIn("synthetic-secret-error", repr(result))

    def test_codex_refreshes_marketplace_then_reinstalls_selected_plugin(self) -> None:
        updater = _load_updater()
        calls: list[list[str]] = []

        def runner(argv: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, "synthetic-secret-output", "")

        result = updater.run_marketplace_update("codex", "qa", runner=runner)

        self.assertEqual(
            calls,
            [
                ["codex", "plugin", "marketplace", "upgrade", "kcoderag-nav", "--json"],
                [
                    "codex",
                    "plugin",
                    "add",
                    "kcoderag-qa@kcoderag-nav",
                    "--json",
                ],
            ],
        )
        self.assertEqual(
            result,
            {
                "ok": True,
                "host": "codex",
                "environment": "qa",
                "status": "reinstall_completed",
                "stage": "complete",
                "reason": None,
                "exit_code": 0,
                "restart_required": True,
            },
        )
        self.assertNotIn("synthetic-secret-output", repr(result))


if __name__ == "__main__":
    unittest.main()
