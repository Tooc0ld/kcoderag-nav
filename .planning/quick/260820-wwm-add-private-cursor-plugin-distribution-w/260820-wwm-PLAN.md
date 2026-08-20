---
quick_id: 260820-wwm
status: complete
description: Add private Cursor plugin distribution with project-scoped installation, single-environment configuration, shared skill, Cursor rule, generated artifacts, tests, and documentation
---

# Quick Task 260820-wwm

## Goal

Generate one private Cursor Plugin that exposes exactly one configured KCodeRag MCP server,
defaults to the existing QA profile for the current internal install-and-use stage, and can be
reconfigured to Dev without installing a second plugin.

## Locked decisions

- Cursor uses a single `kcoderag-nav` plugin, so QA and Dev cannot be simultaneously active.
- Distribution targets project-scope installs from a private Team Marketplace or local development
  from `~/.cursor/plugins/local`; public Cursor Marketplace submission is out of scope.
- Reuse the existing host-neutral skill. Use a compact always-on Cursor Rule instead of adapting the
  Claude/Codex `PreToolUse` hook, because Cursor cannot inject advisory context from `preToolUse`.
- Preserve the existing internal-stage credential posture: generated variable defaults select QA;
  Dev testers replace the URL and Bearer values through Cursor plugin configuration.
- Do not install the generated plugin into this repository, and do not touch unrelated worktree files.

## Tasks

1. Extend the canonical generator with a self-contained `kcoderag-cursor` package and root
   `.cursor-plugin/marketplace.json`, including Cursor manifest variables, one MCP server, shared
   skill, compact rule, and private-install README.
2. Add generation and policy regressions for Cursor paths, one-server mutual exclusion, QA defaults,
   secret-safe diagnostics, and absence of the incompatible Claude/Codex hook.
3. Update root documentation and project context, regenerate outputs, run the complete offline suite,
   and record the quick-task result without changing the existing roadmap.

## Verification

```text
python -B scripts/generate_plugins.py --write
python -B scripts/generate_plugins.py --check
python -B -m unittest discover -s tests -p "test_*.py" -v
python -B kcoderag-qa/hooks/test_grep_nudge.py
python -B kcoderag-dev/hooks/test_grep_nudge.py
git diff --check
```

## Remaining discussion after implementation

- Whether to keep internal Bearer defaults long term or move Team Marketplace installs to
  administrator-supplied variables.
- Whether a future Cursor Cloud Agent deployment needs a secure route into the internal MCP network.
