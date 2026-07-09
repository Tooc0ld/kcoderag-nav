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

# --- Heuristic: does this grep pattern look like a symbol/call-relation lookup? ---
# Strategy: real "find this symbol" greps usually anchor on the symbol somehow — a
# bare identifier, a C++ :: qualifier, a word boundary \b, or call parens — even when
# regex chars are sprinkled in (\bGetLevel\b, GetLevel\s*\(, \.GetLevel\(). We extract
# identifier-like tokens and nudge if any looks like a real symbol. We stay silent for
# bulk/wildcard patterns (foo.bar.*, Foo.*Bar), replacements (s/old/new/g), assignments
# (x = 1), filenames, and TODO comments.

# Hard-silent signals: these are never symbol lookups.
SILENT_RES = [
    re.compile(r"^s/.+/.+/[gimsx]*$"),                          # sed-style replace s/old/new/g
    re.compile(r"[^=!<>]?={1,2}[^=]"),                           # assignment / equality compare
    re.compile(r"^\s*[\w./\\-]+\.(txt|json|yaml|md|log|csv|exe|dll|cpp|h|hpp|lua)\s*$", re.I),  # bare filename
    re.compile(r"TODO|FIXME|XXX|HACK", re.I),                    # comment markers
]
# Wildcard/bulk signal: .* or alternation |
WILDCARD_RE = re.compile(r"\.\*|\|")
# Symbol anchor: escaped-dot method call \. , :: qualifier, literal \b word boundary,
# or call parens (escaped or not). A bare unescaped . is NOT an anchor (it's a wildcard).
ANCHOR_RE = re.compile(r"\\\.|::|\\\\b|\\?\(|\\?\)")
# Identifier-like token (may be C++-qualified: KPlayer::GetLevel)
TOKEN_RE = re.compile(r"[A-Za-z_][\w:]*(?:::[A-Za-z_][\w:]*)?")
# Overly generic words / types / control flow — a lone occurrence isn't a symbol lookup.
NON_SYMBOL = {
    "txt", "json", "yaml", "md", "log", "csv", "exe", "dll", "cpp", "hpp", "lua", "h",
    "http", "https", "www", "com", "org", "true", "false", "null", "none",
    "if", "else", "for", "while", "return", "break", "continue", "switch", "case", "default", "do",
    "int", "char", "bool", "float", "double", "long", "short", "unsigned", "auto", "void", "const",
    "size", "count", "len", "length", "name", "type", "value", "key", "data", "file", "path", "id", "idx", "num",
}
# Declaration / definition keywords — their presence strongly implies a symbol lookup.
KEYWORDS = ("def", "function", "class", "func", "fn", "method", "inline", "virtual", "override", "struct", "enum")


def looks_like_symbol_lookup(pattern: str) -> bool:
    """Heuristic: does this pattern look like a symbol/call-relation lookup?"""
    if not pattern or not isinstance(pattern, str):
        return False
    p = pattern.strip()
    if not p or len(p) < 2:
        return False
    for rx in SILENT_RES:
        if rx.search(p):
            return False
    low = p.lower()
    if any(kw in low for kw in KEYWORDS):
        return True
    # Wildcard pattern with no symbol anchor → bulk/exact-string, stay silent.
    if WILDCARD_RE.search(p) and not ANCHOR_RE.search(p):
        return False
    # Otherwise: does it contain at least one identifier-like token that looks like a symbol?
    for tok in TOKEN_RE.findall(p):
        t = tok.strip(":")
        if len(t) < 2 or re.fullmatch(r"[A-Za-z]", t):
            continue
        if t.lower() in NON_SYMBOL:
            continue
        return True
    return False


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
