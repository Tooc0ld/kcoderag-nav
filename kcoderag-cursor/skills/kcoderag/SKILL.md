---
name: kcoderag
description: Navigate code with read-only KCodeRag MCP lookups. Use for symbols, behavior, context, callers, callees, indexes, graph relations, dependencies, or change impact; use local search for exact text, current edits, or unavailable-index fallback.
---

<objective>
Use the installed KCodeRag QA knowledge graph for read-only structural code questions. Accept a
short action form or ordinary natural language, select the narrowest suitable MCP lookup, and read
the located source before relying on graph results because the graph is a snapshot.
</objective>

<quick_start>
Text after `$kcoderag` is a navigation intent, not a strict CLI flag or raw MCP JSON payload.
Support these concise forms:

```text
$kcoderag help
$kcoderag find <query>
$kcoderag context <symbol>
$kcoderag callers <symbol>
$kcoderag callees <symbol>
$kcoderag indexes
$kcoderag impact <symbol-or-change>
```

Natural language is equally valid, for example `$kcoderag 找到登录超时的实现` or
`$kcoderag 查看 SessionManager 的调用方`.

If the invocation contains no actionable request or asks for help, return the usage block above
with one short example for each action before any MCP call. If `find`, `context`, `callers`,
`callees`, or `impact` has no target, ask one concise question for the missing target.
</quick_start>

<routing>
| User action | Tool route |
| --- | --- |
| `find <query>` or a symbol/behavior question | Start with `search_code` |
| `context <symbol>` | Resolve ambiguity with `search_code` if needed, then call `context` |
| `callers <symbol>` | Call `get_call_chain` in the caller direction exposed by the host schema |
| `callees <symbol>` | Call `get_call_chain` in the callee direction exposed by the host schema |
| `indexes` | Call `list_indexes` |
| `impact <symbol-or-change>` | Combine `search_code`, `context`, and `get_call_chain`; use `cypher` only for a custom read-only relation |
| Exact text in current local edits | Use local Read/Grep/Glob |

Tool names and parameter schemas can differ by host. Use the schema exposed by the current host;
do not ask the user to construct MCP JSON.
</routing>

<process>
1. Interpret the action or infer it from natural language.
2. Ask for a target only when the chosen action requires one and none was provided.
3. Use `semantic` or `hybrid` search only after `list_indexes` reliably confirms a usable current index.
   Otherwise use `keyword`, then `context` or `get_call_chain` for structural fallback.
4. Ask the narrowest useful graph question, inspect the best match, and traverse relationships only
   when needed.
5. Read the located source before acting. If graph data is unavailable or stale, fall back to local
   search and state that the graph result could not be confirmed.
</process>

<boundaries>
This Skill is read-only. It does not change files, manage installation lifecycle, or send feedback.
Use `cypher` only for read-only graph relations and prefer the standard tools when they answer the
request directly.
</boundaries>

<success_criteria>
- A bare or help invocation returns actionable usage without calling MCP.
- A concise action and natural-language request route to the same appropriate read-only tool.
- Missing required targets produce one focused clarification rather than a guessed query.
- Results identify the graph as a snapshot and verify located code locally when correctness matters.
</success_criteria>
