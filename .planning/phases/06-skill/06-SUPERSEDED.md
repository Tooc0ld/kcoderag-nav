# Phase 06 Superseded Plan Set

**Status:** Superseded on 2026-09-03 by `06-01-PLAN.md` convergence execution.

The former top-level `06-01-PLAN.md` through `06-13-PLAN.md` set from planning commit
`4c15df8` is intentionally removed from the phase directory's executable PLAN scan.
Its complete contents remain available in Git history at `4c15df8`; earlier revisions
remain at `a2eb609`, `94ce5a7`, and `3b77890`.

The old ordering assumed each canonical/generated/host slice could make an ordinary
implementation commit. The repository pre-commit contract makes that impossible:
staging any managed canonical or generated path rejects unstaged changes across the
whole canonical/generated set and then runs global capability, Hook, generator,
repository-product, retirement, and drift gates. The first old-wave commit therefore
failed on a later ZCode/global fixture, and every subsequent intermediate would have
failed on expected current-name drift. Hook bypass is not an accepted recovery path.

The replacement `06-01-PLAN.md` preserves the already committed RED test `c821975`,
adopts its current four-path staged GREEN work, converges all Phase 06 product surfaces,
runs the real pre-commit and final gates, and creates one cohesive implementation
commit. This ledger is not named `*-PLAN.md`, so incomplete-plan routing selects only
the replacement convergence plan.
