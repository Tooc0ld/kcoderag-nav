# KCodeRag Nav for Cursor

This private Cursor plugin provides one configured KCodeRag MCP server, a graph-first
navigation skill, and a compact always-on Cursor Rule. The bundled defaults select QA.
QA and Dev must never be configured at the same time.

## Private team marketplace

1. In the Cursor Dashboard, open **Plugins** and import the `Tooc0ld/kcoderag-nav`
   repository as a Team Marketplace.
2. Add `kcoderag-nav`, restrict Marketplace Access to the intended internal group, and
   set its installation mode to **Default Off**.
3. Developers install it from **Customize** using **project scope**.

Do not install this plugin in the `kcoderag-nav` distribution repository itself; doing so
would bias maintenance and verification searches toward its own packaged MCP client.

## Local development

Copy or link the generated `kcoderag-cursor` directory to:

```text
~/.cursor/plugins/local/kcoderag-nav
```

Then restart Cursor or run **Developer: Reload Window**. Keep this local development
install out of the distribution repository.

## Switch to Dev

Open **Customize**, find `kcoderag-nav`, and choose **Configure**. Replace
`KCODERAG_MCP_URL` and `KCODERAG_BEARER_TOKEN` together with the Dev profile. Restore
both QA values together when testing is complete. The package deliberately declares one
generic `kcoderag` MCP server, so QA and Dev cannot be enabled side by side.

## Why there is no Cursor hook

Cursor's `preToolUse` hook can allow, deny, or modify a tool call but cannot inject
advisory context before it runs. The always-on rule supplies the navigation reminder
without blocking local search. Local search remains valid for exact strings, uncommitted
edits, and explicit fallback when the index is unavailable or stale.

Generated package version: `0.1.2+cursor.a2fcb2d0bb341e8b`.
