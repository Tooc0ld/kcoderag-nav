#!/usr/bin/env python3
"""Regression tests for the dual-host, fail-open lookup nudge hook."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCRIPT = os.path.join(_HERE, "grep_nudge.py")
_SPEC = importlib.util.spec_from_file_location("grep_nudge", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_mod)

PATTERN_CASES = [
    ("GetLevel", True),
    ("KPlayer::GetLevel", True),
    (r"\bGetLevel\b", True),
    (r"GetLevel\s*\(", True),
    (r"\.GetLevel\(", True),
    (":GetLevel(", True),
    (r"\bGet.*\b", True),
    ("GetLevel|GetHP", True),
    ("class KPlayer", True),
    ("获取玩家信息", True),
    ("foo.bar.*", False),
    ("s/old/new/g", False),
    ("m_nLevel = 123", False),
    ("TODO.*fixme", False),
    ("player.cpp", False),
    ("if.*return", False),
    ("int.*count", False),
    ("Foo.*Bar", False),
    ("default", False),
]

COMMAND_CASES = [
    ('rg -n "KPlayer::GetLevel" src', True),
    ('rg --glob "*.cpp" "GetLevel\\s*\\(" src', True),
    ("git grep -n GetLevel", True),
    ("Select-String -Path *.cpp -Pattern GetLevel", True),
    ("findstr /S /N GetLevel *.cpp", True),
    ('findstr /C:"GetLevel" *.cpp', True),
    ('rg --files -g "*KPlayer*"', True),
    ('rg --files -g"*KPlayer*"', True),
    ('Get-ChildItem -Recurse -Filter "KPlayer*"', True),
    ('Get-ChildItem -Recurse "KPlayer*"', True),
    ('rg --files -g "*.cpp"', False),
    ("rg -n TODO src", False),
    ("rg -n -C 2 GetLevel src", True),
    ("rg -n -c GetLevel src", True),
    ("rg -eGetLevel src", True),
    ("rg -- -GetLevel src", True),
    ('pwsh -Command "rg GetLevel src"', True),
    ("rg GetLevel one.cpp", False),
    ("rg error_message logs", False),
    ("pytest -q", False),
    ('rg -n "m_nLevel = 123" src', False),
]


def check(label: str, got: object, expected: object) -> int:
    safe_label = label.encode("ascii", errors="backslashreplace").decode("ascii")
    if got == expected:
        print(f"ok    {safe_label}")
        return 0
    print(f"FAIL  {safe_label}: expected={expected!r} got={got!r}")
    return 1


def run() -> int:
    failures = 0
    for pattern, expected in PATTERN_CASES:
        failures += check(
            f"pattern {pattern!r}", _mod.looks_like_symbol_lookup(pattern), expected
        )
    for command, expected in COMMAND_CASES:
        patterns = _mod.shell_lookup_patterns(command)
        got = any(_mod.looks_like_symbol_lookup(pattern) for pattern in patterns)
        failures += check(f"command {command!r} -> {patterns!r}", got, expected)

    adversarial_substitution = "s/" + "/" * 16_000 + "!"
    started = time.perf_counter()
    adversarial_result = _mod.looks_like_symbol_lookup(adversarial_substitution)
    elapsed = time.perf_counter() - started
    failures += check("malformed substitution stays silent", adversarial_result, False)
    failures += check("malformed substitution is classified within 250ms", elapsed < 0.25, True)
    oversized_command = "rg GetLevel " + "x" * 65_536
    failures += check(
        "oversized shell command fails open", _mod.shell_lookup_patterns(oversized_command), []
    )

    claude_output = _mod.hook_output({"tool_input": {"pattern": "GetLevel"}})
    codex_output = _mod.hook_output({"tool_input": {"command": "rg -n GetLevel src"}})
    silent_output = _mod.hook_output({"tool_input": {"command": "rg -n TODO src"}})
    failures += check("Claude pattern payload emits context", claude_output is not None, True)
    failures += check("Codex command payload emits context", codex_output is not None, True)
    failures += check("mechanical command stays silent", silent_output, None)
    failures += check("nudge names search_code", "search_code" in _mod.NUDGE, True)
    failures += check("nudge names get_call_chain", "get_call_chain" in _mod.NUDGE, True)
    failures += check("nudge is host-neutral", "mcp__plugin_" in _mod.NUDGE, False)

    malformed = subprocess.run(
        [sys.executable, _SCRIPT],
        input="not-json",
        text=True,
        capture_output=True,
        check=False,
    )
    failures += check("malformed input fails open", malformed.returncode, 0)
    failures += check("malformed input has no output", malformed.stdout, "")

    payload = json.dumps({"tool_input": {"command": "git grep KPlayer::GetLevel"}})
    with tempfile.TemporaryDirectory() as dedup_directory:
        environment = os.environ.copy()
        environment["KCODERAG_NAV_DEDUP_DIR"] = dedup_directory
        process = subprocess.run(
            [sys.executable, _SCRIPT],
            input=payload,
            text=True,
            capture_output=True,
            check=False,
            env=environment,
        )
    parsed = json.loads(process.stdout) if process.stdout else None
    failures += check("CLI payload exits successfully", process.returncode, 0)
    failures += check("CLI payload emits hookSpecificOutput", isinstance(parsed, dict), True)

    total = len(PATTERN_CASES) + len(COMMAND_CASES) + 13
    print(f"\n{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
