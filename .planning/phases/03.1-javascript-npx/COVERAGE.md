# API Coverage — npm Registry

> Full coverage by default. This matrix enumerates only the npm Registry capabilities directly used by Phase 03.1; unrelated registry administration is not part of this integration surface.

| capability | decision | reason |
|---|---|---|
| Resolve `kcoderag-nav@latest` for npx acquisition | INTEGRATE | |
| Read the `kcoderag-nav` package metadata document | INTEGRATE | |
| Read and validate `dist-tags.latest` for the asynchronous update check | INTEGRATE | |
| Publish one immutable package version from a matching `vX.Y.Z` GitHub tag | INTEGRATE | |

## Boundary Notes

- Package acquisition and publish transport are delegated to the official npm CLI; project code does not reimplement npm authentication or tarball resolution.
- The update worker performs only the bounded metadata read needed for `dist-tags.latest`; foreground hook execution performs no network I/O.
- This phase does not call registry administration operations such as unpublish, deprecate, owner/team management, access-policy changes, or arbitrary dist-tag mutation.
- Registry credentials are supplied only to the tag-gated GitHub Actions publish step and must never be printed, copied into project state, or included in test fixtures.
