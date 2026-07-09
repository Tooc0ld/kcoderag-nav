#!/usr/bin/env python3
"""Regression tests for grep_nudge.py's looks_like_symbol_lookup heuristic.

Run directly:  python test_grep_nudge.py
Exits non-zero if any case fails. Standard library only.

These cases pin the "widened" rule: real symbol lookups that sprinkle regex chars
(\\bGetLevel\\b, GetLevel\\s*\\(, \\.GetLevel\\() must NUDGE, while bulk/wildcard
patterns (foo.bar.*, s/old/new/g, filenames, TODO) must stay SILENT.
"""
import importlib.util
import os
import sys

# Load the sibling grep_nudge.py module (same dir as this test file).
_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location("grep_nudge", os.path.join(_HERE, "grep_nudge.py"))
_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_mod)
looks_like_symbol_lookup = _mod.looks_like_symbol_lookup

# (pattern, expected_nudge, description)
CASES = [
    # --- should NUDGE (symbol / call-relation lookups, incl. with regex) ---
    ("GetLevel", True, "bare identifier"),
    ("KPlayer::GetLevel", True, "C++ qualified name"),
    (r"\bGetLevel\b", True, "word-boundary find definition"),
    (r"GetLevel\s*\(", True, "find overloads/calls"),
    (r"\.GetLevel\(", True, "method-call site"),
    (":GetLevel(", True, "Lua call site"),
    ("void GetLevel", True, "declaration w/ void"),
    ("function GetLevel", True, "Lua function def"),
    ("class KPlayer", True, "class declaration"),
    ("#define.*MAX_LEVEL", True, "macro definition"),
    (r"getLevel\(\)", True, "call with parens"),
    ("std::vector", True, ":: qualified type"),
    # --- should stay SILENT (bulk / exact-string / non-symbol) ---
    ("foo.bar.*", False, "wildcard bulk"),
    ("s/old/new/g", False, "sed-style replace"),
    ("m_nLevel = 123", False, "assignment"),
    ("TODO.*fixme", False, "TODO comment"),
    ("player.cpp", False, "bare filename"),
    ("if.*return", False, "control flow"),
    ("int.*count", False, "type + generic var"),
    ("Foo.*Bar", False, "two wildcards no anchor"),
    ("OnLogin.*OnDie", False, "two symbols + wildcard no anchor"),
]


def run() -> int:
    failures = 0
    for pattern, expected, desc in CASES:
        got = looks_like_symbol_lookup(pattern)
        if got != expected:
            failures += 1
            print(f"FAIL  {pattern!r:<24} expected={expected} got={got}  ({desc})")
        else:
            print(f"ok    {pattern!r:<24} {expected}  ({desc})")
    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
