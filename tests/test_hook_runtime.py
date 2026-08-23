"""Cross-platform contract tests for the advisory hook runtime launchers."""

from __future__ import annotations

import os
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POSIX_LAUNCHER = ROOT / "plugin-src" / "hooks" / "run_hook.sh"
WINDOWS_LAUNCHER = ROOT / "kcoderag-qa" / "hooks" / "run_hook.cmd"


def _posix_shell() -> str | None:
    discovered = shutil.which("sh")
    if discovered is not None:
        return discovered
    bundled = Path("C:/Program Files/Git/bin/sh.exe")
    return str(bundled) if bundled.is_file() else None


def _write_posix_candidate(path: Path, *, probe_exit: int, run_exit: int = 0) -> None:
    path.write_text(
        "\n".join(
            (
                "#!/bin/sh",
                'printf "%s\\n" "$1" >> "$TRACE_FILE"',
                'if [ "$1" = "-e" ]; then',
                f"  exit {probe_exit}",
                "fi",
                'IFS= read -r payload || :',
                'if [ "$payload" != "$EXPECTED_INPUT" ]; then exit 9; fi',
                'printf "%s" "$FAKE_OUTPUT"',
                f"exit {run_exit}",
                "",
            )
        ),
        encoding="utf-8",
        newline="\n",
    )
    path.chmod(0o755)


def _write_windows_candidate(path: Path, *, probe_exit: int, run_exit: int = 0) -> None:
    path.write_text(
        "\r\n".join(
            (
                "@echo off",
                '>>"%TRACE_FILE%" echo %~1',
                'if "%~1"=="-e" if not "' + str(probe_exit) + '"=="0" exit /b ' + str(probe_exit),
                "set /p PAYLOAD=",
                'if not "%PAYLOAD%"=="%EXPECTED_INPUT%" exit /b 9',
                '<nul set /p "=%FAKE_OUTPUT%"',
                "exit /b " + str(run_exit),
                "",
            )
        ),
        encoding="utf-8",
        newline="",
    )


def _runtime_environment(fake_bin: Path, trace: Path, payload: str, output: str) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "PATH": str(fake_bin),
            "TRACE_FILE": str(trace),
            "EXPECTED_INPUT": payload,
            "FAKE_OUTPUT": output,
        }
    )
    return environment


def _run_posix(fake_bin: Path, payload: str, output: str) -> subprocess.CompletedProcess[str]:
    shell = _posix_shell()
    if shell is None:
        raise unittest.SkipTest("POSIX sh is unavailable")
    return subprocess.run(
        [shell, str(POSIX_LAUNCHER)],
        input=payload,
        capture_output=True,
        text=True,
        check=False,
        env=_runtime_environment(fake_bin, fake_bin / "trace.txt", payload, output),
        timeout=5,
    )


class PosixHookRuntimeTests(unittest.TestCase):
    def test_uses_node_22_candidate_and_preserves_stdin_and_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_posix_candidate(fake_bin / "node", probe_exit=0)
            payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
            expected_output = '{"synthetic":true}'
            result = _run_posix(fake_bin, payload, expected_output)

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, expected_output)
            self.assertEqual(result.stderr, "")
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines(), ["-e", str(ROOT / "plugin-src" / "hooks" / "grep-nudge.cjs")])

    def test_skips_old_node_and_silently_fails_open(self) -> None:
        payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_posix_candidate(fake_bin / "node", probe_exit=1)

            rejected = _run_posix(fake_bin, payload, '{"unused":true}')
            self.assertEqual((rejected.returncode, rejected.stdout, rejected.stderr), (0, "", ""))
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines(), ["-e"])

            trace.unlink()
            _write_posix_candidate(fake_bin / "node", probe_exit=0, run_exit=7)
            failed = _run_posix(fake_bin, payload, "must-not-leak")
            self.assertEqual((failed.returncode, failed.stdout, failed.stderr), (0, "", ""))
            self.assertEqual(len(trace.read_text(encoding="utf-8").splitlines()), 2)

        with tempfile.TemporaryDirectory() as directory:
            missing = _run_posix(Path(directory), payload, "unused")
            self.assertEqual((missing.returncode, missing.stdout, missing.stderr), (0, "", ""))


@unittest.skipUnless(os.name == "nt", "Windows cmd launcher contract")
class WindowsHookRuntimeTests(unittest.TestCase):
    def test_runs_node_and_preserves_successful_json(self) -> None:
        payload = '{"tool_name":"Grep","tool_input":{"pattern":"SyntheticSymbol"}}'
        result = subprocess.run(
            [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "call", str(WINDOWS_LAUNCHER)],
            input=payload + "\n",
            capture_output=True,
            text=True,
            check=False,
            env=os.environ.copy(),
            timeout=5,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertIn("hookSpecificOutput", json.loads(result.stdout))

    def test_missing_node_is_silent(self) -> None:
        payload = '{"tool_name":"Grep","tool_input":{"pattern":"SyntheticSymbol"}}'
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment["PATH"] = directory
            environment["PATHEXT"] = ".CMD;.EXE"
            result = subprocess.run(
                [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "call", str(WINDOWS_LAUNCHER)],
                input=payload + "\n",
                capture_output=True,
                text=True,
                check=False,
                env=environment,
                timeout=5,
            )
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))


if __name__ == "__main__":
    unittest.main()
