#!/usr/bin/env python3
"""PreToolUse hook: nudge toward KCodeRag MCP instead of grep/Glob for symbol lookup.

Non-blocking by design: only emits `additionalContext` advice and exits 0. It NEVER
denies a tool call (no exit 2, no permissionDecision=deny). The grep/Glob still
runs; the agent simply receives a tip to prefer the MCP tools next time.

Reads the hook JSON payload from stdin, inspects `tool_input.pattern`, and if the
pattern looks like a symbol or call-relation lookup, emits the nudge. Otherwise it
stays silent (exact-string/bulk-replace greps pass through untouched).

Standard library only — no third-party dependencies.
"""
import json
import re
import sys

NUDGE = (
    "Tip: this looks like a symbol or call-relation lookup. Prefer the KCodeRag "
    "MCP tools — mcp__kcoderag-dev__search_code (find definitions / semantic search), "
    "mcp__kcoderag-dev__get_call_chain (who calls / is called by), or "
    "mcp__kcoderag-dev__context (360° symbol view). Reserve Grep/Glob for verifying a "
    "specific already-located line's uncommitted edit, or for exact-string bulk "
    "replacement."
)

# Pure identifier, optionally C++-qualified with ::, e.g. KPlayer::GetLevel, getPlayerInfo
IDENT_RE = re.compile(r"^[A-Za-z_][\w:]*$")
KEYWORDS = ("def", "function", "class", "func", "fn", "method", "void", "static")


def looks_like_symbol_lookup(pattern: str) -> bool:
    """Heuristic: does this pattern look like a symbol/call-relation lookup?"""
    if not pattern or not isinstance(pattern, str):
        return False
    p = pattern.strip()
    if not p:
        return False
    if IDENT_RE.match(p):
        return True
    if "::" in p:
        return True
    low = p.lower()
    return any(kw in low for kw in KEYWORDS)


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        # Malformed/missing input: never block. Silently pass.
        return 0

    tool_input = data.get("tool_input") or {}
    pattern = ""
    if isinstance(tool_input, dict):
        pattern = tool_input.get("pattern") or ""

    if looks_like_symbol_lookup(pattern):
        sys.stdout.write(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "additionalContext": NUDGE,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
