"""Behavior tests for the asynchronous first-PreToolUse update checker."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
TRUSTED_URL = (
    "https://raw.githubusercontent.com/Tooc0ld/kcoderag-nav/master/kcoderag-update.json"
)


class _Response:
    def __init__(
        self,
        payload: dict[str, object] | None = None,
        *,
        body: bytes | None = None,
        url: str = TRUSTED_URL,
        status: int = 200,
    ) -> None:
        self._body = body if body is not None else json.dumps(payload).encode("utf-8")
        self._url = url
        self.status = status

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return self._url

    def read(self, amount: int = -1) -> bytes:
        return self._body if amount < 0 else self._body[:amount]


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _current_version(environment: str) -> str:
    return json.loads((ROOT / "kcoderag-update.json").read_text(encoding="utf-8"))[
        "versions"
    ][environment]


def _versions(qa: str, dev: str) -> dict[str, str]:
    return {"qa": qa, "dev": dev}


def _remote_document(qa: str, dev: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "repository": "Tooc0ld/kcoderag-nav",
        "channel": "master",
        "versions": _versions(qa, dev),
    }


def _write_cache(cache_root: Path, checked_at: float, versions: dict[str, str]) -> None:
    cache_root.mkdir(parents=True, exist_ok=True)
    (cache_root / "remote-cache.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "checked_at": checked_at,
                "versions": versions,
            }
        ),
        encoding="utf-8",
    )


class UpdateCheckTests(unittest.TestCase):
    def test_stale_cache_schedules_background_refresh_without_foreground_network(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_async_foreground_check",
        )
        current_version = _current_version("qa")
        stale_version = "0.1.1+codex.1212121212121212"
        payload = {
            "session_id": "async-stale-session",
            "tool_name": "Grep",
            "tool_input": {"pattern": "GetLevel"},
        }
        launches: list[tuple[list[str], dict[str, object]]] = []
        network_calls: list[bool] = []

        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                1.0,
                _versions(stale_version, "0.1.1+codex.3434343434343434"),
            )
            notice = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 100_000.0,
                opener=lambda *_args, **_kwargs: network_calls.append(True),
                launcher=lambda command, **options: launches.append((command, options)),
            )

            self.assertTrue((cache_root / "refresh.lock").is_file())

        self.assertIsNone(notice)
        self.assertEqual(network_calls, [])
        self.assertEqual(len(launches), 1)
        self.assertIn("--refresh-cache", launches[0][0])

    def test_background_worker_validates_writes_cache_and_releases_owned_lock(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_async_worker_check",
        )
        document = _remote_document(
            "0.1.1+codex.5656565656565656",
            "0.1.1+codex.7878787878787878",
        )
        calls: list[tuple[str, float]] = []

        def opener(request: object, *, timeout: float):
            calls.append((request.full_url, timeout))
            return _Response(document)

        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            claim = checker._claim_refresh_lock(cache_root, 200_000.0)
            self.assertIsNotNone(claim)
            checker._refresh_cache_worker(
                cache_root,
                claim,
                now=lambda: 200_001.0,
                opener=opener,
            )
            cached = json.loads(
                (cache_root / "remote-cache.json").read_text(encoding="utf-8")
            )
            self.assertFalse((cache_root / "refresh.lock").exists())

        self.assertEqual(calls, [(TRUSTED_URL, 1.5)])
        self.assertEqual(cached["checked_at"], 200_001.0)
        self.assertEqual(cached["versions"], document["versions"])

    def test_refreshed_cache_is_visible_on_the_next_pretooluse_in_the_same_session(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_async_next_pretooluse_check",
        )
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.9090909090909090"
        document = _remote_document(
            remote_version,
            "0.1.1+codex.9191919191919191",
        )
        payload = {
            "session_id": "async-next-call-session",
            "tool_name": "Grep",
            "tool_input": {"pattern": "GetLevel"},
        }
        launches: list[list[str]] = []

        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            first = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 700_000.0,
                launcher=lambda command, **_options: launches.append(command),
            )
            claim = (cache_root / "refresh.lock", launches[0][-1])
            checker._refresh_cache_worker(
                cache_root,
                claim,
                now=lambda: 700_001.0,
                opener=lambda *_args, **_kwargs: _Response(document),
            )
            second = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 700_002.0,
            )

        self.assertIsNone(first)
        self.assertIn(remote_version, second or "")
        self.assertEqual(len(launches), 1)

    def test_worker_remote_and_cache_failures_are_silent_and_credential_safe(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_async_failure_matrix",
        )
        valid = _remote_document(
            "0.1.1+codex.bbbbbbbbbbbbbbbb",
            "0.1.1+codex.cccccccccccccccc",
        )
        cases = {
            "redirect": lambda: _Response(valid, url="https://example.invalid/secret"),
            "http_status": lambda: _Response(valid, status=503),
            "oversize": lambda: _Response(body=b"x" * (8 * 1024 + 1)),
            "malformed": lambda: _Response(body=b'{"secret-token":"prompt injection"}'),
            "timeout": lambda: (_ for _ in ()).throw(TimeoutError("secret-token")),
        }
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            for label, response_factory in cases.items():
                with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                    cache_root = Path(directory)
                    claim = checker._claim_refresh_lock(cache_root, 300_000.0)
                    checker._refresh_cache_worker(
                        cache_root,
                        claim,
                        now=lambda: 300_001.0,
                        opener=lambda *_args, factory=response_factory, **_kwargs: factory(),
                    )
                    self.assertFalse((cache_root / "refresh.lock").exists())
                    self.assertFalse((cache_root / "remote-cache.json").exists())

            with tempfile.TemporaryDirectory() as directory:
                cache_root = Path(directory)
                claim = checker._claim_refresh_lock(cache_root, 300_000.0)
                with mock.patch.object(
                    checker.os, "replace", side_effect=OSError("secret-token replace failure")
                ):
                    checker._refresh_cache_worker(
                        cache_root,
                        claim,
                        now=lambda: 300_001.0,
                        opener=lambda *_args, **_kwargs: _Response(valid),
                    )
                self.assertFalse((cache_root / "refresh.lock").exists())
                self.assertFalse((cache_root / "remote-cache.json").exists())

            with tempfile.TemporaryDirectory() as directory:
                cache_root = Path(directory) / "not-a-directory"
                cache_root.write_bytes(b"secret-token")
                launches: list[object] = []
                notice = checker.maybe_update_notice(
                    {
                        "session_id": "unwritable-cache",
                        "tool_name": "Grep",
                        "tool_input": {"pattern": "GetLevel"},
                    },
                    "qa",
                    _current_version("qa"),
                    cache_root=cache_root,
                    launcher=lambda *args, **kwargs: launches.append((args, kwargs)),
                )
                self.assertIsNone(notice)
                self.assertEqual(launches, [])

        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")

    def test_refresh_lock_loser_uses_stale_cache_and_stale_lock_is_recovered(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py", "qa_lock_state_check"
        )
        current_version = _current_version("qa")
        stale_version = "0.1.1+codex.dddddddddddddddd"
        payload = {"tool_name": "Glob", "tool_input": {"pattern": "*.txt"}}
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                10.0,
                _versions(stale_version, "0.1.1+codex.1111111111111111"),
            )
            lock = cache_root / "refresh.lock"
            lock.write_text("0" * 32, encoding="ascii")
            os.utime(lock, (100_000.0, 100_000.0))
            launches: list[list[str]] = []
            loser_notice = checker.maybe_update_notice(
                dict(payload, session_id="lock-loser"),
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 100_005.0,
                launcher=lambda command, **_options: launches.append(command),
            )
            self.assertIsNone(loser_notice)
            self.assertEqual(launches, [])

            os.utime(lock, (90_000.0, 90_000.0))
            recovered_notice = checker.maybe_update_notice(
                dict(payload, session_id="stale-lock"),
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 100_020.0,
                launcher=lambda command, **_options: launches.append(command),
            )
            self.assertIsNone(recovered_notice)
            self.assertEqual(len(launches), 1)
            self.assertRegex(lock.read_text(encoding="ascii"), r"^[0-9a-f]{32}$")

    def test_concurrent_stale_sessions_schedule_only_one_worker(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_concurrent_async_refresh",
        )
        current_version = _current_version("qa")
        stale_version = "0.1.1+codex.1919191919191919"
        launches: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                1.0,
                _versions(stale_version, "0.1.1+codex.2020202020202020"),
            )
            with ThreadPoolExecutor(max_workers=8) as executor:
                notices = list(
                    executor.map(
                        lambda index: checker.maybe_update_notice(
                            {
                                "session_id": f"stale-concurrent-{index}",
                                "tool_name": "Grep",
                                "tool_input": {"pattern": "GetLevel"},
                            },
                            "qa",
                            current_version,
                            cache_root=cache_root,
                            now=lambda: 400_000.0,
                            launcher=lambda command, **_options: launches.append(command),
                        ),
                        range(8),
                    )
                )

        self.assertEqual(len(launches), 1)
        self.assertTrue(all(notice is None for notice in notices))

    def test_session_marker_state_is_pruned_to_a_fixed_bound(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py", "qa_bounded_marker_check"
        )
        current_version = _current_version("qa")
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                1_500_000_000.0,
                _versions(current_version, _current_version("dev")),
            )
            for index in range(140):
                checker.maybe_update_notice(
                    {
                        "session_id": f"bounded-session-{index}",
                        "tool_name": "Grep",
                        "tool_input": {"pattern": "GetLevel"},
                    },
                    "qa",
                    current_version,
                    cache_root=cache_root,
                    now=lambda: 1_500_000_000.0,
                    launcher=lambda *_args, **_kwargs: self.fail("fresh cache launched worker"),
                )
            markers = list((cache_root / "sessions").glob("session-*.seen"))

        self.assertLessEqual(len(markers), 128)

    def test_concurrent_calls_for_one_session_have_one_notice_winner(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_concurrent_update_check",
        )
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.2121212121212121"
        payload = {
            "session_id": "concurrent-session",
            "tool_name": "Grep",
            "tool_input": {"pattern": "GetLevel"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                500_000.0,
                _versions(remote_version, "0.1.1+codex.2222222222222222"),
            )
            with ThreadPoolExecutor(max_workers=8) as executor:
                notices = list(
                    executor.map(
                        lambda _index: checker.maybe_update_notice(
                            payload,
                            "qa",
                            current_version,
                            cache_root=cache_root,
                            now=lambda: 500_000.0,
                        ),
                        range(8),
                    )
                )

        self.assertEqual(sum(notice is not None for notice in notices), 1)

    def test_explicit_session_is_consumed_before_a_second_pretooluse(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py", "qa_session_update_check"
        )
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.2323232323232323"
        payload = {
            "session_id": "repeat-session",
            "tool_name": "Glob",
            "tool_input": {"pattern": "*.txt"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                600_000.0,
                _versions(remote_version, "0.1.1+codex.2424242424242424"),
            )
            first = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, now=lambda: 600_000.0
            )
            second = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, now=lambda: 600_001.0
            )

        self.assertIn(remote_version, first or "")
        self.assertIsNone(second)

    def test_fresh_valid_cache_serves_each_new_session_without_network(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_fresh_cache_update_check",
        )
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.3333333333333333"
        common = {"tool_name": "Grep", "tool_input": {"pattern": "GetLevel"}}
        launches: list[object] = []
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                2_000_000_000.0,
                _versions(remote_version, "0.1.1+codex.4444444444444444"),
            )
            first = checker.maybe_update_notice(
                dict(common, session_id="cache-session-a"),
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 2_000_000_000.0,
                launcher=lambda *args, **kwargs: launches.append((args, kwargs)),
            )
            second = checker.maybe_update_notice(
                dict(common, session_id="cache-session-b"),
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 2_000_000_100.0,
                launcher=lambda *args, **kwargs: launches.append((args, kwargs)),
            )

        self.assertIn(remote_version, first or "")
        self.assertIn(remote_version, second or "")
        self.assertEqual(launches, [])

    def test_spawn_failure_uses_stale_cache_releases_lock_and_consumes_session(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_spawn_failure_check",
        )
        current_version = _current_version("qa")
        stale_version = "0.1.1+codex.5555555555555555"
        payload = {
            "session_id": "spawn-failure-session",
            "tool_name": "Bash",
            "tool_input": {"command": "rg GetLevel src"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                1.0,
                _versions(stale_version, "0.1.1+codex.6666666666666666"),
            )
            first = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 1_000_100_000.0,
                launcher=lambda *_args, **_kwargs: (_ for _ in ()).throw(
                    OSError("secret-token spawn failure")
                ),
            )
            second = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 1_000_100_001.0,
                launcher=lambda *_args, **_kwargs: self.fail("session retried refresh"),
            )
            self.assertFalse((cache_root / "refresh.lock").exists())

        self.assertIsNone(first)
        self.assertIsNone(second)

    def test_missing_session_uses_project_hour_bucket_without_raw_path_state(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_fallback_session_check",
        )
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.7777777777777777"
        raw_cwd = "D:/secret-customer/project"
        payload = {
            "cwd": raw_cwd,
            "tool_name": "Glob",
            "tool_input": {"pattern": "*.txt"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                7_200_000.0,
                _versions(remote_version, "0.1.1+codex.8888888888888888"),
            )
            first = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, now=lambda: 7_200_100.0
            )
            same_bucket = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, now=lambda: 7_200_200.0
            )
            next_bucket = checker.maybe_update_notice(
                payload, "qa", current_version, cache_root=cache_root, now=lambda: 7_203_700.0
            )
            state_paths = [path.relative_to(cache_root).as_posix() for path in cache_root.rglob("*")]
            state_bytes = b"".join(
                path.read_bytes() for path in cache_root.rglob("*") if path.is_file()
            )

        self.assertIn(remote_version, first or "")
        self.assertIsNone(same_bucket)
        self.assertIn(remote_version, next_bucket or "")
        self.assertNotIn(raw_cwd, "\n".join(state_paths))
        self.assertNotIn(raw_cwd.encode("utf-8"), state_bytes)

    def test_newer_qa_cache_adds_notice_to_first_claude_pretooluse(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py", "qa_update_check"
        )
        hook = _load_module(ROOT / "kcoderag-qa" / "hooks" / "grep_nudge.py", "qa_hook")
        current_version = _current_version("qa")
        remote_version = "0.1.1+codex.ffffffffffffffff"
        payload = {
            "session_id": "claude-session",
            "tool_name": "Grep",
            "tool_input": {"pattern": "exact mechanical text"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                1_800_000_000.0,
                _versions(remote_version, "0.1.1+codex.eeeeeeeeeeeeeeee"),
            )
            notice = checker.maybe_update_notice(
                payload,
                "qa",
                current_version,
                cache_root=cache_root,
                now=lambda: 1_800_000_000.0,
            )

        output = hook.hook_output(payload, update_notice=notice)
        self.assertIsNotNone(output)
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn(current_version, context)
        self.assertIn(remote_version, context)
        self.assertIn("do not update automatically", context.lower())
        for command in (
            "codex plugin marketplace upgrade kcoderag-nav --json",
            "codex plugin add kcoderag-qa@kcoderag-nav --json",
            "claude plugin marketplace update kcoderag-nav",
            "claude plugin update kcoderag-qa@kcoderag-nav --scope project",
        ):
            self.assertIn(command, context)
        self.assertLessEqual(len(context), 600)
        self.assertNotIn("Tooc0ld", context)

    def test_codex_dev_parity_same_version_and_irrelevant_payload_silence(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-dev" / "hooks" / "update_check.py", "dev_update_check"
        )
        hook = _load_module(ROOT / "kcoderag-dev" / "hooks" / "grep_nudge.py", "dev_hook")
        current_version = _current_version("dev")
        remote_version = "0.1.1+codex.dddddddddddddddd"
        payload = {
            "thread_id": "codex-thread",
            "tool_name": "Bash",
            "tool_input": {"command": "rg GetLevel src"},
        }
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                800_000.0,
                _versions("0.1.1+codex.cccccccccccccccc", remote_version),
            )
            notice = checker.maybe_update_notice(
                payload,
                "dev",
                current_version,
                cache_root=cache_root,
                now=lambda: 800_000.0,
            )
        output = hook.hook_output(payload, update_notice=notice)
        self.assertIsNotNone(output)
        context = output["hookSpecificOutput"]["additionalContext"]
        self.assertLessEqual(len(context), 600)
        self.assertLess(context.index(hook.NUDGE), context.index(remote_version))
        self.assertIn("codex plugin add kcoderag-dev@kcoderag-nav --json", context)
        self.assertIn(
            "claude plugin update kcoderag-dev@kcoderag-nav --scope project", context
        )

        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            _write_cache(
                cache_root,
                900_000.0,
                _versions("0.1.1+codex.cccccccccccccccc", current_version),
            )
            same = checker.maybe_update_notice(
                dict(payload, thread_id="same-version-thread"),
                "dev",
                current_version,
                cache_root=cache_root,
                now=lambda: 900_000.0,
            )
        self.assertIsNone(same)

        launches: list[object] = []
        irrelevant = checker.maybe_update_notice(
            {"tool_name": "Read", "tool_input": {"path": "README.md"}},
            "dev",
            current_version,
            launcher=lambda *args, **kwargs: launches.append((args, kwargs)),
        )
        self.assertIsNone(irrelevant)
        self.assertEqual(launches, [])

    def test_launcher_is_hidden_detached_and_spawn_failure_releases_owned_lock(self) -> None:
        checker = _load_module(
            ROOT / "kcoderag-qa" / "hooks" / "update_check.py",
            "qa_launcher_contract_check",
        )
        captured: list[tuple[list[str], dict[str, object]]] = []
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            claim = checker._claim_refresh_lock(cache_root, 1_000_000.0)
            self.assertTrue(
                checker._schedule_background_refresh(
                    cache_root,
                    claim,
                    launcher=lambda command, **options: captured.append((command, options)),
                )
            )
            checker._release_refresh_lock(claim)

            failed_claim = checker._claim_refresh_lock(cache_root, 1_000_001.0)
            self.assertFalse(
                checker._schedule_background_refresh(
                    cache_root,
                    failed_claim,
                    launcher=lambda *_args, **_kwargs: (_ for _ in ()).throw(
                        OSError("synthetic spawn failure")
                    ),
                )
            )
            self.assertFalse((cache_root / "refresh.lock").exists())

        command, options = captured[0]
        self.assertEqual(command[0], checker.sys.executable)
        self.assertEqual(command[2], "--refresh-cache")
        self.assertIs(options["stdin"], subprocess.DEVNULL)
        self.assertIs(options["stdout"], subprocess.DEVNULL)
        self.assertIs(options["stderr"], subprocess.DEVNULL)
        self.assertTrue(options["close_fds"])
        if os.name == "nt":
            self.assertGreater(options["creationflags"], 0)
            self.assertNotIn("start_new_session", options)
        else:
            self.assertTrue(options["start_new_session"])
            self.assertNotIn("creationflags", options)


if __name__ == "__main__":
    unittest.main()
