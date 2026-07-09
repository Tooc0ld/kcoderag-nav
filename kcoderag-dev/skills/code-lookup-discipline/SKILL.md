---
name: code-lookup-discipline
description: Decision table for when to use KCodeRag MCP tools vs grep/Read when looking up code in this repo. Apply whenever searching for symbols, definitions, callers, callees, dependencies, or impact.
---

# Code Lookup Discipline: MCP-first, grep-last

This codebase has a pre-built Neo4j knowledge graph exposed via the KCodeRag MCP
tools. It is a daily snapshot (~06:00 parse) and is **more complete than grepping**
for structural questions.

## Decision table

| You want to... | Use this | Why |
|---|---|---|
| Find where a function/class/macro is defined | `mcp__kcoderag-dev__search_code` | Symbol-level, faster than grep, understands cross-file |
| Find symbols by behavior ("get player level") | `mcp__kcoderag-dev__search_code` (semantic) | grep can't do semantic search |
| See a symbol's 360° view (signature, relations, module) | `mcp__kcoderag-dev__context` | Structured, one call vs grep+read+grep |
| Find who calls X / what X calls | `mcp__kcoderag-dev__get_call_chain` | Walks the call graph, crosses Lua↔C++ |
| Impact analysis before editing X | `mcp__kcoderag-dev__get_call_chain` (callers) | Complete caller set in one call |
| Count/aggregate (e.g. functions per module) | `mcp__kcoderag-dev__cypher` | grep can't aggregate the graph |
| Custom multi-hop graph traversal | `mcp__kcoderag-dev__cypher` | Graph query grep can't express |
| Verify a specific line's uncommitted edit | Read / Grep on that file | Graph is a snapshot; live edits need the file |
| Exact-string bulk find-and-replace | Grep | Mechanical text op, not a structural query |

## Rule of thumb

- **Structural question** (definition, caller, callee, dependency, impact, type,
  module) → MCP tool first.
- **Textual/local question** (a specific uncommitted edit, an exact string to
  replace) → Read/Grep.

When an MCP tool returns nothing unexpectedly, call `mcp__kcoderag-dev__list_indexes`
to confirm the graph/index is healthy **before** falling back to grep.
