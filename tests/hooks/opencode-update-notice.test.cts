const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");
const { pathToFileURL } = require("node:url") as typeof import("node:url");

interface PluginModule {
  KCodeRagNav(context: {
    readonly client: { readonly tui: { showToast(input: unknown): Promise<boolean> } };
    readonly directory: string;
  }): Promise<Record<string, (input: unknown) => Promise<void>>>;
}

interface GlobalFixture {
  calls: unknown[][];
  fail: boolean;
}

function fixtureGlobal(): GlobalFixture {
  return (globalThis as unknown as { __kcoderagOpenCodeFixture: GlobalFixture }).__kcoderagOpenCodeFixture;
}

test("OpenCode after-event records success and shows one fail-open cached update toast", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kcoderag-opencode-update-"));
  try {
    const pluginPath = path.join(root, ".opencode", "plugins", "kcoderag-nav.mjs");
    const hooksRoot = path.join(root, ".opencode", "kcoderag-nav", "hooks");
    await fs.mkdir(path.dirname(pluginPath), { recursive: true });
    await fs.mkdir(hooksRoot, { recursive: true });
    await fs.copyFile(path.resolve("plugin-src/opencode/kcoderag-nav.js"), pluginPath);
    await fs.writeFile(path.join(hooksRoot, "mcp-call-marker.cjs"), [
      "exports.recordKCodeRagCall=(input,options)=>{",
      "const f=globalThis.__kcoderagOpenCodeFixture;",
      "f.calls.push(['marker',input,options]);",
      "if(f.fail)throw new Error('marker failure');",
      "};\n",
    ].join(""));
    await fs.writeFile(path.join(hooksRoot, "update-notice.cjs"), [
      "exports.readHostUpdateNotice=(host,input,options)=>{",
      "const f=globalThis.__kcoderagOpenCodeFixture;",
      "f.calls.push(['notice',host,input,options]);",
      "if(f.fail)throw new Error('notice failure');",
      "return 'KCodeRag Nav update available';",
      "};",
      "exports.scheduleHostUpdateRefresh=(host,input,options)=>{",
      "globalThis.__kcoderagOpenCodeFixture.calls.push(['refresh',host,input,options]);",
      "return true;",
      "};\n",
    ].join(""));

    (globalThis as unknown as { __kcoderagOpenCodeFixture: GlobalFixture }).__kcoderagOpenCodeFixture = {
      calls: [],
      fail: false,
    };
    const plugin = await import(`${pathToFileURL(pluginPath).href}?fixture=${Date.now()}`) as PluginModule;
    const hooks = await plugin.KCodeRagNav({
      directory: root,
      client: {
        tui: {
          showToast: async (input) => {
            fixtureGlobal().calls.push(["toast", input]);
            return true;
          },
        },
      },
    });
    const after = hooks["tool.execute.after"];
    assert.equal(typeof after, "function");
    if (after === undefined) throw new Error("missing tool.execute.after hook");
    const input = { tool: "read", sessionID: "session-a", args: { token: "must-not-leak" } };
    await after(input);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(fixtureGlobal().calls, [
      ["marker", input, { host: "opencode" }],
      ["notice", "opencode", input, { cwd: root }],
      ["refresh", "opencode", input, { cwd: root, runtimePath: "node" }],
      ["toast", { body: { message: "KCodeRag Nav update available", variant: "warning" } }],
    ]);

    fixtureGlobal().calls = [];
    fixtureGlobal().fail = true;
    await assert.doesNotReject(after(input));
    assert.deepEqual(fixtureGlobal().calls, [
      ["marker", input, { host: "opencode" }],
      ["notice", "opencode", input, { cwd: root }],
    ]);
  } finally {
    delete (globalThis as unknown as { __kcoderagOpenCodeFixture?: GlobalFixture }).__kcoderagOpenCodeFixture;
    await fs.rm(root, { recursive: true, force: true });
  }
});
