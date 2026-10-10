---
name: kcoderag-dashboard
description: Open the KCodeRag QA dashboard or a specific dashboard/build URL supplied by the user. Use when the user asks to view the QA dashboard or a build page.
---

# KCodeRag Dashboard

For an exact `/kcoderag-dashboard` or `$kcoderag-dashboard` command (optionally followed
by one HTTP(S) URL), installed Claude/kscc, Codex, and Cursor input hooks can request
the local default browser directly and consume the input before a model call.
The hook must be enabled/trusted by the host. If this Skill reaches the model, follow
the fallback below; do not claim the direct hook ran. OpenCode and ZCode currently
keep this manual fallback. Remote/headless hooks cannot open the user's local browser.

The default QA dashboard is [KCodeRag QA dashboard](http://10.11.39.59:30107/).
Use that address when the user asks to open the QA dashboard. When the user explicitly supplies
a dashboard or build HTTP(S) URL, preserve and open that exact URL instead. Do not guess build IDs
or derive a dashboard address by changing an MCP endpoint or port.

Use a browser/open tool available in the current host to show the selected page. Follow that
tool's supported interface; this Skill works across Codex, Claude Code, Cursor, OpenCode, and
ZCode and does not require a particular host's tool. If no such tool is available or opening fails,
provide the selected address as a clickable Markdown link and say that it has not been opened.
Do not read MCP configuration or tokens, call MCP tools, or run shell commands just to open a page.

Opening the page permits viewing it read-only. It does not authorize retrying, cancelling,
activating, deleting, or otherwise changing a build or deployment. Report only what was actually
opened or observed; a page opening successfully is not proof that deployment, graph validation,
or vector generation has completed.
