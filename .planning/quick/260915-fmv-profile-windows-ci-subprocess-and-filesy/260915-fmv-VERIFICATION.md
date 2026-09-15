---
status: passed
quick_id: 260915-fmv
---

# Verification

- Measured original and optimized npm invocation with identical serial Codex workload and fresh private caches; two PASS pairs show 11.2% mean reduction.
- Three focused tests prove resolver precedence, invalid/missing CLI fallback, unchanged Linux path, real npm execution, literal Windows argument transfer, cwd/environment and nonzero exit propagation.
- Latest implementation passed build, 542/542 full tests, 19/19 package contracts, unchanged generation, docs, retirement audit and acceptance topology checks.
- Commit a31f40f passed required hosted Windows/Linux Node 22/24 CI (34925291415).
- Exact-package acceptance 34925291361 passed both groups and the final strict merger; downloaded evidence confirms five PACKAGED PASS receipts for one candidate/package/attempt.
- No workflow, test selection, dependency, global settings, antivirus, public version, native LIVE or publication changes. Unrelated quick 260904-mh0 preserved.

See SUMMARY.md for timings, uncertainty and reproducible diagnostic commands. Profiling observations do not establish a Windows filesystem or Defender root cause.
