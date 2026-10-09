#!/usr/bin/env node
/** Compose Claude's existing status line with a cache-only navigation update badge. */

const childProcess = require("node:child_process") as typeof import("node:child_process");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import { readVersionStatus, type UpdateCheckOptions } from "./update-check.cjs";

export const STATUSLINE_MARKER = "kcoderag-nav-statusline";
export const STATUSLINE_BADGE = "\u001b[33m↑ /kcoderag-update\u001b[0m";
export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_COMMAND_CHARS = 32 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const RECURSION_ENV = "KCODERAG_NAV_STATUSLINE_ACTIVE";
const LOCAL_SETTINGS = ".claude/settings.local.json";
const STATE_RELATIVE = ".claude/kcoderag-nav/install-state.json";

type JsonMap = Record<string, unknown>;

export interface ClaudeStatuslineOptions {
  readonly projectRoot?: string;
  readonly homeDirectory?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly updateOptions?: UpdateCheckOptions;
}

function isRecord(value: unknown): value is JsonMap {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath: string): JsonMap | undefined {
  try {
    const metadata = fs.lstatSync(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES) return undefined;
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > MAX_FILE_BYTES) return undefined;
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return isRecord(value) ? value : undefined;
  } catch { return undefined; }
}

function originalLocalSettings(state: JsonMap | undefined): JsonMap | undefined {
  if (state === undefined || !Array.isArray(state.files)) return undefined;
  const file: unknown = state.files.find((item: unknown) => isRecord(item) && item.path === LOCAL_SETTINGS);
  if (!isRecord(file) || !isRecord(file.original) || file.original.kind !== "base64" ||
      typeof file.original.data !== "string" || file.original.data.length > MAX_FILE_BYTES * 2) return undefined;
  try {
    const bytes = Buffer.from(file.original.data, "base64");
    if (bytes.length > MAX_FILE_BYTES || bytes.toString("base64") !== file.original.data) return undefined;
    const document: unknown = JSON.parse(bytes.toString("utf8"));
    return isRecord(document) ? document : undefined;
  } catch { return undefined; }
}

/** Resolve only the relevant setting, without persisting or logging a user command. */
export function readUpstreamStatusline(options: ClaudeStatuslineOptions = {}): unknown {
  const projectRoot = path.resolve(options.projectRoot ?? path.resolve(__dirname, "../../../.."));
  const state = readJson(path.join(projectRoot, STATE_RELATIVE));
  const local = originalLocalSettings(state);
  if (local !== undefined && Object.hasOwn(local, "statusLine")) return local.statusLine;
  const project = readJson(path.join(projectRoot, ".claude/settings.json"));
  if (project !== undefined && Object.hasOwn(project, "statusLine")) return project.statusLine;
  const environment = options.environment ?? process.env;
  const userDirectory = environment.CLAUDE_CONFIG_DIR ||
    path.join(options.homeDirectory ?? os.homedir(), ".claude");
  return readJson(path.join(userDirectory, "settings.json"))?.statusLine;
}

function upstreamCommand(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== "command" || typeof value.command !== "string" ||
      value.command.length === 0 || value.command.length > MAX_COMMAND_CHARS ||
      value.command.includes(STATUSLINE_MARKER) || value.command.includes("claude-statusline.cjs")) return undefined;
  return value.command;
}

