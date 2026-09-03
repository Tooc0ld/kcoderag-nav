# Lua Contracts

Use this reference before changing a C++/Lua bridge call, argument push sequence, stack
guard, direct stack index, or table traversal. Treat the Lua state, declared counts,
format characters, receiver variables, and accessed indices as one contract.

## R08 — Result count and receiver alignment

**Write:** Make `CallFunction` result count, `GetValuesFromStack` count, format characters,
and receiving variables agree exactly. Receive every declared result with the correct
local type and preserve the wrapper's established ordering.

**Boundary:** A zero-result call needs no invented stack read, and a dynamic format needs
its actual wrapper contract inspected. Do not infer types from variable names alone.

**Review:** Count declared results and receivers, map every `d`, `s`, or `b` to its target,
and confirm failure behavior leaves the stack in the expected state.

## R09 — Argument guard placement and size

**Write:** Construct `KLuaArgGuard` for the same Lua state before the first push and size
it to cover the highest `argN` written by the call setup.

**Boundary:** A dynamic argument count is evidence-dependent; report it and never guess a
constant. Do not reuse a guard belonging to another state or count unrelated stack work.

**Review:** Walk pushes in execution order, locate the maximum direct argument index, and
confirm guard destruction occurs after the call consumes all protected values.

## R10 — Stack guard versus direct access

**Write:** Evaluate the complete supported top-count guard and ensure its allowed maximum
covers every positive direct access on that same state. Equality alternatives and bounded
ranges must be judged as whole expressions.

**Boundary:** Dynamic or unsupported guard expressions and indirect helper access are not
proof of a specific count. Resolve the indirect helper contract and do not guess a new
boundary merely from one visible index.

**Review:** Pair each direct access with the dominating guard path, including alternative
counts, and report any helper-owned access whose requirement remains unknown.

## R18 — Table check before traversal

**Write:** Before `Lua_Next`, prove the value at the same index on the same Lua state is a
table using the locally accepted `Lua_IsTable`, `tolua_istable`, or
`lua_type == LUA_TTABLE` form.

**Boundary:** Recognize an already guarded traversal and do not add a duplicate check.
A check on another state, index, or branch does not establish the traversal precondition.

**Review:** Trace the guarded control-flow path into the iteration and verify pushes/pops
do not shift the checked index before traversal.
