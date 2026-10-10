---
type: quick
status: complete
date: 2026-10-10
---

# Dashboard input without model invocation

Implemented exact `/kcoderag-dashboard`, `$kcoderag-dashboard`, and bare-command handling with an optional HTTP(S) URL. Claude/kscc and Codex use UserPromptSubmit; Cursor uses beforeSubmitPrompt. The synchronous Node runtime requests the default browser and consumes the input. Unrelated/malformed input stays fail-open; a recognized command that cannot launch a browser returns a manual link without inference. OpenCode and ZCode retain the manual Skill.

The shared runtime bounds stdin and launch time, keeps the URL out of shell program text, rejects credentials/control characters and non-HTTP schemes, uses hidden PowerShell 7 on Windows, and falls back in SSH/headless sessions. Claude/Codex reuse the existing nearest managed-state and full file-integrity bootstrap. The new assets and input sections participate in generation, package inventory, selected-host transactions, update, partial uninstall and drift checks.

## Verification

- Build PASS; deterministic generation, dependency audit, docs check and whitespace check PASS.
- Focused runtime/launcher/five-host lifecycle/capability/generator/pack regressions: 139 PASS, 0 FAIL.
- Final full suite: 595 tests, 593 PASS, 0 FAIL, 2 existing skips. One additional pre-existing Windows file-symlink test was excluded because this account cannot create file symlinks (EPERM). This test is not claimed as passed.
- Removed inherited CLAUDE_CONFIG_DIR from the test process only; it otherwise points at the real kscc directory and contaminates the existing user-statusline fixture. The statusline test then passes. No global environment was changed.
- Final test-only formatting cleanup was followed by a fresh build and QA product test: 5 PASS.
- Real npm pack validation and five-host packaged smoke are included in the above gates. No public release/readiness acceptance or native Codex/Cursor UI acceptance is claimed.

## Applied installation

The actual screenshot session used I:/JX3_SVN/Head and kscc 1.3.6. Supplemental metadata-only source scanning found no KCodeRag duplicate source under C:/Users/kingsoft/.kscc. Standard lifecycle gates also passed.

Packed the verified local candidate and invoked its CLI through offline npx to update the project's Claude installation from 0.3.8 to local candidate 0.3.9. Both installed capabilities remain present; doctor reports healthy. The update also includes existing upstream 0.3.9 statusline/update changes. Every managed file digest is valid, and the installed dashboard runtime is byte-identical to this candidate.

Real kscc was started with project settings/Skill loading, isolated user config, strict empty MCP configuration and loopback model endpoints. One UserPromptSubmit response consumed the original slash command, requested browser launch and returned exit 0 with zero model turns, zero tokens and zero cost. Total process startup plus command was 2718 ms; this is not an isolated hook latency measurement. OS acceptance of the launch request is proven; page readiness is not. See kscc-receipt.json.

The user should reopen kscc in the same project before using the command. The host may display the successful action as a hook-block message. This project-level update does not alter user-global hooks, other projects, or other hosts. Codex and Cursor need their own selected-host update and host trust/enabling. Unsupported or disabled hooks may still invoke the manual Skill/model.

Candidate SHA-256: 4bd9bfd165f89f1b9b5d4a06fbb78277c647eb8499aa295828c9f21d0a0501d5. The archive and raw local test/probe logs are in C:/Users/kingsoft/AppData/Local/Temp/kcoderag-dashboard-evidence-20261010. This is an unpublished local candidate; package version was not advanced, and no npm publish, tag, push or PR occurred.

The project's external local-history snapshot is a07bfc1; verification reports ByteExact=True, clean working tree and no remotes. The original D:/AIProgram/kcoderag-nav checkout retains its pre-existing modified config and untracked quick-task directory. Implementation lives on codex/dashboard-direct-open in the attached managed worktree.
