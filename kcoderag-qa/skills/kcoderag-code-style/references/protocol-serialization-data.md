# Protocol, Serialization, and Data

Use this reference before changing handler outputs, broadcast payload storage, version
conversion, GS-client wire layout, serialization visitors, table-loader contracts,
business-state fields, packet buffers, or packing. Separate domain authority from wire
representation, and require external evidence for external data compatibility.

## R03 — Protocol handler outputs

**Write:** Initialize every output-owned member of a resolved protocol `Do` result before
return or writeback. Follow the handler declaration and same-family analog to distinguish
defaults, computed values, and required status fields.

**Boundary:** Do not overwrite input-owned members, proven bulk-initialized storage, or
flexible payload tails. A structure member's presence alone does not prove this handler
owns it.

**Review:** Enumerate output-owned members and trace each assignment. Report unclear
ownership rather than zeroing the whole object mechanically.

## R04 — Broadcast payload lifetime

**Write:** Bind `KBroadcastFunc.m_pvData` to stable storage whose lifetime covers the
complete `Broadcast` call, following the owning manager's established payload-buffer
pattern and size calculation.

**Boundary:** A named temporary is not automatically stable, while an owner scratch
buffer may already be correct. Prove lifetime, mutation, and reentrancy before changing
the storage shape.

**Review:** Trace construction, assignment, broadcast, and final use; reject pointers to
temporary expressions, short-lived strings, or storage invalidated before consumption.

## R12 — Contiguous version conversion

**Write:** Add each required `VnToVn+1` conversion and its dispatch case without a gap,
continuing through `CURRENT_BASEINFO_VERSION` for converters that own the full current
chain.

**Boundary:** Some converters are deliberately bounded to a historical window. Do not
expand their start/end points without repository contract evidence, and do not assume
the current chain begins at zero.

**Review:** Draw the supported version edges and confirm every accepted input reaches the
current representation exactly once with no missing or duplicate transition.

## R13 — GS-client protocol version

**Write:** When a GS-client wire enum or structure layout changes, resolve field/ID
ordering and raise the applicable world version in the same change. Keep compatibility
logic and the new layout mutually consistent.

**Boundary:** An implementation-only structure that never crosses the wire does not need
a protocol bump. Lowest-version policy is project-owned; do not change the compatibility
window without explicit project evidence.

**Review:** Compare old/new layouts and version dispatch, verify the world version rises,
and surface any mixed-version deployment question.

## R16 — Serialization visitor completeness

**Write:** Add every persisted member covered by `SER_SUPPORT_DECL` to the matching
`SER_VISIT_VAR` or `SER_VISIT_VARS` contract in the same change and order expected by the
owner.

**Boundary:** A transient cache, derived index, or static member may be intentionally
excluded. Document and prove that exclusion from the persistence contract instead of
serializing it by reflex.

**Review:** Compare the declared structure and visitor member by member, then check
load/save compatibility and defaults for newly persisted state.

## R19 — Table-loader compatibility evidence

**Write:** Before changing a table-backed member and `KRL_LOAD_BIN_TEXT_TABLE*` format
together, obtain evidence for the external data column, zero/default behavior, backward
compatibility, and code/data deployment order.

**Boundary:** Source alone cannot prove the staged table or binary data is compatible.
Do not mechanically revert or rewrite either the structure or format string when the
missing fact is external.

**Review:** State which evidence is available and which business/deployment questions
remain. Never turn a source-shape review into a compatibility success claim.

## S03 — Named wire and business states

**Write:** At a proven wire or business-state assignment/comparison, use the existing
owning named state constant at both conversion ends instead of raw `0` or `1`.

**Boundary:** Counts, bit positions, generic booleans, and numeric payload values are not
state enums. Do not invent a constant or move domain semantics into a protocol header;
first identify the owning domain declaration.

**Review:** Trace the sender/receiver conversion and verify the named value preserves the
wire width and business meaning. This rule explicitly covers the previously under-tested
raw-state case.

## S04 — Stable transport scratch buffers

**Write:** For immediately serialized transport packets, follow the nearest same-owner
scratch buffer and construction sequence, including size validation, cast pattern, and
send/broadcast lifetime.

**Boundary:** A cryptographic or ordinary work buffer with no transport role is outside
this rule. A concrete reentrancy, size, or lifetime requirement may justify a different
buffer; name that reason.

**Review:** Compare the packet builder to the same-direction operation family and verify
the selected storage remains valid until transport consumption completes.

## S05 — Heap packet storage restraint

**Write:** Match the nearest same-owner transport implementation before allocating packet
storage. Prefer its stable scratch buffer when the packet is immediate and fits the
owner's established size contract.

**Boundary:** This is not a blanket heap ban. Proven variable size, ownership transfer,
reentrancy, or asynchronous lifetime can require allocation; preserve it when the
contract and cleanup are explicit.

**Review:** Verify allocation size, ownership, every release path, and consumption
lifetime, then compare the complexity against the local transport convention. This rule
explicitly covers the previously under-tested heap-packet case.

## S06 — Packing boundaries

**Write:** Inspect the active surrounding pack state before adding or moving directives.
Keep push/pop or the project-native pack/reset pair balanced and scope it to the exact
wire structures whose compatibility requires packing.

**Boundary:** Pack state can begin outside the changed hunk. Do not duplicate an already
active boundary, insert an early reset, or normalize pragmas without layout evidence.

**Review:** Calculate the intended field layout on both sides of the boundary and verify
later structures retain their prior packing. This rule explicitly covers the previously
under-tested pragma case.
