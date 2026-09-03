---
quick_id: 260903-rds
phase: quick-260903-rds
plan: "01"
type: execute
status: complete
mode: quick-full
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - kcoderag-cursor/.cursor-plugin/plugin.json
  - kcoderag-qa/.claude-plugin/plugin.json
  - kcoderag-qa/.codex-plugin/plugin.json
  - .planning/STATE.md
  - .planning/quick/260903-rds-publish-kcoderag-nav-nav-0-3-4-and-verif/
autonomous: true
requirements: []
must_haves:
  truths:
    - "The local release begins from a clean master whose unpublished product commits are ahead of origin/master, while npm latest is 0.3.3 and exact 0.3.4 is absent."
    - "The failed v0.3.4 workflow remains immutable and unpublished; release CI removes only duplicate packaged-smoke execution while preserving the complete gate set."
    - "The repository release tool advances every release-owned version surface from local 0.3.4 to 0.3.5, creates one release commit and annotated v0.3.5 tag, and passes its complete gates."
    - "The release commit and tag reach origin, the tag-triggered GitHub Release workflow succeeds, and npm publishes immutable kcoderag-nav@0.3.5 with latest pointing to the same version."
    - "Public exact and latest artifacts expose the fifth kcoderag-update Skill and pass real npx lifecycle verification without leaking credentials."
  artifacts:
    - path: package.json
      provides: Public package version 0.3.5 and closed five-Skill inventory
    - path: .github/workflows/release.yml
      provides: Tag-triggered four-platform gates and npm publication
    - path: .planning/quick/260903-rds-publish-kcoderag-nav-nav-0-3-4-and-verif/260903-rds-SUMMARY.md
      provides: Release identity, workflow, registry, and smoke evidence
  key_links:
    - from: v0.3.5
      to: package.json
      via: exact release commit identity
    - from: .github/workflows/release.yml
      to: npm kcoderag-nav@0.3.5
      via: successful tag-triggered publish job
    - from: npm exact and latest specs
      to: generated kcoderag-update assets
      via: registry metadata, tarball inventory, and public npx lifecycle verification
---

# Quick Task 260903-rds: Publish kcoderag-nav 0.3.5 after the immutable 0.3.4 workflow timeout

## Goal

Preserve the pushed but unpublished `v0.3.4` failure, remove duplicate release-CI work without reducing coverage, publish the five-Skill implementation as immutable `kcoderag-nav@0.3.5`, then prove the GitHub and npm public state.

## Task 1: Establish the immutable release baseline

**Files:** repository Git metadata, npm registry metadata, this plan

**Action:** Fetch current origin state; require a clean `master`, npm `latest` equal to `0.3.3`, exact `0.3.4` and `0.3.5` absent, active GitHub authentication, the immutable failed `v0.3.4` tag retained, and the already verified implementation commits present locally.

**Verify:** Compare `origin/master...HEAD`, query npm dist-tags and exact version, and inspect local/remote tags without printing credentials.

**Done:** The release is proven forward-only and cannot overwrite an existing immutable version.

## Task 2: Fix the release timeout and publish 0.3.5

**Files:** `.github/workflows/release.yml`, `tests/maintainer/release-workflow.test.cts`, `package.json`, `package-lock.json`, and the three versioned plugin manifests declared by the release tool

**Action:** Replace the release lane's unfiltered test invocation with the established `test:ci` partition while retaining the explicit five-host smoke exactly once. Commit the tested workflow fix, run `npm run release:patch -- --yes --json`, verify its exact commit and tag, push `master` and `v0.3.5` to origin, and monitor the tag-triggered Release workflow to success. Do not move `v0.3.4`, manually publish, or alter dist-tags.

**Verify:** Workflow contract tests prove 530 ordinary tests plus one explicit packaged smoke; the release command exits zero with `version:0.3.5`; the tag peels to the release commit; origin contains both identities; the GitHub workflow conclusion is `success` including its publish job.

**Done:** GitHub Actions, not the local shell, publishes the exact tagged package after all required lanes pass.

## Task 3: Verify public exact/latest artifacts and record completion

**Files:** public npm metadata and package artifacts, quick SUMMARY/VERIFICATION, `.planning/STATE.md`

**Action:** Wait for npm propagation; query exact and latest metadata; inspect the public tarball inventory for the canonical/generated update Skill files; run real public `npx` install/status/update/uninstall lifecycles for exact `0.3.5` across five disposable project targets, then confirm `@latest` resolves to and installs the same version. Keep formal `required-contract` smoke inside its active local readiness-lease boundary. Record bounded metadata-only evidence and update GSD state.

**Verify:** Exact/latest versions and integrity agree, public inventory contains all expected update Skill projections, all five exact-version public lifecycles pass, one `@latest` lifecycle installs `0.3.5`, and GSD verification status is `passed`.

**Done:** `kcoderag-nav@0.3.5` is publicly available as `latest`, independently installable, and evidence-backed; `v0.3.4` remains an honest unpublished workflow-timeout record.
