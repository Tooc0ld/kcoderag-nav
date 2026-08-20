"""Cross-platform contract tests for the advisory hook runtime launchers."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POSIX_LAUNCHER = ROOT / "plugin-src" / "hooks" / "run_hook.sh"
WINDOWS_LAUNCHER = ROOT / "plugin-src" / "hooks" / "run_hook.cmd"


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
                'if [ "$1" = "-c" ]; then',
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
                'if "%~1"=="-3" shift',
                'if "%~1"=="-c" exit /b ' + str(probe_exit),
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
    def test_uses_first_python_310_candidate_and_preserves_stdin_and_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_posix_candidate(fake_bin / "python3", probe_exit=0)
            _write_posix_candidate(fake_bin / "python", probe_exit=0)
            payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
            expected_output = '{"synthetic":true}'
            result = _run_posix(fake_bin, payload, expected_output)

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, expected_output)
            self.assertEqual(result.stderr, "")
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines(), ["-c", str(ROOT / "plugin-src" / "hooks" / "grep_nudge.py")])

    def test_skips_old_python_and_silently_fails_open(self) -> None:
        payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_posix_candidate(fake_bin / "python3", probe_exit=1)
            _write_posix_candidate(fake_bin / "python", probe_exit=0)

            fallback = _run_posix(fake_bin, payload, '{"fallback":true}')
            self.assertEqual((fallback.returncode, fallback.stdout, fallback.stderr), (0, '{"fallback":true}', ""))
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines()[0:2], ["-c", "-c"])

            trace.unlink()
            _write_posix_candidate(fake_bin / "python3", probe_exit=0, run_exit=7)
            failed = _run_posix(fake_bin, payload, "must-not-leak")
            self.assertEqual((failed.returncode, failed.stdout, failed.stderr), (0, "", ""))
            self.assertEqual(len(trace.read_text(encoding="utf-8").splitlines()), 2)

        with tempfile.TemporaryDirectory() as directory:
            missing = _run_posix(Path(directory), payload, "unused")
            self.assertEqual((missing.returncode, missing.stdout, missing.stderr), (0, "", ""))


@unittest.skipUnless(os.name == "nt", "Windows cmd launcher contract")
class WindowsHookRuntimeTests(unittest.TestCase):
    def test_probes_py_then_python3_and_preserves_successful_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_windows_candidate(fake_bin / "py.cmd", probe_exit=1)
            _write_windows_candidate(fake_bin / "python3.cmd", probe_exit=0)
            _write_windows_candidate(fake_bin / "python.cmd", probe_exit=0)
            payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
            expected_output = '{"synthetic":true}'
            environment = _runtime_environment(fake_bin, trace, payload, expected_output)
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

            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, expected_output, ""))
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines(), ["-3", "-c", str(ROOT / "plugin-src" / "hooks" / "grep_nudge.py")])

    def test_old_missing_probe_and_launch_failures_are_silent(self) -> None:
        payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
        for scenario in ("old", "launch"):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                fake_bin = Path(directory)
                trace = fake_bin / "trace.txt"
                probe_exit = 1 if scenario == "old" else 0
                run_exit = 0 if scenario == "old" else 7
                for name in ("py.cmd", "python3.cmd", "python.cmd"):
                    _write_windows_candidate(fake_bin / name, probe_exit=probe_exit, run_exit=run_exit)
                environment = _runtime_environment(fake_bin, trace, payload, "must-not-leak")
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
