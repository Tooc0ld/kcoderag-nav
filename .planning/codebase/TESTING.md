# Testing Patterns

**Analysis Date:** 2026-08-20

## Test Framework

**Runner:**
- The primary suite uses Node's built-in test runner against compiled CommonJS under
  `dist-tests/`, with TypeScript `.cts` sources in `tests/`.
- Retired Python parity tests remain temporarily during the ordered migration but are not the
  primary new-test pattern.

**Assertion Library:**
- No assertion library is used. A local `check(label, got, expected)` helper prints status and returns a failure count.

**Run Commands:**
```bash
npm run build
npm test
npm run test:host:claude
npm run test:host:cursor
npm run test:cross-host
```

## Test File Organization

**Location:**
- Node tests mirror source areas under `tests/core/`, `tests/hooks/`, `tests/hosts/`,
  `tests/generator/`, and `tests/maintainer/`.

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
- Temporary-project fixtures exercise real compiled adapters, structured JSON merges, state-last
  transactions, injected rollback failures, legacy migration, and cross-host tree snapshots.
- Subprocess checks validate compiled hook stdin/stdout, launchers, and fail-open exit behavior.

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
