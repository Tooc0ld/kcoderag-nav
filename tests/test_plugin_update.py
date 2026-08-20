"""Contract tests for explicit Codex and Claude marketplace updates."""

from __future__ import annotations

import importlib.util
import subprocess
import unittest
from pathlib import Path


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
