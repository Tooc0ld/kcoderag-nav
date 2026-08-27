# C++ Lifetime and Control Flow

Use this reference before changing business calls, acquisition/release paths,
single-exit cleanup, initialization order, KG macros, server formatting, pointer-width
boundaries, or client file access. Start from the declaration and the nearest unchanged
same-owner operation; syntax alone does not prove ownership or success polarity.

## R01 — Risky business results

**Write:** Inspect the visible declaration and nearest same-owner use before adding a
risky call. Receive and judge each proven non-void result at the business boundary that
owns failure handling; curated operations such as `AddItem` and `CostMoney` still need
their known contract honored.

**Boundary:** Never invent an error check for a `void` function. A broad `Add*` or
`Cost*` name needs a visible non-void declaration; ordinary names such as
`setAdditionalKerning` and `ResetCostume` are not evidence of a risky call.

**Review:** Trace success, failure, and side effects through the caller. If the
declaration is absent or ambiguous, report that evidence gap instead of guessing a
return type or polarity.

## R02 — Acquisition and release

**Write:** Pair every owned buffer, database result, or added reference on every exit,
normally through the owner's existing `Exit0` cleanup shape. Release exactly once and
keep release order consistent with the order in which ownership became live.

**Boundary:** Distinguish owned, borrowed, transferred, and conditionally acquired
values before adding cleanup. A borrowed pointer needs no invented release, and a value
already released by its owner must not gain a double release.

**Review:** Walk success and each failure path from acquisition to cleanup. Confirm the
release condition represents actual ownership and that no early exit skips or repeats
the release.

## R05 — Result variable and polarity

**Write:** Store the business call's result in the local result variable and make the
immediately related KG check judge that same variable. Derive success/failure polarity
from the declaration, owner analog, and the surrounding result convention.

**Boundary:** Setup statements or an intentional independent condition can separate a
call from a check. Do not rename variables or flip polarity merely because two nearby
names differ; first prove they represent the same result contract.

**Review:** Follow the checked value backward to its assignment and forward to the
cleanup/result path. Verify the macro cannot accept stale state from an earlier call.

## R06 — Non-jumping cleanup

**Write:** Inside `Exit0`, use cleanup calls and conditions that cannot jump back to the
same label. Preserve the established release order and keep cleanup safe for every
partially initialized state that can reach the label.

**Boundary:** The problem is jump semantics, not the mere presence of a helper or macro.
An ordinary non-jumping cleanup helper may remain when its ownership and side effects
match the local pattern.

**Review:** Inspect every cleanup statement for hidden branch behavior, and confirm the
replacement neither skips later releases nor runs a release twice.

## R07 — Failure-first single-exit results

**Write:** Initialize `nResult`, `bResult`, `nRetCode`, or `bRetCode` to the function's
failure value in a single-exit error-macro function. Assign success only after all
required work, writes, notifications, and ownership transfers have completed.

**Boundary:** This applies to variables that carry the function result, not to every
feature flag or local boolean initialized to true. Use the actual return contract rather
than replacing values mechanically.

**Review:** Exercise each early jump mentally and confirm none can return success before
the operation's required effects have happened.

## R11 — Initialization and teardown order

**Write:** Treat successful initialization as a lifetime stack. If acquisition is
`A, B, C`, both the failure path and public teardown release `C, B, A`, guarded so only
successfully acquired members are released. Check every conditional compilation path
independently.

**Boundary:** A pure receiver rename does not authorize reordering. Do not group cleanup
for appearance, and do not release a member that could not have initialized on that
preprocessed path.

**Review:** Compare the `Init` success sequence, its `Exit0` failure path, and `UnInit`
side by side. Confirm reverse order and guards remain valid after each conditional branch.

## R14 — Server DWORD formatting

**Write:** For a proven server-side `DWORD`-like argument, use `%u`, including legal
width or precision modifiers, or perform the explicit conversion required by the
formatting API when the destination type genuinely differs.

**Boundary:** Confirm the actual type and execution side first. Client-only display code,
GUI layers, or a value already explicitly converted to a wider matching type are not
automatic rewrite targets.

**Review:** Match every conversion specifier to the final passed argument after casts and
promotions; avoid inferring type from a variable name alone.

## R15 — Pointer width under LLP64

**Write:** When an API writes through a wider scalar pointer, provide storage with that
exact declared type and convert the value afterward. An explicitly size-checked byte
copy is acceptable only when the binary contract requires it.

**Boundary:** This concerns address casts between different scalar widths under Windows
LLP64, not ordinary value casts or proven same-width aliases. Confirm both declarations
and the out-parameter behavior.

**Review:** Compare `sizeof` and signedness of the source, target, and API parameter, then
verify the write cannot overrun or reinterpret the smaller object.

## R17 — Client resource access

**Write:** In client code, follow the nearest same-owner pak/resource-aware API for file
access so packaged assets, lookup order, and ownership match the surrounding module.

**Boundary:** Server file paths are outside this rule. Do not replace an approved server
diagnostic path or choose a global client helper without checking the local owner and
resource family.

**Review:** Verify open, read, close, error, and encoding behavior against the selected
client analog and ensure direct `fopen` did not bypass the packaged-resource contract.

## S02 — Business calls outside KG macros

**Write:** Evaluate the business call first, store its result, then pass that simple value
to `KG_PROCESS_ERROR`, `KGLOG_PROCESS_ERROR`, or the matching project macro. Preserve
the original side-effect order and local result naming.

**Boundary:** Non-business constructs such as `sizeof` and simple comparisons may remain
inside the macro. Do not extract expressions merely to satisfy a visual pattern.

**Review:** Inspect multiline macro arguments and chained operations such as
`insert(...).second`; confirm each business side effect executes exactly once before the
check.
