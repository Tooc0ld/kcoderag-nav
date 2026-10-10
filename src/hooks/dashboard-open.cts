#!/usr/bin/env node
/** Consume only explicit dashboard commands before inference; never execute prompt text. */

const childProcess = require("node:child_process") as typeof import("node:child_process");

export const DEFAULT_DASHBOARD_URL = "http://10.11.39.59:30107/";
export const MAX_DASHBOARD_INPUT_BYTES = 131_072;
export type DashboardHost = "claude" | "codex" | "cursor";

/** Keep the original URL bytes; a shell never parses this value. */
export function dashboardUrl(prompt: unknown): string | undefined {
  if (typeof prompt !== "string" || prompt.length > 4096 || /[\r\n\0]/u.test(prompt)) return undefined;
  const match = /^(?:\/|\$)?kcoderag-dashboard(?:[ \t]+(\S+))?$/u.exec(prompt.trim());
  if (match === null) return undefined;
  const value = match[1] ?? DEFAULT_DASHBOARD_URL;
  if (value.length > 2048 || /[\u0000-\u0020\u007f-\u009f\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:\/\//iu.test(value) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined;
    return value;
  } catch { return undefined; }
}

export interface BrowserLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** The fixed PowerShell program reads the URL as data, including quotes and shell metacharacters. */
export function browserLaunch(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): BrowserLaunch | undefined {
  if (env.SSH_CONNECTION || env.SSH_TTY) return undefined;
  if (platform === "win32") return {
    command: "pwsh.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:KCODERAG_DASHBOARD_OPEN_URL -ErrorAction Stop"],
    env: { ...env, KCODERAG_DASHBOARD_OPEN_URL: url },
  };
  if (platform === "darwin") return { command: "open", args: [url], env };
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY)) return { command: "xdg-open", args: [url], env };
  return undefined;
}

/** Success confirms only that the OS accepted the launch request, never page readiness. */
export function openDashboard(url: string): boolean {
  const launch = browserLaunch(url);
  if (launch === undefined) return false;
  try {
    const result = childProcess.spawnSync(launch.command, [...launch.args], {
      env: launch.env, shell: false, windowsHide: true, stdio: "ignore", timeout: 1500,
    });
    return result.error === undefined && result.status === 0;
  } catch { return false; }
}

/** Unrelated/malformed input fails open; a recognized command is consumed even if no browser exists. */
export function handleDashboardInput(
  input: unknown,
  host: DashboardHost,
  open: (url: string) => boolean = openDashboard,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const payload = input as Record<string, unknown>;
  if (host === "cursor") {
    // Cursor's documented minimal payload may omit hook_event_name.
    if (payload.hook_event_name !== undefined && payload.hook_event_name !== "beforeSubmitPrompt") return undefined;
  } else if ((host !== "claude" && host !== "codex") || payload.hook_event_name !== "UserPromptSubmit") return undefined;
  const url = dashboardUrl(payload.prompt);
  if (url === undefined) return undefined;
  let opened = false;
  try { opened = open(url); } catch { /* Report a local failure without starting inference. */ }
  const message = opened
    ? "已请求默认浏览器打开 KCodeRag 看板。"
    : `未能启动本机浏览器，请手动打开：${url}`;
  return host === "cursor"
    ? { continue: false, user_message: message }
    : { decision: "block", reason: message };
}

/** Bounded stdin and an unconditional exit-zero boundary keep malformed events harmless. */
export function main(host: unknown = process.argv[2]): void {
  if (Number(process.versions.node.split(".")[0]) < 22) return;
  if (host !== "claude" && host !== "codex" && host !== "cursor") return;
  let bytes = 0;
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => process.exit(0), 1000);
  process.stdin.on("error", () => process.exit(0));
  process.stdin.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_DASHBOARD_INPUT_BYTES) process.exit(0);
    chunks.push(chunk);
  });
  process.stdin.on("end", () => {
    clearTimeout(timer);
    try {
      const result = handleDashboardInput(JSON.parse(Buffer.concat(chunks).toString("utf8")), host);
      if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch { /* Empty stdout is the fail-open protocol. */ }
  });
}

if (require.main === module) main();
