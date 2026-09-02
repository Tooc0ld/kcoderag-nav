---
name: kcoderag
description: Navigate code with read-only KCodeRag MCP lookups. Use for symbols, behavior, context, callers, callees, indexes, graph relations, dependencies, or change impact; use local search for exact text, current edits, or unavailable-index fallback.
---

# KCodeRag Navigation

Use the installed KCodeRag knowledge graph for structural code questions. Tool
names differ by host, so use the names exposed by the current host.

This package supplies the **KCodeRag QA** environment.

## QA routing

Use the installed KCodeRag QA service. If its graph data is unavailable or stale,
fall back to local search and say that the graph result could not be confirmed.

## Route the lookup

| Need | Use |
| --- | --- |
| Find a symbol or behavior | `search_code` |
| Inspect a symbol in context | `context` |
| Trace callers or callees | `get_call_chain` |
| Check available projects or indexes | `list_indexes` |
| Traverse custom read-only graph relations | `cypher` |
| Find exact text in current local edits | local Read/Grep/Glob |

Use `semantic` or `hybrid` search only after `list_indexes` reliably confirms a usable current index.
Otherwise use `keyword`, then `context` or `get_call_chain` for structural fallback.

## Workflow

1. Ask the narrowest useful structural question.
2. Locate candidates with `search_code` and inspect the best match with `context`.
3. Traverse relationships with `get_call_chain` or `cypher` when needed.
4. Read the located source before acting because the graph is a snapshot.

Fall back to local search when the index is unavailable or stale, or when the
request is literal text search. State the fallback when it affects confidence.
This Skill does not change files, manage installation lifecycle, or send feedback.
