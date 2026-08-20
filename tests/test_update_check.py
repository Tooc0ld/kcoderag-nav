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
    def test_explicit_session_is_consumed_before_a_second_pretooluse(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py", "qa_session_update_check"
        )
        current_version = json.loads(
            (ROOT / "kcoderag-update.json").read_text(encoding="utf-8")
        )["versions"]["qa"]
        document = {
            "schema_version": 1,
            "repository": "Tooc0ld/kcoderag-nav",
            "channel": "master",
            "versions": {
                "qa": "0.1.1+codex.aaaaaaaaaaaaaaaa",
                "dev": "0.1.1+codex.bbbbbbbbbbbbbbbb",
            },
        }
        calls: list[str] = []

        def opener(request: object, *, timeout: float):
            calls.append(request.full_url)
            return _Response(document)

        payload = {
            "session_id": "repeat-session",
            "tool_name": "Glob",
            "tool_input": {"pattern": "*.txt"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            first = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, opener=opener
            )
            second = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, opener=opener
            )

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(calls, [TRUSTED_URL])

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

    def test_codex_dev_parity_same_version_and_irrelevant_payload_silence(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-dev" / "hooks" / "update_check.py", "dev_update_check"
        )
        hook = _load_module(ROOT / "kcoderag-dev" / "hooks" / "grep_nudge.py", "dev_hook")
        current_version = json.loads(
            (ROOT / "kcoderag-update.json").read_text(encoding="utf-8")
        )["versions"]["dev"]
        remote_version = "0.1.1+codex.dddddddddddddddd"
        document = {
            "schema_version": 1,
            "repository": "Tooc0ld/kcoderag-nav",
            "channel": "master",
            "versions": {"qa": "0.1.1+codex.cccccccccccccccc", "dev": remote_version},
        }
        calls: list[str] = []

        def opener(request: object, *, timeout: float):
            self.assertEqual(timeout, 1.5)
            calls.append(request.full_url)
            return _Response(document)

        payload = {
            "thread_id": "codex-thread",
            "tool_name": "Bash",
            "tool_input": {"command": "rg GetLevel src"},
        }
        notice = checker.maybe_update_notice(payload, "dev", current_version, opener=opener)
        output = hook.hook_output(payload, update_notice=notice)
        self.assertEqual(calls, [TRUSTED_URL])
        self.assertIsNotNone(output)
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertLessEqual(len(context), 600)
        self.assertLess(context.index(hook.NUDGE), context.index(remote_version))

        same_document = dict(document)
        same_document["versions"] = dict(document["versions"], dev=current_version)
        same = checker.maybe_update_notice(
            payload,
            "dev",
            current_version,
            opener=lambda *_args, **_kwargs: _Response(same_document),
        )
        self.assertIsNone(same)

        irrelevant_calls: list[object] = []
        irrelevant = checker.maybe_update_notice(
            {"tool_name": "Read", "tool_input": {"path": "README.md"}},
            "dev",
            current_version,
            opener=lambda *args, **_kwargs: irrelevant_calls.append((args, _kwargs)),
        )
        self.assertIsNone(irrelevant)
        self.assertEqual(irrelevant_calls, [])


if __name__ == "__main__":
    unittest.main()
