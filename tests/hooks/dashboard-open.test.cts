const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const cp = require("node:child_process") as typeof import("node:child_process");
const path = require("node:path") as typeof import("node:path");
const { browserLaunch, dashboardUrl, DEFAULT_DASHBOARD_URL, handleDashboardInput, MAX_DASHBOARD_INPUT_BYTES } = require("../../dist/hooks/dashboard-open.cjs") as Record<string, any>;

test("dashboard consumes exact explicit commands, preserving an explicit URL without inference", () => {
  for (const command of ["/kcoderag-dashboard", "$kcoderag-dashboard", "kcoderag-dashboard"]) {
    assert.equal(dashboardUrl(` ${command} `), DEFAULT_DASHBOARD_URL);
    assert.equal(dashboardUrl(`${command} https://example.test/build/42?view=graph#detail`), "https://example.test/build/42?view=graph#detail");
  }
  for (const prompt of ["please run /kcoderag-dashboard", "/kcoderag-dashboard-extra", "/kcoderag-dashboard\n", "/kcoderag-dashboard file:///tmp/x", "/kcoderag-dashboard https://user:secret@example.test", "/kcoderag-dashboard https://example.test\\x", "/kcoderag-dashboard https://example.test/%0a", "/kcoderag-dashboard https://example.test x", "x".repeat(5000), null]) {
    assert.equal(dashboardUrl(prompt), undefined);
  }
});

test("dashboard stops only input events on supported hosts, and failure still avoids inference", () => {
  for (const host of ["claude", "codex", "cursor"] as const) {
    let count = 0;
    const event = host === "cursor" ? "beforeSubmitPrompt" : "UserPromptSubmit";
    const payload = { hook_event_name: event, prompt: "/kcoderag-dashboard" };
    const result = handleDashboardInput(payload, host, (url: string) => { count++; assert.equal(url, DEFAULT_DASHBOARD_URL); return true; });
    assert.equal(count, 1);
    assert.equal(host === "cursor" ? result?.continue : result?.decision, host === "cursor" ? false : "block");
    assert.match(JSON.stringify(result), /已请求/u);
    const failed = handleDashboardInput(payload, host, () => { throw new Error("private subprocess body"); });
    assert.match(JSON.stringify(failed), /未能启动/u);
    assert.doesNotMatch(JSON.stringify(failed), /private/u);
    for (const invalid of [null, [], {}, { ...payload, prompt: "explain the dashboard" }, { ...payload, hook_event_name: "PreToolUse" }]) {
      assert.equal(handleDashboardInput(invalid, host, () => { throw new Error("must not open"); }), undefined);
    }
  }
  assert.equal(handleDashboardInput({ prompt: "/kcoderag-dashboard" }, "cursor", () => true)?.continue, false);
});

test("browser launch keeps URL metacharacters out of shell code and handles headless sessions", () => {
  const url = "https://example.test/?q=';$env:PATH&value=$(calc.exe)";
  const windows = browserLaunch(url, "win32", {});
  assert.equal(windows?.command, "pwsh.exe");
  assert.equal(windows?.env.KCODERAG_DASHBOARD_OPEN_URL, url);
  assert.equal(windows?.args.some((arg: string) => arg.includes(url)), false);
  assert.equal(browserLaunch(url, "darwin", {})?.args[0], url);
  assert.equal(browserLaunch(url, "linux", { DISPLAY: ":0" })?.command, "xdg-open");
  assert.equal(browserLaunch(url, "linux", {}), undefined);
  assert.equal(browserLaunch(url, "win32", { SSH_CONNECTION: "remote" }), undefined);
});

test("dashboard CLI bounds malformed and oversized stdin with exit zero and no output", () => {
  for (const input of ["{", " ".repeat(MAX_DASHBOARD_INPUT_BYTES + 1), JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "ordinary input" })]) {
    const result = cp.spawnSync(process.execPath, [path.resolve("dist/hooks/dashboard-open.cjs"), "claude"], { input, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});
