#!/usr/bin/env python3
"""Advise Claude Code and Codex to use KCodeRag for structural lookups.

The hook is intentionally non-blocking. Claude Code supplies ``tool_input.pattern``
for Grep/Glob. Codex exposes shell and unified-exec calls as ``Bash`` and supplies
``tool_input.command``. Both payloads are normalized into lookup patterns before
the existing symbol heuristic runs.

Standard library only; malformed input always fails open.
"""

import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import time
from collections.abc import Mapping
from typing import Any

ROUTING_GUIDANCE = " When QA and Dev are both installed, default to QA; use only Dev for explicit Dev intent; query both only for explicit comparison; never fall back when a selected environment is unreachable."
NUDGE = (
    "Tip: this looks like a symbol or call-relation lookup. Prefer the installed "
    "KCodeRag MCP tools: search_code (definitions / semantic search), "
    "get_call_chain (callers / callees), and context (360-degree symbol view). "
    "Reserve text search for verifying already-located uncommitted edits or exact-string "
    "bulk replacement."
) + ROUTING_GUIDANCE

SILENT_RES = [
    re.compile(r"^s/(?:\\.|[^/\\\r\n])*/(?:\\.|[^/\\\r\n])*/[gimsx]*$"),
    re.compile(r"[^=!<>]?={1,2}[^=]"),
    re.compile(
        r"^\s*[\w./\\-]+\.(txt|json|yaml|yml|md|log|csv|exe|dll|so|"
        r"cpp|cxx|cc|c|h|hpp|hxx|inl|inc|proto|py|pyx|ts|tsx|js|jsx|"
        r"cs|go|rs|java|kt|lua|xml|ini|conf|cfg|toml|sql|sh|bat)\s*$",
        re.I,
    ),
    re.compile(r"TODO|FIXME|XXX|HACK", re.I),
]
WILDCARD_RE = re.compile(r"\.\*")
ANCHOR_RE = re.compile(r"\\\.|::|\\b|\\?\(|\\?\)")
TOKEN_RE = re.compile(r"[^\W\d][\w:]*")
NON_SYMBOL = {
    "txt",
    "json",
    "yaml",
    "md",
    "log",
    "csv",
    "exe",
    "dll",
    "cpp",
    "hpp",
    "lua",
    "py",
    "ts",
    "src",
    "test",
    "tests",
    "http",
    "https",
    "www",
    "com",
    "org",
    "true",
    "false",
    "null",
    "none",
    "if",
    "else",
    "for",
    "while",
    "return",
    "break",
    "continue",
    "switch",
    "case",
    "default",
    "do",
    "int",
    "char",
    "bool",
    "float",
    "double",
    "long",
    "short",
    "unsigned",
    "auto",
    "void",
    "const",
    "size",
    "count",
    "len",
    "length",
    "name",
    "type",
    "value",
    "key",
    "data",
    "file",
    "path",
    "id",
    "idx",
    "num",
}
KEYWORDS = (
    "def",
    "function",
    "class",
    "func",
    "fn",
    "method",
    "inline",
    "virtual",
    "override",
    "struct",
    "enum",
    "define",
)
KEYWORD_RES = [re.compile(r"\b" + keyword + r"\b") for keyword in KEYWORDS]

