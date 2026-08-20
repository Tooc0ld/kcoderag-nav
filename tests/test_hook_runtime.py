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


class PosixHookRuntimeTests(unittest.TestCase):
    def test_uses_first_python_310_candidate_and_preserves_stdin_and_stdout(self) -> None:
        shell = _posix_shell()
        if shell is None:
            self.skipTest("POSIX sh is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            fake_bin = Path(directory)
            trace = fake_bin / "trace.txt"
            _write_posix_candidate(fake_bin / "python3", probe_exit=0)
            _write_posix_candidate(fake_bin / "python", probe_exit=0)
            payload = '{"tool_input":{"pattern":"SyntheticSymbol"}}'
            expected_output = '{"synthetic":true}'
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "TRACE_FILE": str(trace),
                    "EXPECTED_INPUT": payload,
                    "FAKE_OUTPUT": expected_output,
                }
            )

            result = subprocess.run(
                [shell, str(POSIX_LAUNCHER)],
                input=payload,
                capture_output=True,
                text=True,
                check=False,
                env=environment,
                timeout=5,
            )

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, expected_output)
            self.assertEqual(result.stderr, "")
            self.assertEqual(trace.read_text(encoding="utf-8").splitlines(), ["-c", str(ROOT / "plugin-src" / "hooks" / "grep_nudge.py")])


if __name__ == "__main__":
    unittest.main()
