"""Behavior tests for the lazy first-PreToolUse update checker."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRUSTED_URL = (
    "https://raw.githubusercontent.com/Tooc0ld/kcoderag-nav/master/kcoderag-update.json"
)


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self._body = json.dumps(payload).encode("utf-8")
        self.status = 200

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return TRUSTED_URL

    def read(self, amount: int = -1) -> bytes:
        return self._body if amount < 0 else self._body[:amount]


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class UpdateCheckTests(unittest.TestCase):
    def test_newer_qa_document_adds_notice_to_first_claude_pretooluse(self) -> None:
        checker_path = ROOT / "kcoderag-qa" / "hooks" / "update_check.py"
        self.assertTrue(checker_path.is_file(), "QA package lacks its update checker")
        checker = _load_module(checker_path, "qa_update_check")
        hook = _load_module(ROOT / "kcoderag-qa" / "hooks" / "grep_nudge.py", "qa_hook")
        current_version = json.loads(
            (ROOT / "kcoderag-update.json").read_text(encoding="utf-8")
        )["versions"]["qa"]
        remote_version = "0.1.1+codex.ffffffffffffffff"
        remote_document = {
            "schema_version": 1,
            "repository": "Tooc0ld/kcoderag-nav",
            "channel": "master",
            "versions": {
                "qa": remote_version,
                "dev": "0.1.1+codex.eeeeeeeeeeeeeeee",
            },
        }
        calls: list[tuple[str, float]] = []

        def opener(request: object, *, timeout: float):
            calls.append((request.full_url, timeout))
            return _Response(remote_document)

        payload = {
            "session_id": "claude-session",
            "tool_name": "Grep",
            "tool_input": {"pattern": "exact mechanical text"},
        }
        with tempfile.TemporaryDirectory() as directory:
            notice = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=Path(directory),
                now=lambda: 1_800_000_000.0,
                opener=opener,
            )

        output = hook.hook_output(payload, update_notice=notice)
        self.assertEqual(calls, [(TRUSTED_URL, 1.5)])
        self.assertIsNotNone(output)
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn(current_version, context)
        self.assertIn(remote_version, context)
        self.assertIn("do not update automatically", context.lower())
        self.assertNotIn("Tooc0ld", context)


if __name__ == "__main__":
    unittest.main()