TOKENIZE_RE = re.compile(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+''')
MAX_COMMAND_CHARS = 65_536
MAX_INPUT_CHARS = 131_072
MAX_IDENTITY_CHARS = 131_072
DEDUP_DIRECTORY_ENV = "KCODERAG_NAV_DEDUP_DIR"
DEDUP_TTL_SECONDS = 120
DEDUP_BUCKET_SECONDS = 2
DEDUP_CLEANUP_LIMIT = 8
MARKER_NAME_RE = re.compile(r"^[0-9a-f]{64}\.marker$")
LOCAL_FILE_RE = re.compile(
    r"\.(?:cpp|cxx|cc|c|h|hpp|hxx|inl|inc|proto|py|pyx|ts|tsx|js|jsx|"
    r"cs|go|rs|java|kt|lua)$",
    re.I,
)
SEARCH_TOOLS = {"rg", "ripgrep", "grep", "findstr", "select-string", "get-childitem", "gci"}
LOCAL_TEXT_DIRS = {"log", "logs"}
SHELL_WRAPPER_OPTIONS = {
    "cmd": {"/c", "/k"},
    "powershell": {"-c", "-command"},
    "pwsh": {"-c", "-command"},
}
PATTERN_OPTIONS = {"-e", "--regexp", "-pattern"}
FILTER_OPTIONS = {"-g", "--glob", "--iglob", "-filter", "-include"}
SHORT_VALUE_OPTIONS = {"-A", "-B", "-C", "-E", "-f", "-j", "-m", "-M", "-r", "-t", "-T"}
VALUE_OPTIONS = {
    "--after-context",
    "--before-context",
    "--context",
    "--color",
    "--colors",
    "--encoding",
    "--engine",
    "--file",
    "--max-count",
    "--max-depth",
    "--max-filesize",
    "-context",
    "-encoding",
    "-literalpath",
    "-path",
    "--pre",
    "--pre-glob",
    "--sort",
    "--sortr",
    "--threads",
    "--type",
    "--type-not",
}


def looks_like_symbol_lookup(pattern: str) -> bool:
    """Return whether a text or glob pattern looks structural rather than mechanical."""
    if not pattern or not isinstance(pattern, str):
        return False
    candidate = pattern.strip()
    if not candidate or len(candidate) < 2:
        return False
    if any(regex.search(candidate) for regex in SILENT_RES):
        return False
    lowered = candidate.lower()
    if any(regex.search(lowered) for regex in KEYWORD_RES):
        return True
    if WILDCARD_RE.search(candidate) and not ANCHOR_RE.search(candidate):
        return False
    for token in TOKEN_RE.findall(candidate):
        normalized = token.strip(":")
        if len(normalized) < 2 or re.fullmatch(r"[A-Za-z]", normalized):
            continue
        if normalized.lower() in NON_SYMBOL:
            continue
        return True
    return False


def _unquote(token: str) -> str:
    token = token.strip().rstrip(";|&")
    if len(token) >= 2 and token[0] == token[-1] and token[0] in {"'", '"'}:
        return token[1:-1]
    return token


def _is_single_file_scope(scopes: list[str]) -> bool:
    """Return whether a search is already constrained to one concrete source file."""
    if len(scopes) != 1:
        return False
    scope = scopes[0]
    return not any(marker in scope for marker in "*?[]") and LOCAL_FILE_RE.search(scope) is not None


def _is_local_text_scope(scopes: list[str]) -> bool:
    """Return whether a search is explicitly scoped to generated/runtime text."""
    if len(scopes) != 1:
        return False
    parts = scopes[0].replace("\\", "/").lower().split("/")
    return any(part in LOCAL_TEXT_DIRS for part in parts)


def _is_local_only_scope(scopes: list[str]) -> bool:
    return _is_single_file_scope(scopes) or _is_local_text_scope(scopes)


def shell_lookup_patterns(command: str) -> list[str]:
    """Extract likely search/glob patterns from common POSIX and PowerShell commands."""
    if not isinstance(command, str) or not command.strip() or len(command) > MAX_COMMAND_CHARS:
        return []

    tokens = [_unquote(token) for token in TOKENIZE_RE.findall(command)]
    lowered = [token.lower() for token in tokens]
    if lowered:
        wrapper = lowered[0].rsplit("/", 1)[-1].rsplit("\\", 1)[-1].removesuffix(".exe")
        wrapper_options = SHELL_WRAPPER_OPTIONS.get(wrapper)
        if wrapper_options:
            for index, option in enumerate(lowered[1:], start=1):
                if option in wrapper_options and index + 1 < len(tokens):
                    return shell_lookup_patterns(" ".join(tokens[index + 1 :]))
    start = -1
    tool = ""
    for index, token in enumerate(lowered):
        executable = token.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].removesuffix(".exe")
        if executable in SEARCH_TOOLS:
            start = index + 1
            tool = executable
            break
        if executable == "git" and index + 1 < len(lowered) and lowered[index + 1] == "grep":
            start = index + 2
            tool = "grep"
            break
    if start < 0:
        return []

    explicit_patterns: list[str] = []
    glob_patterns: list[str] = []
    positional: list[str] = []
    index = start
    options_enabled = True
    while index < len(tokens):
        token = tokens[index]
        option = lowered[index]
        if options_enabled and option == "--":
            options_enabled = False
            index += 1
            continue
        if not options_enabled:
            positional.append(token)
            index += 1
            continue
        if option in PATTERN_OPTIONS and index + 1 < len(tokens):
            explicit_patterns.append(tokens[index + 1])
            index += 2
            continue
        if tool in {"rg", "ripgrep", "grep"} and option.startswith("-e") and len(token) > 2:
            explicit_patterns.append(token[2:])
            index += 1
            continue
        if option in FILTER_OPTIONS and index + 1 < len(tokens):
            glob_patterns.append(tokens[index + 1])
            index += 2
            continue
        if tool in {"rg", "ripgrep"} and option.startswith("-g") and len(token) > 2:
            glob_patterns.append(_unquote(token[2:]))
            index += 1
            continue
        if (token in SHORT_VALUE_OPTIONS or option in VALUE_OPTIONS) and index + 1 < len(tokens):
            index += 2
            continue
        if option.startswith("--glob=") or option.startswith("--iglob="):
            glob_patterns.append(token.split("=", 1)[1])
            index += 1
            continue
        if option.startswith("--regexp="):
            explicit_patterns.append(token.split("=", 1)[1])
            index += 1
            continue
        if tool == "findstr" and option.startswith("/c:") and len(token) > 3:
            explicit_patterns.append(_unquote(token[3:]))
            index += 1
            continue
        if option.startswith("-") or (tool == "findstr" and option.startswith("/")):
            index += 1
            continue
        positional.append(token)
        index += 1

    if explicit_patterns:
        if _is_local_only_scope(positional):
            return []
        return explicit_patterns
    if tool in {"get-childitem", "gci"}:
        return glob_patterns[:1] or positional[:1]
    if "--files" in lowered:
        return glob_patterns
    if _is_local_only_scope(positional[1:]):
        return []
    return positional[:1] or glob_patterns[:1]


def lookup_patterns(tool_input: Mapping[str, Any]) -> list[str]:
    """Normalize Claude Code Grep/Glob and Codex Bash payloads."""
    pattern = tool_input.get("pattern")
    if isinstance(pattern, str) and pattern:
        return [pattern]
    command = tool_input.get("command")
    if isinstance(command, list):
        command = " ".join(str(part) for part in command)
    return shell_lookup_patterns(command) if isinstance(command, str) else []


def hook_output(data: Mapping[str, Any]) -> dict[str, Any] | None:
    """Build advisory hook output, or return None when the call should pass silently."""
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, Mapping):
        return None
    if not any(looks_like_symbol_lookup(pattern) for pattern in lookup_patterns(tool_input)):
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": NUDGE,
        }
    }


def _identity_text(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > 512:
        raise ValueError("invalid identity")
    return value


def _identity_digest(data: Mapping[str, Any]) -> str:
    """Hash host identity without persisting raw tool input."""
    event = _identity_text(data, "hook_event_name") or _identity_text(data, "hookEventName")
    event = event or "PreToolUse"
    session_id = _identity_text(data, "session_id")
    turn_id = _identity_text(data, "turn_id")
    tool_use_id = _identity_text(data, "tool_use_id")
    if tool_use_id:
        identity: object = [event, session_id, turn_id, tool_use_id]
    else:
        tool_name = _identity_text(data, "tool_name")
        tool_input = data.get("tool_input")
        if not isinstance(tool_input, Mapping):
            raise ValueError("invalid tool input")
        identity = [
            event,
            session_id,
            turn_id,
            tool_name,
            tool_input,
            int(time.time() // DEDUP_BUCKET_SECONDS),
        ]
    encoded = json.dumps(
        identity,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAX_IDENTITY_CHARS:
        raise ValueError("identity too large")
    return hashlib.sha256(encoded).hexdigest()


def _dedup_directory() -> str:
    override = os.environ.get(DEDUP_DIRECTORY_ENV)
    if override is not None:
        if not override or len(override) > 4096:
            raise OSError("invalid dedup directory")
        directory = override
    else:
        directory = os.path.join(tempfile.gettempdir(), "kcoderag-nav-hook-dedup-v1")
    if os.path.islink(directory):
        raise OSError("dedup directory is a symlink")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if not os.path.isdir(directory):
        raise OSError("dedup path is not a directory")
    return directory


def _cleanup_stale_markers(directory: str) -> None:
    now = time.time()
    inspected = 0
    with os.scandir(directory) as entries:
        for entry in entries:
            inspected += 1
            if inspected > DEDUP_CLEANUP_LIMIT:
                break
            if not MARKER_NAME_RE.fullmatch(entry.name):
                continue
            details = entry.stat(follow_symlinks=False)
            if not stat.S_ISREG(details.st_mode):
                continue
            if now - details.st_mtime > DEDUP_TTL_SECONDS:
                os.unlink(entry.path)


def _claim_nudge(data: Mapping[str, Any]) -> bool:
    """Atomically claim output ownership; every failure stays fail-open and silent."""
    try:
        digest = _identity_digest(data)
        directory = _dedup_directory()
        _cleanup_stale_markers(directory)
        marker = os.path.join(directory, f"{digest}.marker")
        descriptor = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        return True
    except Exception:
        return False


def main() -> int:
    try:
        raw = sys.stdin.read(MAX_INPUT_CHARS + 1)
        if len(raw) > MAX_INPUT_CHARS:
            return 0
        data = json.loads(raw) if raw.strip() else {}
        output = hook_output(data) if isinstance(data, Mapping) else None
    except Exception:
        return 0
    if output is not None and _claim_nudge(data):
        sys.stdout.write(json.dumps(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
