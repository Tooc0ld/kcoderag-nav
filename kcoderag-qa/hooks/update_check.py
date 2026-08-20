#!/usr/bin/env python3
"""Bounded, fail-open update lookup for the first relevant PreToolUse event."""

from __future__ import annotations

import json
import os
import re
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any


UPDATE_URL = (
    "https://raw.githubusercontent.com/Tooc0ld/kcoderag-nav/master/kcoderag-update.json"
)
UPDATE_TIMEOUT_SECONDS = 1.5
MAX_RESPONSE_BYTES = 8 * 1024
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
    del cache_root, now  # Reserved test seams used by the bounded state layer.
    try:
        if os.environ.get("KCODERAG_NAV_UPDATE_CHECK") == "0":
            return None
        if (
            environment not in {"qa", "dev"}
            or VERSION_RE.fullmatch(current_version) is None
            or not _is_relevant_pretooluse(data)
        ):
            return None
        versions = _fetch_versions(opener)
        remote_version = versions.get(environment) if versions is not None else None
        if remote_version is None or remote_version == current_version:
            return None
        return _notice(environment, current_version, remote_version)
    except Exception:
        return None
