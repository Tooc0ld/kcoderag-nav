---
status: complete
quick_id: 260902-kn6
completed: 2026-09-02
---

# Head project Codex installation replacement

Replaced the drifted legacy `0.2.2` Codex installation in `I:\JX3_SVN\Head` with the current npm `latest` release, `0.3.1`.

## Work performed

- Captured all nine legacy managed files in `C:\Users\kingsoft\AppData\Local\kcoderag-nav\backups\Head-260902-kn6`.
- Verified that every dedicated legacy file still matched its recorded digest.
- Removed only the nine legacy managed files; no directory-wide deletion was used.
- Installed `kcoderag-navigation` for the Codex host with `kcoderag-nav@latest`.

## Verification

- `status --json`: exit 0, `status: healthy`, no issues or findings.
- `doctor --json`: exit 0, `status: healthy`, no issues or findings.
- Current state: schema 1, package `0.3.1`, host `codex`, capability `kcoderag-navigation`.
- Project skill and install-state files both exist after installation.
