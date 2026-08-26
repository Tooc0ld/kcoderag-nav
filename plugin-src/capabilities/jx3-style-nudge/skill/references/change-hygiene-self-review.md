# Change Hygiene and Self-Review

Use this reference before risky formatting or encoding edits and once at task completion.
Review the actual changed region only. Preserve the semantic indentation and byte
baseline required by the change; do not turn a bounded correction into broad cleanup.

## JX3-S01 — Unrelated whitespace drift

**Write:** Keep semantic indentation introduced by a real branch or control-flow change,
but preserve pre-existing spacing and alignment elsewhere in the changed region. Restore
only unrelated spacing, alignment, or formatting drift that the task did not require.

**Boundary:** Do not undo braces, `else`, control flow, or semantic indentation, and never
move a declaration back across a `goto` boundary merely to recreate an old visual layout.

**Review:** Compare the necessary change budget with the final hunk and remove only
proven formatter collateral. Leave untouched regions outside the task alone.

## JX3-S07 — Boolean literal spelling

**Write:** Prefer lowercase `true` and `false` when a changed executable token is a native
C++ or Lua boolean literal and the surrounding type contract accepts that spelling.

**Boundary:** Preserve uppercase tokens required by an external API, legacy macro,
protocol/schema constant, or identifier. Comments, strings, and names such as
`MY_TRUE_VALUE` are not boolean-literal corrections.

**Review:** Classify the token from syntax and declaration context before changing it;
do not perform file-wide textual replacement.

## JX3-S08 — Encoding, BOM, and line endings

**Write:** Preserve the file's existing encoding, BOM, and line ending baseline through
an encoding-safe edit path. Limit byte changes to the intended hunk and retain unrelated
content byte-for-byte when the available tool can prove it.

**Boundary:** Without actual before/after byte evidence, report byte integrity as not
verified. An already mixed file needs a baseline-aware comparison; do not normalize or
re-encode it opportunistically.

**Review:** Check the named evidence for encoding validity, BOM state, newline counts,
and unchanged bytes outside the hunk. Do not convert a visual source review into an
encoding-clean claim.

## Final bounded self-review

1. Review only files and regions changed in this task; do not inspect or modernize the
   rest of the project as part of a style correction.
2. Recheck the compact index and load only the references relevant to risks actually
   introduced by the change.
3. Minimally repair a clear self-introduced issue when its contract is proven and the
   correction stays within the requested behavior.
4. When a declaration, owner, external table, byte baseline, or business decision is
   missing, report the precise open question and the evidence needed to answer it.
5. Disclose any conflict with user or project instructions and follow the higher-priority
   source. Report source review, build, deployment, persistence, runtime, UI, and byte
   evidence as separate classes; never imply an unperformed proof.
