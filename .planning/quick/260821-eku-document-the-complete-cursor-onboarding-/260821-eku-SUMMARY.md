---
quick_id: 260821-eku
status: complete
completed: 2026-08-21
implementation_commit: "e05aaa5; KCodeRag guide intentionally uncommitted"
---

# Quick Task 260821-eku Summary

Moved QA experience-guide ownership out of the plugin distribution repository and into the
KCodeRag service repository. The authoritative guide now covers Cursor onboarding and current
QA/Dev installation and update behavior; kcoderag-nav retains only a link and no local copy.

## Delivered

- Deleted `kcoderag-nav/MCP_QA_EXPERIENCE_GUIDE.md` and removed all local test dependencies on it.
- Updated the distribution README to link the authoritative KCodeRag guide on GitHub.
- Updated AGENTS/project policy to state that KCodeRag exclusively owns the guide and this
  repository does not retain a duplicate.
- Updated `D:/AIProgram/KCodeRag/MCP_QA_EXPERIENCE_GUIDE.md` with:
  - Cursor Team Marketplace admin import and GitHub App/access configuration;
  - developer project-scope QA install, reload, `kcoderag` server and tool verification;
  - Dev paired-variable configuration, uninstall, local development and Auto Refresh flows;
  - mutually exclusive QA/Dev semantics, Python 3.10+ launcher behavior, installer status/update,
    and asynchronous fail-open update awareness;
  - current Codex, Claude Code, Cursor, and pure-MCP update paths.
- Did not stage or commit the KCodeRag guide because that repository already contains a large,
  unrelated user-owned staged/unstaged worktree. Only the guide has a new unstaged diff from this task.
- The earlier local-guide commits `da858a3`/`58300c9` were superseded by the user ownership
  correction and the final deletion/relocation commit `e05aaa5`.

## Verification

- kcoderag-nav plan structure passed with 3 tasks and no errors/warnings.
- kcoderag-nav full unittest suite passed: 78 tests.
- `python scripts/generate_plugins.py --check`, native pre-commit, and `git diff --check` passed.
- KCodeRag guide onboarding/update contract passed; added lines contain no new internal URL, token,
  or Authorization value; guide-only `git diff --check` passed.

Implementation commits: `da858a3`, `58300c9`, `0f83a51`, `e05aaa5`.
