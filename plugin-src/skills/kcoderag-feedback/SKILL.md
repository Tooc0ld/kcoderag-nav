---
name: kcoderag-feedback
description: Submit secret-safe feedback about a real KCodeRag query result. Use only when the user wants to evaluate an observed result; do not invent opinions, quote source bodies, or expose connection configuration.
---

# KCodeRag Feedback

Use the KCodeRag `submit_feedback` interface only for an actual query result the user has
observed. Identify the result through the feedback fields exposed by the current host and keep
the evaluation grounded in what that result demonstrated.

- Preserve the user's meaning; do not invent praise, criticism, ratings, or rationale.
- Submit only the minimum result identifier and evaluation required by the interface.
- Do not include source code, file contents, MCP URLs, headers, bearer values, tokens,
  configuration bodies, or unrelated conversation text.
- If there is no real result, required identifier, or clear user evaluation, explain what is
  missing and do not submit feedback.

This Skill does not perform code navigation, edit files, or manage installation lifecycle.
