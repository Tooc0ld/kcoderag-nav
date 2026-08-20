# Testing Patterns

**Analysis Date:** 2026-08-20

## Test Framework

**Runner:**
- No pytest/unittest configuration or dependency manifest is present.
- Tests are executable standard-library Python scripts with `if __name__ == "__main__": sys.exit(run())` (`kcoderag-dev/hooks/test_grep_nudge.py`).

**Assertion Library:**
- No assertion library is used. A local `check(label, got, expected)` helper prints status and returns a failure count.

**Run Commands:**
```bash
python kcoderag-dev/hooks/test_grep_nudge.py
python kcoderag-qa/hooks/test_grep_nudge.py
```

## Test File Organization

**Location:**
- Tests are co-located with the implementation under each plugin environment's `hooks/` directory.

**Naming:**
- `test_<unit>.py`, matching `test_grep_nudge.py`.

**Structure:**
```text
kcoderag-dev/hooks/grep_nudge.py
kcoderag-dev/hooks/test_grep_nudge.py
kcoderag-qa/hooks/grep_nudge.py
kcoderag-qa/hooks/test_grep_nudge.py
```

## Test Structure

**Suite Organization:**
```python
for pattern, expected in PATTERN_CASES:
    failures += check(
        f"pattern {pattern!r}", _mod.looks_like_symbol_lookup(pattern), expected
    )
```

**Patterns:**
- Table-driven cases cover positive and negative classification (`PATTERN_CASES` and `COMMAND_CASES`).
- A single `run()` function aggregates integer failures and returns non-zero only when a check fails.
- Tests cover both pure helpers and the executable stdin/stdout protocol.
- Include adversarial/performance cases: malformed substitution must complete under 250 ms and oversized commands must fail open.

## Mocking

**Framework:** None detected.

**Patterns:**
```python
malformed = subprocess.run(
    [sys.executable, _SCRIPT], input="not-json", text=True,
    capture_output=True, check=False,
)
```

**What to Mock:**
- No external services are exercised. For future hook tests, isolate subprocess/protocol behavior and keep tests offline.

**What NOT to Mock:**
- Do not replace the actual script entry point when testing JSON protocol behavior; invoke `grep_nudge.py` as a subprocess.

## Fixtures and Factories

**Test Data:**
```python
PATTERN_CASES = [("GetLevel", True), ("TODO.*fixme", False)]
```

**Location:**
- Fixtures are inline constants in each test module; no shared fixture directory is detected.

## Coverage

**Requirements:** No coverage target or coverage configuration is detected.

**View Coverage:**
```bash
# Not configured
```

## Test Types

**Unit Tests:**
- Directly exercise regex/classification and shell token parsing helpers in `kcoderag-dev/hooks/test_grep_nudge.py`.

**Integration Tests:**
- Subprocess checks validate malformed stdin, JSON output, exit status, and host-neutral protocol behavior.

**E2E Tests:**
- Not detected. Hook configuration is inspected indirectly through protocol expectations; no live Claude/Codex host test exists.

## Common Patterns

**Async Testing:**
- Not applicable; implementation is synchronous and standard-library-only.

**Error Testing:**
```python
failures += check("malformed input fails open", malformed.returncode, 0)
failures += check("malformed input has no output", malformed.stdout, "")
```
- Assert fail-open status, empty protocol output, and silent handling of mechanical searches.

---

*Testing analysis: 2026-08-20*
