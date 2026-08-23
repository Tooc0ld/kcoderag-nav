# Technology Stack

**Analysis Date:** 2026-08-24

## Languages

**Primary:**
- TypeScript `.cts` - host-neutral lifecycle, Codex/Claude/Cursor adapters, advisory hook,
  asynchronous update check, deterministic generator, and maintainer audits under `src/`.
- CommonJS `.cjs` - directly executable Node 22+ products emitted to ignored `dist/` and copied
  into the generated QA/Dev packages.
- JSON/TOML/Markdown - project-native host configuration, plugin metadata, rules, skills, and
  user guidance.

**Transitional:**
- Python 3 - legacy installers, generator, tests, and migration inputs remain only until the
  ordered Phase 03.1 retirement plans delete them; new runtime and CI paths are Node-only.

## Runtime

**Environment:**
- Node.js 22 or newer; `package.json` enforces `engines.node: ">=22"`.
- Codex, Claude Code, and Cursor consume project-native assets written by the compiled npx CLI.
- Installed Codex/Claude hooks execute self-contained CJS and fail open if Node later disappears.

**Package Manager:**
- npm with lockfile v3 (`package-lock.json`).
- Public bin contract: `npx kcoderag-nav@latest <command>`.
- Production dependencies are empty; the exact development-only compiler/type graph is audited.

## Frameworks

**Core:**
- Model Context Protocol (MCP) - external KCodeRag QA/Dev servers are projected into each host's
  native project configuration without logging connection values.
- Host adapters - Codex, Claude Code, and Cursor implement one shared read/render/status contract;
  the host-neutral transaction is the sole normal filesystem mutator.

**Testing:**
- Node built-in test runner and `node:assert/strict` over compiled tests in `dist-tests/`.
- Temporary repositories/projects, real launcher subprocesses, actual npm tgz inspection, injected
  failures, and loopback-capable seams provide integration evidence without third-party test tools.

**Build/CI:**
- TypeScript 6 compiles `.cts` to CommonJS via `tsconfig.json` and `tsconfig.tests.json`.
- GitHub Actions required CI runs Windows/Linux by Node 22/24 with immutable action pins,
  `npm ci --ignore-scripts`, dependency audit, build, tests, generation check, and pack audit.

## Key Dependencies

**Runtime:**
- No npm production dependencies.
- KCodeRag MCP service remains external and supplies the graph lookup tools.

**Development:**
- `typescript@6.0.3` and `@types/node@22.20.1`, with sole transitive
  `undici-types@6.21.0`; resolution, integrity, edges, and lifecycle policy are machine-audited.

## Configuration

**Build and package:**
- `package.json` is the single package/version/script/publish allow-list source.
- `package-lock.json` freezes the approved development graph.
- `tsconfig.json` and `tsconfig.tests.json` emit ignored `dist/` and `dist-tests/` trees.

**Generated products:**
- `plugin-src/` supplies canonical templates and opaque environment inputs.
- `kcoderag-qa/`, `kcoderag-dev/`, and `kcoderag-cursor/` are deterministic generated assets.
- Credential-bearing MCP files are treated as opaque inputs and must never be copied into logs,
  snapshots, or documentation.

## Platform Requirements

**Development:**
- Node.js 22+ and npm; Python is only temporary legacy parity/migration tooling.
- Git for pre-commit index inspection and project maintenance evidence.

**CI:**
- GitHub-hosted `ubuntu-latest` and `windows-latest` runners with Node 22 and 24.
- Ordinary push/PR CI is test-only and has read-only repository contents permission.

**Production/Internal QA:**
- A supported host plus access to the selected internal QA or Dev KCodeRag MCP endpoint.

---

*Stack analysis: 2026-08-24*
