---
name: code-style-correction
description: Review and guide C/C++ or Lua code changes before writing, applying repository-native rules for results, ownership, lifetime, protocol/serialization, Lua stack contracts, packet buffers, formatting, and file hygiene. Use when creating or modifying .c, .cc, .cpp, .cxx, .h, .hh, .hpp, .hxx, .inl, .ipp, or .lua files; exclude read-only analysis, pure rename/delete operations, and unrelated languages.
---

# Code Style Correction

Plan and write the smallest repository-native C/C++ or Lua change that preserves business,
ownership, protocol, persistence, runtime, and file-byte contracts.

## Managed asset and precedence

This entire Skill tree is nav-managed and non-overridable. Do not directly edit these
files, and do not create or use override files. Record project-specific conventions in
`AGENTS.md` or equivalent project documentation so the project remains the source of
its own exceptions.

Instruction precedence is: user instructions > project documentation > Code Style Skill.
When instructions disagree, disclose the conflict and follow the higher-priority
instruction; never silently replace a project convention with this Skill.

## Pre-write workflow

1. Identify the business contract, authority, identity, ownership, lifetime, wire/data
   boundary, and file-byte baseline affected by the requested change.
2. Inspect the nearest unchanged same-owner, same-operation-family analog available in
   the current checkout. A different shape needs a concrete contract reason.
3. Load only the detailed reference selected by the risk router below, then apply the
   compact rules while designing the change.
4. Write the smallest necessary diff. Preserve unrelated behavior and local idioms;
   do not add aliases, abstractions, state, or cleanup without demonstrated need.
5. Before finishing, review only regions changed in this task. Minimally fix clear
   self-introduced issues. Disclose conflicts and report evidence-dependent or business
   questions without guessing or broadening the change.

## Compact pre-write index

### C++ lifetime and control flow

- `R01` — Inspect declarations and same-owner use; receive and judge every proven non-void risky business result at its correct boundary, but never invent checks for `void` calls.
- `R02` — Pair every owned buffer, result, or reference acquisition with exactly one release on every exit after confirming conditional and borrowed ownership.
- `R05` — Store a call result and make the following KG check judge that same variable with the contract's correct success or failure polarity.
- `R06` — Keep `Exit0` cleanup non-jumping and preserve the established release order so cleanup cannot branch back into itself.
- `R07` — Initialize single-exit result variables to failure and assign success only after every required operation has completed.
- `R11` — Treat successful initialization as a stack and unwind it in exact reverse order on failure and public teardown for every conditional build path.
- `R14` — Format a proven server-side `DWORD`-like value with `%u` or make the surrounding API's required type conversion explicit.
- `R15` — Never pass a smaller scalar through a wider pointer cast; use a correctly typed temporary, target, or explicitly size-checked byte copy.
- `R17` — In client code, use the nearest same-owner pak/resource-aware file API instead of direct `fopen`; do not project this rule onto server paths.
- `S02` — Evaluate a business call before a KG process macro and pass the simple stored result while preserving side-effect order.

### Protocol, serialization, and data

- `R03` — Initialize every output-owned member of a protocol handler result while leaving proven input-owned members and flexible payload tails under their actual contract.
- `R04` — Bind `KBroadcastFunc.m_pvData` to storage whose proven lifetime covers the broadcast and matches the owner's established buffer pattern.
- `R12` — Keep required version conversions and dispatch cases contiguous through `CURRENT_BASEINFO_VERSION` without expanding a deliberately bounded converter without evidence.
- `R13` — Resolve wire compatibility and raise the applicable world protocol version in the same change as a GS-client protocol layout change.
- `R16` — Include every persisted member in the serialization visitor and explicitly justify any transient or intentionally non-persisted member.
- `R19` — Before changing a table-backed member and loader format together, obtain evidence for the data column, defaults, backward compatibility, and code/data deployment order.
- `S03` — Use the owning named state constant at wire or business-state boundaries after proving the value is not a count, bit, or generic boolean.
- `S04` — Build transport packets with the nearest same-owner stable scratch-buffer convention unless a concrete lifetime, reentrancy, or size constraint requires another shape.
- `S05` — Do not introduce heap packet storage when the owner has a stable transport convention unless the required variable size or asynchronous lifetime is proven.
- `S06` — Keep packing boundaries balanced and scoped to the exact wire structures after inspecting the surrounding active pack state and compatibility intent.

### Lua contracts

- `R08` — Align Lua call result counts, stack-read counts, format characters, and receiving variables, and receive every declared result.
- `R09` — Construct `KLuaArgGuard` before the first push on the same Lua state and cover the highest argument index; report dynamic counts instead of guessing.
- `R10` — Make a complete supported stack-count guard cover every direct access on that state, and resolve indirect helper access before changing the boundary.
- `R18` — Prove the value is a table with the local accepted API on the same state and index before any `Lua_Next` traversal.

### Change hygiene and self-review

- `S01` — Preserve surrounding whitespace and alignment unless semantics require the change, restoring only proven unrelated drift without undoing control flow or crossing a `goto` boundary.
- `S07` — Prefer lowercase `true` and `false` for native boolean literals while preserving uppercase tokens required by external APIs, macros, or schema contracts.
- `S08` — Preserve the file's existing encoding, BOM, and newline baseline with an encoding-safe edit path, and never claim byte integrity without before/after evidence.

## Risk router

- For business calls, ownership, cleanup, lifecycle, KG macros, server formatting,
  pointer widths, or client file access, read [C++ lifetime and control flow](references/cpp-lifetime-control-flow.md).
- For handler outputs, broadcast storage, protocol versions, serialization, table
  loaders, state constants, packet buffers, or packing, read [Protocol, serialization, and data](references/protocol-serialization-data.md).
- For Lua calls, guards, stack indices, or traversal, read [Lua contracts](references/lua-contracts.md).
- For formatting scope, boolean spelling, byte preservation, and final bounded review,
  read [Change hygiene and self-review](references/change-hygiene-self-review.md).

## Evidence boundary

This Skill is pre-write guidance, not a scanner. Source review can establish only the
visible source shape and contract consistency. Do not claim build, deployment,
persistence, runtime, UI, external-data compatibility, encoding, or byte-integrity
success without separate evidence that proves that exact class of result. When the
needed declaration, business decision, external data, or baseline bytes are absent,
state the open question and stop short of a success claim.
