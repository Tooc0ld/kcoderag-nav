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
    "MCP tools (prefix mcp__plugin_kcoderag-dev_kcoderag-dev__): search_code (find "
    "definitions / semantic search), get_call_chain (who calls / is called by), "
    "context (360° symbol view). Reserve Grep/Glob for verifying a specific "
    "already-located line's uncommitted edit, or for exact-string bulk replacement."
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
    re.compile(
        r"^\s*[\w./\\-]+\.(txt|json|yaml|yml|md|log|csv|exe|dll|so|"
        r"cpp|cxx|cc|c|h|hpp|hxx|inl|inc|proto|py|pyx|ts|tsx|js|jsx|"
        r"cs|go|rs|java|kt|lua|xml|ini|conf|cfg|toml|sql|sh|bat)\s*$",
        re.I,
    ),  # bare filename (code + common config exts)
    re.compile(r"TODO|FIXME|XXX|HACK", re.I),                    # comment markers
]
# Wildcard/bulk signal: .* (dot-star). NOTE: alternation | alone is NOT a bulk
# signal — "GetLevel|GetHP" or "KHomelandMgr|KMiniGameMgr" is a multi-symbol
# lookup and should nudge. Bare alternations of generic/control-flow words are
# still silenced via NON_SYMBOL below.
WILDCARD_RE = re.compile(r"\.\*")
# Symbol anchor: escaped-dot method call \. , :: qualifier, literal \b word
# boundary (single backslash + b, as ripgrep writes it), or call parens
# (escaped or not). A bare unescaped . is NOT an anchor (it's a wildcard).
ANCHOR_RE = re.compile(r"\\\.|::|\\b|\\?\(|\\?\)")
# Identifier-like token. First char is a Unicode letter/underscore ([^\W\d]) so
# CJK / non-ASCII symbol names (甄道士, 获取玩家信息, 家园系统) are recognized —
# this repo has many Chinese lua script names that are exactly what search_code
# semantic search is for. May be C++-qualified (KPlayer::GetLevel).
TOKEN_RE = re.compile(r"[^\W\d][\w:]*")
# Overly generic words / types / control flow — a lone occurrence isn't a symbol lookup.
NON_SYMBOL = {
    "txt", "json", "yaml", "md", "log", "csv", "exe", "dll", "cpp", "hpp", "lua", "h",
    "http", "https", "www", "com", "org", "true", "false", "null", "none",
    "if", "else", "for", "while", "return", "break", "continue", "switch", "case", "default", "do",
    "int", "char", "bool", "float", "double", "long", "short", "unsigned", "auto", "void", "const",
    "size", "count", "len", "length", "name", "type", "value", "key", "data", "file", "path", "id", "idx", "num",
}
# Declaration / definition keywords — their presence strongly implies a symbol
# lookup (esp. in .* -wildcard greps like "function.*Login" / "#define.*MAX_*").
# Matched with word boundaries so "default"/"defend" don't trip "def", etc.
KEYWORDS = ("def", "function", "class", "func", "fn", "method", "inline", "virtual", "override", "struct", "enum", "define")
KEYWORD_RES = [re.compile(r"\b" + kw + r"\b") for kw in KEYWORDS]


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
    if any(rx.search(low) for rx in KEYWORD_RES):
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
