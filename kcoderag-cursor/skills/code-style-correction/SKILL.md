---
name: code-style-correction
description: Guide JX3 Sword3 C/C++ headers and Lua changes before writing, using project-native rules for result handling, ownership, lifecycle, protocol/version/serialization, Lua stack contracts, packet buffers, formatting, and file hygiene. Use whenever creating or modifying .c, .cc, .cpp, .cxx, .h, .hh, .hpp, .hxx, .inl, .ipp, or .lua code in a JX3 project; do not use for read-only analysis, pure rename/delete operations, or unrelated languages.
---

# JX3 Code Style Correction

Plan and write the smallest JX3-native C/C++ or Lua change that preserves business,
ownership, protocol, persistence, runtime, and file-byte contracts.

## Managed asset and precedence

This entire Skill tree is nav-managed and non-overridable. Do not directly edit these
files, and do not create or use override files. Record project-specific conventions in
`AGENTS.md` or equivalent project documentation so the project remains the source of
its own exceptions.

Instruction precedence is: user instructions > project documentation > JX3 Skill.
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

- `JX3-R01` — Inspect declarations and same-owner use; receive and judge every proven non-void risky business result at its correct boundary, but never invent checks for `void` calls.
- `JX3-R02` — Pair every owned buffer, result, or reference acquisition with exactly one release on every exit after confirming conditional and borrowed ownership.
- `JX3-R05` — Store a call result and make the following KG check judge that same variable with the contract's correct success or failure polarity.
- `JX3-R06` — Keep `Exit0` cleanup non-jumping and preserve the established release order so cleanup cannot branch back into itself.
- `JX3-R07` — Initialize single-exit result variables to failure and assign success only after every required operation has completed.
- `JX3-R11` — Treat successful initialization as a stack and unwind it in exact reverse order on failure and public teardown for every conditional build path.
- `JX3-R14` — Format a proven server-side `DWORD`-like value with `%u` or make the surrounding API's required type conversion explicit.
- `JX3-R15` — Never pass a smaller scalar through a wider pointer cast; use a correctly typed temporary, target, or explicitly size-checked byte copy.
- `JX3-R17` — In client code, use the nearest same-owner pak/resource-aware file API instead of direct `fopen`; do not project this rule onto server paths.
- `JX3-S02` — Evaluate a business call before a KG process macro and pass the simple stored result while preserving side-effect order.

### Protocol, serialization, and data

- `JX3-R03` — Initialize every output-owned member of a protocol handler result while leaving proven input-owned members and flexible payload tails under their actual contract.
- `JX3-R04` — Bind `KBroadcastFunc.m_pvData` to storage whose proven lifetime covers the broadcast and matches the owner's established buffer pattern.
- `JX3-R12` — Keep required version conversions and dispatch cases contiguous through `CURRENT_BASEINFO_VERSION` without expanding a deliberately bounded converter without evidence.
- `JX3-R13` — Resolve wire compatibility and raise the applicable world protocol version in the same change as a GS-client protocol layout change.
- `JX3-R16` — Include every persisted member in the serialization visitor and explicitly justify any transient or intentionally non-persisted member.
- `JX3-R19` — Before changing a table-backed member and loader format together, obtain evidence for the data column, defaults, backward compatibility, and code/data deployment order.
- `JX3-S03` — Use the owning named state constant at wire or business-state boundaries after proving the value is not a count, bit, or generic boolean.
- `JX3-S04` — Build transport packets with the nearest same-owner stable scratch-buffer convention unless a concrete lifetime, reentrancy, or size constraint requires another shape.
- `JX3-S05` — Do not introduce heap packet storage when the owner has a stable transport convention unless the required variable size or asynchronous lifetime is proven.
- `JX3-S06` — Keep packing boundaries balanced and scoped to the exact wire structures after inspecting the surrounding active pack state and compatibility intent.

### Lua contracts

- `JX3-R08` — Align Lua call result counts, stack-read counts, format characters, and receiving variables, and receive every declared result.
- `JX3-R09` — Construct `KLuaArgGuard` before the first push on the same Lua state and cover the highest argument index; report dynamic counts instead of guessing.
- `JX3-R10` — Make a complete supported stack-count guard cover every direct access on that state, and resolve indirect helper access before changing the boundary.
- `JX3-R18` — Prove the value is a table with the local accepted API on the same state and index before any `Lua_Next` traversal.

### Change hygiene and self-review

- `JX3-S01` — Preserve surrounding whitespace and alignment unless semantics require the change, restoring only proven unrelated drift without undoing control flow or crossing a `goto` boundary.
- `JX3-S07` — Prefer lowercase `true` and `false` for native boolean literals while preserving uppercase tokens required by external APIs, macros, or schema contracts.
- `JX3-S08` — Preserve the file's existing encoding, BOM, and newline baseline with an encoding-safe edit path, and never claim byte integrity without before/after evidence.

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