export function statuslineShell(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  isFile: (filePath: string) => boolean = (filePath) => {
    try { return fs.statSync(filePath).isFile(); } catch { return false; }
  },
): { readonly executable: string; readonly args: readonly string[] } {
  if (platform !== "win32") {
    const bash = environment.SHELL && /(?:^|\/)bash$/u.test(environment.SHELL)
      ? environment.SHELL : "/bin/bash";
    return { executable: isFile(bash) ? bash : "/bin/sh", args: ["-c"] };
  }
  const candidates: string[] = [];
  if (environment.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(environment.CLAUDE_CODE_GIT_BASH_PATH);
  if (environment.SHELL && /(?:^|[\\/])bash(?:\.exe)?$/iu.test(environment.SHELL)) candidates.push(environment.SHELL);
  for (const directory of (environment.PATH ?? environment.Path ?? "").split(";").filter(Boolean)) {
    // System32/bash.exe is the WSL launcher, not Git Bash.
    if (!/[\\/]system32(?:[\\/]|$)/iu.test(directory)) candidates.push(path.win32.join(directory, "bash.exe"));
    candidates.push(path.win32.resolve(directory, "../bin/bash.exe"));
  }
  for (const directory of [environment.ProgramFiles, environment["ProgramFiles(x86)"]]) {
    if (directory) candidates.push(path.win32.join(directory, "Git/bin/bash.exe"));
  }
  if (environment.LOCALAPPDATA) candidates.push(path.win32.join(environment.LOCALAPPDATA, "Programs/Git/bin/bash.exe"));
  const bash = candidates.find(isFile);
  return bash === undefined
    ? { executable: "pwsh.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] }
    : { executable: bash, args: ["-c"] };
}

/** Capture bounded stdout, suppress stderr, and stop our own process group on limits. */
function runUpstream(command: string, input: Buffer, options: ClaudeStatuslineOptions): Promise<Buffer> {
  return new Promise((resolve) => {
    const environment = options.environment ?? process.env;
    let child: import("node:child_process").ChildProcessWithoutNullStreams;
    try {
      const shell = statuslineShell(environment);
      child = childProcess.spawn(shell.executable, [...shell.args, command], {
        cwd: options.cwd ?? process.cwd(),
        env: { ...environment, [RECURSION_ENV]: "1" },
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch { resolve(Buffer.alloc(0)); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let stopping = false;
    let childClosed = false;
    let killerClosed = true;
    let killer: import("node:child_process").ChildProcess | undefined;
    let cleanupTimer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      process.removeListener("exit", stop);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(Buffer.concat(chunks, size));
    };
    const finishAfterClose = (): void => {
      if (childClosed && killerClosed) finish();
    };
    const killChild = (): void => {
      try { child.kill("SIGKILL"); } catch { /* fail open */ }
    };
    const stop = (): void => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      // A termination request is not an exit acknowledgement. In particular,
      // Windows can retain cwd handles until both taskkill and the tree close.
      cleanupTimer = setTimeout(() => {
        killChild();
        try { killer?.kill("SIGKILL"); } catch { /* fail open */ }
        child.unref();
        killer?.unref();
        finish();
      }, 2000);
      if (child.pid === undefined) {
        childClosed = true;
        finishAfterClose();
        return;
      }
      if (process.platform === "win32") {
        killerClosed = false;
        try {
          // Only the subprocess tree created above is targeted. Keep taskkill
          // referenced until its acknowledgement, rather than returning early.
          killer = childProcess.spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore", windowsHide: true,
          });
          killer.on("error", () => {
            killerClosed = true;
            killChild();
            finishAfterClose();
          });
          killer.on("close", (code) => {
            killerClosed = true;
            if (code !== 0 && !childClosed) killChild();
            finishAfterClose();
          });
        } catch {
          killerClosed = true;
          killChild();
          finishAfterClose();
        }
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { killChild(); }
      }
    };
    const timeout = options.timeoutMs ?? 1500;
    const timer = setTimeout(stop, Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 5000) : 1500);
    // Claude cancels an in-flight renderer when newer session data arrives.
    // The detached POSIX group is ours: never leave it behind with the renderer.
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    process.once("exit", stop);
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - size;
      const kept = chunk.subarray(0, remaining);
      chunks.push(kept);
      size += kept.length;
      if (chunk.length > remaining) stop();
    });
    child.stderr.resume();
    child.stdin.on("error", () => { /* An upstream command may not consume stdin. */ });
    child.on("error", () => {
      // A failed spawn still emits close; it owns no subprocess if pid is absent.
      if (child.pid === undefined) childClosed = true;
      finishAfterClose();
    });
    child.on("close", () => {
      childClosed = true;
      finishAfterClose();
    });
    child.stdin.end(input);
  });
}

