#!/usr/bin/env python3
"""Bounded, fail-open update lookup for the first relevant PreToolUse event."""

from __future__ import annotations

import json
import hashlib
import math
import os
import re
import tempfile
import time
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any


UPDATE_URL = (
    "https://raw.githubusercontent.com/Tooc0ld/kcoderag-nav/master/kcoderag-update.json"
)
UPDATE_TIMEOUT_SECONDS = 1.5
MAX_RESPONSE_BYTES = 8 * 1024
CACHE_TTL_SECONDS = 24 * 60 * 60
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+\+codex\.[0-9a-f]{16}$")
RELEVANT_TOOLS = {"Grep", "Glob", "Bash"}


def _is_relevant_pretooluse(data: Mapping[str, Any]) -> bool:
    tool_name = data.get("tool_name")
    return tool_name in RELEVANT_TOOLS and isinstance(data.get("tool_input"), Mapping)


def _validated_versions(body: bytes) -> dict[str, str] | None:
    try:
        document = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(document, dict) or set(document) != {
        "schema_version",
        "repository",
        "channel",
        "versions",
    }:
        return None
    versions = document.get("versions")
    if (
        document.get("schema_version") != 1
        or document.get("repository") != "Tooc0ld/kcoderag-nav"
        or document.get("channel") != "master"
        or not isinstance(versions, dict)
        or set(versions) != {"qa", "dev"}
        or not all(
            isinstance(value, str) and VERSION_RE.fullmatch(value)
            for value in versions.values()
        )
    ):
        return None
    return {"qa": versions["qa"], "dev": versions["dev"]}


def _fetch_versions(opener: Callable[..., Any] | None) -> dict[str, str] | None:
    request = urllib.request.Request(
        UPDATE_URL,
        headers={"Accept": "application/json", "User-Agent": "kcoderag-nav-update-check/1"},
    )
    open_url = opener or urllib.request.urlopen
    with open_url(request, timeout=UPDATE_TIMEOUT_SECONDS) as response:
        if getattr(response, "status", 200) != 200 or response.geturl() != UPDATE_URL:
            return None
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        return None
    return _validated_versions(body)


def _notice(environment: str, current_version: str, remote_version: str) -> str:
    return (
        f"KCodeRag {environment.upper()} update available: {current_version} -> "
        f"{remote_version}. Ask the user before running "
        f"python scripts/update_plugin.py --host <codex|claude> --environment {environment}; "
        "do not update automatically. Start a new session after updating."
    )


def _default_cache_root() -> Path:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Local") / "kcoderag-nav"
    base = os.environ.get("XDG_CACHE_HOME")
    return (Path(base) if base else Path.home() / ".cache") / "kcoderag-nav"


def _explicit_session_key(data: Mapping[str, Any], environment: str) -> str | None:
    for field in ("session_id", "thread_id", "conversation_id"):
        raw = data.get(field)
        if isinstance(raw, bool) or not isinstance(raw, (str, int)):
            continue
        value = str(raw).strip()[:512]
        if value:
            material = f"{environment}\0{field}\0{value}".encode("utf-8", errors="replace")
            return hashlib.sha256(material).hexdigest()
    return None


def _claim_session(cache_root: Path, session_key: str) -> bool:
    directory = cache_root / "sessions"
    directory.mkdir(parents=True, exist_ok=True)
    marker = directory / f"session-{session_key}.seen"
    try:
        descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    os.close(descriptor)
    return True


def _read_cache(cache_root: Path) -> tuple[float, dict[str, str]] | None:
    path = cache_root / "remote-cache.json"
    try:
        with path.open("rb") as handle:
            body = handle.read(MAX_RESPONSE_BYTES + 1)
    except FileNotFoundError:
        return None
    if len(body) > MAX_RESPONSE_BYTES:
        return None
    try:
        document = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(document, dict) or set(document) != {
        "schema_version",
        "checked_at",
        "versions",
    }:
        return None
    checked_at = document.get("checked_at")
    versions = document.get("versions")
    if (
        document.get("schema_version") != 1
        or isinstance(checked_at, bool)
        or not isinstance(checked_at, (int, float))
        or not math.isfinite(float(checked_at))
        or float(checked_at) < 0
        or not isinstance(versions, dict)
        or set(versions) != {"qa", "dev"}
        or not all(
            isinstance(value, str) and VERSION_RE.fullmatch(value)
            for value in versions.values()
        )
    ):
        return None
    return float(checked_at), {"qa": versions["qa"], "dev": versions["dev"]}


def _write_cache(cache_root: Path, checked_at: float, versions: dict[str, str]) -> None:
    cache_root.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(
            {"schema_version": 1, "checked_at": checked_at, "versions": versions},
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".remote-cache-", dir=cache_root)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, cache_root / "remote-cache.json")
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _now(clock: Callable[[], float] | None) -> float:
    value = float(clock() if clock is not None else time.time())
    if not math.isfinite(value) or value < 0:
        raise ValueError("invalid clock")
    return value


def maybe_update_notice(
    data: Mapping[str, Any],
    environment: str,
    current_version: str,
    *,
    cache_root: Path | None = None,
    now: Callable[[], float] | None = None,
    opener: Callable[..., Any] | None = None,
) -> str | None:
    """Return a locally rendered advisory for a validated different version; never raise."""
    try:
        if os.environ.get("KCODERAG_NAV_UPDATE_CHECK") == "0":
            return None
        if (
            environment not in {"qa", "dev"}
            or VERSION_RE.fullmatch(current_version) is None
            or not _is_relevant_pretooluse(data)
        ):
            return None
        root = cache_root or _default_cache_root()
        session_key = _explicit_session_key(data, environment)
        if session_key is None or not _claim_session(root, session_key):
            return None
        checked_at = _now(now)
        cached = _read_cache(root)
        if cached is not None and 0 <= checked_at - cached[0] < CACHE_TTL_SECONDS:
            versions = cached[1]
        else:
            versions = _fetch_versions(opener)
            if versions is not None:
                _write_cache(root, checked_at, versions)
        remote_version = versions.get(environment) if versions is not None else None
        if remote_version is None or remote_version == current_version:
            return None
        return _notice(environment, current_version, remote_version)
    except Exception:
        return None
