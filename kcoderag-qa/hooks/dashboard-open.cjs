#!/usr/bin/env node
"use strict";
/** Consume only explicit dashboard commands before inference; never execute prompt text. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DASHBOARD_INPUT_BYTES = exports.DEFAULT_DASHBOARD_URL = void 0;
exports.dashboardUrl = dashboardUrl;
exports.browserLaunch = browserLaunch;
exports.openDashboard = openDashboard;
exports.handleDashboardInput = handleDashboardInput;
exports.main = main;
const childProcess = require("node:child_process");
exports.DEFAULT_DASHBOARD_URL = "http://10.11.39.59:30107/";
exports.MAX_DASHBOARD_INPUT_BYTES = 131_072;
/** Keep the original URL bytes; a shell never parses this value. */
function dashboardUrl(prompt) {
    if (typeof prompt !== "string" || prompt.length > 4096 || /[\r\n\0]/u.test(prompt))
        return undefined;
    const match = /^(?:\/|\$)?kcoderag-dashboard(?:[ \t]+(\S+))?$/u.exec(prompt.trim());
    if (match === null)
        return undefined;
    const value = match[1] ?? exports.DEFAULT_DASHBOARD_URL;
    if (value.length > 2048 || /[\u0000-\u0020\u007f-\u009f\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value))
        return undefined;
    try {
        const url = new URL(value);
        if (!/^https?:\/\//iu.test(value) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
/** The fixed PowerShell program reads the URL as data, including quotes and shell metacharacters. */
function browserLaunch(url, platform = process.platform, env = process.env) {
    if (env.SSH_CONNECTION || env.SSH_TTY)
        return undefined;
    if (platform === "win32")
        return {
            command: "pwsh.exe",
            args: ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:KCODERAG_DASHBOARD_OPEN_URL -ErrorAction Stop"],
            env: { ...env, KCODERAG_DASHBOARD_OPEN_URL: url },
        };
    if (platform === "darwin")
        return { command: "open", args: [url], env };
    if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY))
        return { command: "xdg-open", args: [url], env };
    return undefined;
}
/** Success confirms only that the OS accepted the launch request, never page readiness. */
function openDashboard(url) {
    const launch = browserLaunch(url);
    if (launch === undefined)
        return false;
    try {
        const result = childProcess.spawnSync(launch.command, [...launch.args], {
            env: launch.env, shell: false, windowsHide: true, stdio: "ignore", timeout: 1500,
        });
        return result.error === undefined && result.status === 0;
    }
    catch {
        return false;
    }
}
/** Unrelated/malformed input fails open; a recognized command is consumed even if no browser exists. */
function handleDashboardInput(input, host, open = openDashboard) {
    if (typeof input !== "object" || input === null || Array.isArray(input))
        return undefined;
    const payload = input;
    if (host === "cursor") {
        // Cursor's documented minimal payload may omit hook_event_name.
        if (payload.hook_event_name !== undefined && payload.hook_event_name !== "beforeSubmitPrompt")
            return undefined;
    }
    else if ((host !== "claude" && host !== "codex") || payload.hook_event_name !== "UserPromptSubmit")
        return undefined;
    const url = dashboardUrl(payload.prompt);
    if (url === undefined)
        return undefined;
    let opened = false;
    try {
        opened = open(url);
    }
    catch { /* Report a local failure without starting inference. */ }
    const message = opened
        ? "已请求默认浏览器打开 KCodeRag 看板。"
        : `未能启动本机浏览器，请手动打开：${url}`;
    return host === "cursor"
        ? { continue: false, user_message: message }
        : { decision: "block", reason: message };
}
/** Bounded stdin and an unconditional exit-zero boundary keep malformed events harmless. */
function main(host = process.argv[2]) {
    if (Number(process.versions.node.split(".")[0]) < 22)
        return;
    if (host !== "claude" && host !== "codex" && host !== "cursor")
        return;
    let bytes = 0;
    const chunks = [];
    const timer = setTimeout(() => process.exit(0), 1000);
    process.stdin.on("error", () => process.exit(0));
    process.stdin.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > exports.MAX_DASHBOARD_INPUT_BYTES)
            process.exit(0);
        chunks.push(chunk);
    });
    process.stdin.on("end", () => {
        clearTimeout(timer);
        try {
            const result = handleDashboardInput(JSON.parse(Buffer.concat(chunks).toString("utf8")), host);
            if (result !== undefined)
                process.stdout.write(`${JSON.stringify(result)}\n`);
        }
        catch { /* Empty stdout is the fail-open protocol. */ }
    });
}
if (require.main === module)
    main();
