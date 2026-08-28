# API Coverage — GitHub Actions Artifact v7 Upload Transport

> Full coverage is the default. This matrix records the complete control/data surface considered by the repository-owned producer transport; opt-outs are explicit and reasoned.

| capability | decision | reason |
|---|---|---|
| create artifact | INTEGRATE | Required to obtain the per-run private upload lease for the one readiness package. |
| stage block | INTEGRATE | Required to upload the audited package bytes through deterministic bounded Azure blocks. |
| commit block list | INTEGRATE | Required to assemble exactly the staged blocks into the uploaded artifact. |
| finalize artifact | INTEGRATE | Required to close the artifact with the exact size and SHA-256 identity consumed by four lanes. |
| delete artifact | INTEGRATE | Required only for bounded best-effort cleanup when an upload fails after creation. |
| list artifacts | OPT-OUT | The producer owns one exact artifact identity returned by creation; listing would add ambiguity and is not needed for upload. |
| get signed download URL | OPT-OUT | Downstream lanes use the pinned official download action; the repository-owned component is intentionally upload-only. |

The matrix adds no new endpoint, credential, runtime dependency, download client, release action, or public API. It documents the already implemented producer boundary so readiness verification cannot silently treat omitted service capabilities as integrated.
