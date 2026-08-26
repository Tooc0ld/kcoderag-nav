#!/usr/bin/env node
/** Single bounded PreToolUse dispatcher; every contributor and output boundary fails open. */

const fs = require("node:fs") as typeof import("node:fs");
import { navigationContribution } from "./grep-nudge.cjs";
import { jx3StyleContribution } from "./jx3-style-nudge.cjs";

export const MAX_ADDITIONAL_CONTEXT_CHARS = 600;
const MAX_INPUT_CHARS = 131_072;

export type PreToolContributor = (
  payload: Readonly<Record<string, unknown>>,
) => string | undefined;

const DEFAULT_CONTRIBUTORS: readonly PreToolContributor[] = Object.freeze([
  navigationContribution,
  jx3StyleContribution,
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseForContexts(contexts: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (contexts.length === 0) return undefined;
  const additionalContext = contexts.join("\n\n").slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
  if (additionalContext.length === 0) return undefined;
  return Object.freeze({
    hookSpecificOutput: Object.freeze({
      hookEventName: "PreToolUse",
      additionalContext,
    }),
  });
}

export function dispatchPayload(
  payload: Readonly<Record<string, unknown>>,
  contributors: readonly PreToolContributor[] = DEFAULT_CONTRIBUTORS,
): Readonly<Record<string, unknown>> | undefined {
  const contexts: string[] = [];
  for (const contributor of contributors) {
    try {
      const context = contributor(payload);
      if (typeof context === "string" && context.length > 0) contexts.push(context);
    } catch {
      continue;
    }
  }
  return responseForContexts(contexts);
}

export function dispatchRawInput(
  rawInput: string,
  contributors: readonly PreToolContributor[] = DEFAULT_CONTRIBUTORS,
  parseInput: (rawInput: string) => unknown = JSON.parse,
): Readonly<Record<string, unknown>> | undefined {
  if (rawInput.length === 0 || rawInput.length > MAX_INPUT_CHARS) return undefined;
  try {
    const payload = parseInput(rawInput);
    return isRecord(payload) ? dispatchPayload(payload, contributors) : undefined;
  } catch {
    return undefined;
  }
}

function readBoundedStdin(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= MAX_INPUT_CHARS) {
    const buffer = Buffer.allocUnsafe(Math.min(8_192, MAX_INPUT_CHARS + 1 - total));
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    chunks.push(buffer.subarray(0, count));
    total += count;
  }
  return total > MAX_INPUT_CHARS ? "" : Buffer.concat(chunks, total).toString("utf8");
}

export function main(
  rawInput?: string,
  writeOutput: (text: string) => void = (text) => { process.stdout.write(text); },
  contributors: readonly PreToolContributor[] = DEFAULT_CONTRIBUTORS,
): number {
  try {
    const output = dispatchRawInput(rawInput ?? readBoundedStdin(), contributors);
    if (output !== undefined) writeOutput(JSON.stringify(output));
  } catch {
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
