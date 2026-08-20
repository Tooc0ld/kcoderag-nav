---
name: code-lookup-discipline
description: Choose KCodeRag MCP tools over local text search for structural code navigation. Apply when finding symbols, definitions, callers, callees, dependencies, cross-language links, or change impact; use local search for exact text and uncommitted edits.
---

# KCodeRag Code Navigation

Use the installed KCodeRag knowledge graph as the first stop for structural questions.
Tool namespaces differ between Claude Code and Codex, so call the tool names exposed by
the current host instead of inventing a fully qualified prefix.

This package supplies the **{{display_name}}** environment.

{{routing_policy}}

## Choose the right lookup

| Question | First choice |
|---|---|
| Where is a symbol defined? | `search_code` |
| Which symbol matches a behavior or concept? | `search_code` semantic search |
| What surrounds this symbol? | `context` |
| Who calls it, or what does it call? | `get_call_chain` |
| What may break if it changes? | `get_call_chain` callers, then `context` |
| Is the graph/index available? | `list_indexes` |
| What does a custom read-only graph traversal show? | `cypher` |
| Where is an exact string in current local edits? | local Read/Grep/Glob |

## Workflow

1. Resolve the target with `search_code`.
2. Inspect the best match with `context`.
3. Traverse callers or callees with `get_call_chain` when relations matter.
4. Read the located source before editing, because the graph is a snapshot.

If a graph lookup unexpectedly returns nothing, call `list_indexes` and refine the query.
Fall back to local search when the index is unavailable, the snapshot is stale, or the task is
an exact-string operation. State that fallback explicitly when it affects confidence.
