# Coding Conventions

**Analysis Date:** 2026-08-20

## Naming Patterns

**Files:**
- Python modules use lowercase `snake_case`, for example `kcoderag-dev/hooks/grep_nudge.py`.
- Tests use the `test_*.py` naming form, for example `kcoderag-dev/hooks/test_grep_nudge.py`.

**Functions:**
- Functions use lowercase `snake_case` (`looks_like_symbol_lookup`, `shell_lookup_patterns`, and `hook_output` in `kcoderag-dev/hooks/grep_nudge.py`).
- Private implementation helpers use a leading underscore (`_unquote`, `_is_single_file_scope`, and `_is_local_only_scope`).

**Variables:**
- Module constants use uppercase `SCREAMING_SNAKE_CASE` (`NUDGE`, `SILENT_RES`, `MAX_COMMAND_CHARS`).
- Local collections and flags use descriptive lowercase `snake_case` names.

**Types:**
- Type annotations use built-in generics and union syntax compatible with modern Python (`list[str]`, `dict[str, Any]`, and `dict[...] | None`).
- Mapping-shaped inputs are typed with `collections.abc.Mapping`; heterogeneous hook payloads use `Any` at the boundary (`kcoderag-dev/hooks/grep_nudge.py`).

## Code Style

**Formatting:**
- No formatter configuration (`pyproject.toml`, `.prettierrc`, or equivalent) is present. Preserve the existing readable PEP 8-style layout and approximately 100-character lines.
- Use a shebang and module docstring for executable Python scripts, as in `kcoderag-dev/hooks/grep_nudge.py`.

**Linting:**
- No lint configuration or enforced lint command is detected. Keep imports standard-library-only where possible and avoid unused imports.

## Import Organization

**Order:**
1. Standard-library modules (`json`, `re`, `sys`, and `typing`).
2. No third-party or local imports are used by the hook.

**Path Aliases:**
- Not detected. Tests load the adjacent implementation explicitly with `importlib.util.spec_from_file_location` (`kcoderag-dev/hooks/test_grep_nudge.py`).

## Error Handling

**Patterns:**
- Hook boundaries fail open: `main()` catches malformed JSON and unexpected exceptions, returns exit code `0`, and emits no output (`kcoderag-dev/hooks/grep_nudge.py`).
- Classification helpers return neutral empty/false values for invalid input rather than raising.
- Keep the hook advisory and non-blocking; do not turn lookup nudges into command rejection.

## Logging

**Framework:** None detected.

**Patterns:**
- The hook writes only its JSON protocol response to stdout; tests print human-readable pass/fail diagnostics (`kcoderag-dev/hooks/test_grep_nudge.py`).
- Do not print diagnostics from the hook protocol path, because consumers interpret stdout as JSON.

## Comments

**When to Comment:**
- Use module and function docstrings to explain host payloads, fail-open behavior, and non-obvious parsing rules (`kcoderag-dev/hooks/grep_nudge.py`).
- Comments should document policy boundaries such as local-file exceptions and shell normalization, not restate simple expressions.

**JSDoc/TSDoc:**
- Not applicable; no JavaScript/TypeScript source is present.

## Function Design

**Size:** Keep parsing stages decomposed into small helpers; `shell_lookup_patterns` delegates token normalization and scope checks to private helpers.

**Parameters:** Validate external JSON values at the boundary with `isinstance` checks before processing; accept `Mapping[str, Any]` for decoded payloads.

**Return Values:** Prefer explicit typed neutral values (`False`, `[]`, or `None`) for non-matches. `hook_output` returns a protocol dictionary only when a nudge is warranted.

## Module Design

**Exports:** Functions and constants are module-level; there is no class hierarchy or package API layer.

**Barrel Files:** Not detected.

---

*Convention analysis: 2026-08-20*