export async function renderClaudeStatusline(input: Buffer, options: ClaudeStatuslineOptions = {}): Promise<Buffer> {
  const environment = options.environment ?? process.env;
  if (environment[RECURSION_ENV] === "1" || input.length > MAX_INPUT_BYTES) return Buffer.alloc(0);
  let output: Buffer = Buffer.alloc(0);
  try {
    const command = upstreamCommand(readUpstreamStatusline(options));
    if (command !== undefined) output = await runUpstream(command, input, options);
  } catch { /* Keep an advisory status line fail-open. */ }
  try {
    const projectRoot = path.resolve(options.projectRoot ?? path.resolve(__dirname, "../../../.."));
    const state = readJson(path.join(projectRoot, STATE_RELATIVE));
    const installed = typeof state?.packageVersion === "string" ? state.packageVersion : undefined;
    if (readVersionStatus(installed, options.updateOptions).versionStatus !== "update_available") return output;
    let end = output.length;
    while (end > 0 && (output[end - 1] === 10 || output[end - 1] === 13)) end -= 1;
    const suffix = Buffer.from((end > 0 ? "  " : "") + STATUSLINE_BADGE, "utf8");
    // Insert before trailing line endings so printf/echo output keeps the same row.
    return Buffer.concat([output.subarray(0, end), suffix, output.subarray(end)]);
  } catch { return output; }
}

async function readInput(): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: Buffer | undefined): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.pause();
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), 1500);
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) finish(undefined);
      else chunks.push(chunk);
    });
    process.stdin.on("end", () => finish(Buffer.concat(chunks, size)));
    process.stdin.on("error", () => finish(undefined));
    process.stdin.resume();
  });
}

export async function main(): Promise<void> {
  try {
    const input = await readInput();
    if (input !== undefined) process.stdout.write(await renderClaudeStatusline(input));
  } catch { /* Never print payloads, upstream commands, or configuration errors. */ }
}

/** A relocatable, cross-shell Node bootstrap; package paths never enter shell syntax. */
export function renderClaudeStatuslineCommand(): string {
  // Verify the state and the two executable modules before loading either one.
  const bootstrap = String.raw`const f=require('node:fs'),p=require('node:path'),h=require('node:crypto');
try{let d=p.resolve(process.cwd());for(let n=0;n<256;n++){
const s=p.join(d,'.claude/kcoderag-nav/install-state.json');let m;
try{m=f.lstatSync(s)}catch(e){if(e.code!=='ENOENT')break;const parent=p.dirname(d);if(parent===d)break;d=parent;continue}
const read=r=>{let q=d;const parts=r.split('/');for(let i=0;i<parts.length;i++){q=p.join(q,parts[i]);const t=f.lstatSync(q);if(t.isSymbolicLink()||(i<parts.length-1?!t.isDirectory():!t.isFile()))return}const t=f.lstatSync(q);if(t.size>1048576)return;const b=f.readFileSync(q);if(b.length>1048576)return;return b};
const b=read('.claude/kcoderag-nav/install-state.json');if(!b)break;const j=JSON.parse(b.toString('utf8'));
if(j.schemaVersion!==1||j.host!=='claude'||!Array.isArray(j.files)||!Array.isArray(j.capabilities)||!j.capabilities.some(x=>x.id==='kcoderag-navigation'))break;
const v={schemaVersion:j.schemaVersion,packageVersion:j.packageVersion,host:j.host,capabilities:j.capabilities,files:j.files,sections:j.sections};
if(h.createHash('sha256').update(JSON.stringify(v)).digest('hex')!==j.compositeDigest)break;
let ok=true;for(const name of ['claude-statusline.cjs','update-check.cjs']){const r='.claude/kcoderag-nav/qa/hooks/'+name,a=j.files.find(x=>x.path===r),c=read(r);if(!a||!c||h.createHash('sha256').update(c).digest('hex')!==a.digest){ok=false;break}}
if(ok)require(p.join(d,'.claude/kcoderag-nav/qa/hooks/claude-statusline.cjs')).main();break}}catch{}`;
  const encoded = Buffer.from(bootstrap, "utf8").toString("base64");
  return `node -e "eval(Buffer.from(process.argv[1],'base64').toString())" ${encoded} ${STATUSLINE_MARKER}`;
}

if (require.main === module) void main();
