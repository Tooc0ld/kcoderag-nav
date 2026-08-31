#!/usr/bin/env node
/** Classify bounded GitHub changes for lightweight documentation CI or full CI. */
const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const { TextDecoder } = require("node:util") as typeof import("node:util");

type CiChangeScope = "documentation" | "full";

interface JsonObject {
  readonly [key: string]: unknown;
}

interface CiScopeResult {
  readonly scope: CiChangeScope;
  readonly changedCount: number;
}

interface EvaluateOptions {
  readonly eventName: string;
  readonly event: unknown;
  readonly githubSha?: string;
  readonly readDiff?: (range: string) => Buffer;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ZERO_SHA = "0".repeat(40);
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_CHANGED_PATHS = 3000;
const MAX_PATH_CHARACTERS = 1024;
const DOCUMENTATION_ROOT_FILES = new Set(["README.md"]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedString(value: unknown, keys: readonly string[]): string | undefined {
  let current = value;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

function isCommitSha(value: string | undefined): value is string {
  return value !== undefined && SHA_PATTERN.test(value);
}

function resolveDiffRange(eventName: string, event: unknown, githubSha?: string): string | undefined {
  if (eventName === "pull_request") {
    const base = nestedString(event, ["pull_request", "base", "sha"]);
    const head = nestedString(event, ["pull_request", "head", "sha"]);
    if (!isCommitSha(base) || !isCommitSha(head)) return undefined;
    return `${base}...${head}`;
  }
  if (eventName === "push") {
    const before = nestedString(event, ["before"]);
    const eventAfter = nestedString(event, ["after"]);
    const after = isCommitSha(eventAfter) ? eventAfter : githubSha;
    if (!isCommitSha(before) || before === ZERO_SHA || !isCommitSha(after)) return undefined;
    return `${before}..${after}`;
  }
  return undefined;
}

function isCanonicalRepositoryPath(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_PATH_CHARACTERS
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && path.posix.normalize(value) === value;
}

function isDocumentationPath(value: string): boolean {
  return DOCUMENTATION_ROOT_FILES.has(value)
    || value.startsWith("docs/")
    || value.startsWith(".planning/");
}

function classifyChangedPaths(paths: readonly string[]): CiChangeScope {
  if (paths.length === 0 || paths.length > MAX_CHANGED_PATHS) return "full";
  const uniquePaths = new Set<string>();
  for (const value of paths) {
    if (!isCanonicalRepositoryPath(value)) return "full";
    uniquePaths.add(value);
    if (uniquePaths.size > MAX_CHANGED_PATHS) return "full";
  }
  return [...uniquePaths].every(isDocumentationPath) ? "documentation" : "full";
}

function decodeChangedPaths(bytes: Buffer): readonly string[] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DIFF_BYTES || bytes.at(-1) !== 0) {
    throw new Error("diff_invalid");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const values = source.slice(0, -1).split("\0");
  if (values.length === 0 || values.some((value) => value.length === 0)) throw new Error("diff_invalid");
  return values;
}

function readGitDiff(range: string): Buffer {
  const result = childProcess.spawnSync(
    "git",
    ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", range, "--"],
    {
      cwd: process.cwd(),
      encoding: "buffer",
      maxBuffer: MAX_DIFF_BYTES + 1,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("diff_failed");
  }
  return result.stdout;
}

function evaluateCiChangeScope(options: EvaluateOptions): CiScopeResult {
  if (options.eventName === "workflow_dispatch") {
    return Object.freeze({ scope: "full", changedCount: 0 });
  }
  const range = resolveDiffRange(options.eventName, options.event, options.githubSha);
  if (range === undefined) return Object.freeze({ scope: "full", changedCount: 0 });
  try {
    const changedPaths = decodeChangedPaths((options.readDiff ?? readGitDiff)(range));
    return Object.freeze({
      scope: classifyChangedPaths(changedPaths),
      changedCount: new Set(changedPaths).size,
    });
  } catch {
    return Object.freeze({ scope: "full", changedCount: 0 });
  }
}

function readEvent(eventPath: string): unknown {
  const stat = fs.lstatSync(eventPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_EVENT_BYTES) {
    throw new Error("event_invalid");
  }
  const bytes = fs.readFileSync(eventPath);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
  readDiff: (range: string) => Buffer = readGitDiff,
): number {
  if (argv.length !== 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "unexpected_argument" })}\n`);
    return 2;
  }
  const outputPath = environment["GITHUB_OUTPUT"];
  if (outputPath === undefined || outputPath.length === 0) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "github_output_missing" })}\n`);
    return 2;
  }

  let result: CiScopeResult = Object.freeze({ scope: "full", changedCount: 0 });
  try {
    const eventPath = environment["GITHUB_EVENT_PATH"];
    const event = eventPath === undefined ? Object.freeze({}) : readEvent(eventPath);
    result = evaluateCiChangeScope({
      eventName: environment["GITHUB_EVENT_NAME"] ?? "",
      event,
      ...(environment["GITHUB_SHA"] === undefined ? {} : { githubSha: environment["GITHUB_SHA"] }),
      readDiff,
    });
  } catch {
    // Event and diff ambiguity deliberately select full CI without exposing payload details.
  }

  try {
    fs.appendFileSync(
      outputPath,
      `scope=${result.scope}\nchanged_count=${String(result.changedCount)}\n`,
      "utf8",
    );
    return 0;
  } catch {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "github_output_write_failed" })}\n`);
    return 1;
  }
}

exports.classifyChangedPaths = classifyChangedPaths;
exports.evaluateCiChangeScope = evaluateCiChangeScope;
exports.main = main;
exports.resolveDiffRange = resolveDiffRange;

if (require.main === module) process.exitCode = main();
