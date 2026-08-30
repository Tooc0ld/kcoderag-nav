# Deferred Items

- item: GitHub Release run `32682791252` succeeded, but GitHub annotated the former
    pinned `actions/checkout` and `actions/setup-node` revisions as Node.js 20
    actions being forced onto Node.js 24.
  status: resolved
  resolution: Quick task `260831-0ei` resolved the current stable official releases
    to immutable commits and verified `runs.using: node24` in each exact
    `action.yml`: `actions/checkout` `v7.0.1`
    (`3d3c42e5aac5ba805825da76410c181273ba90b1`) and `actions/setup-node` `v7.0.0`
    (`820762786026740c76f36085b0efc47a31fe5020`). The pins were updated in
    `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and
    `.github/workflows/readiness.yml`; the historical verified `v0.1.6`
    publication result remains unchanged.
