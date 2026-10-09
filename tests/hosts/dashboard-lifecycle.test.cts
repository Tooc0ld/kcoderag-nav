const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const commands = require("../../dist/cli/commands.cjs") as Record<string, any>;
const stateModule = require("../../dist/core/state.cjs") as Record<string, any>;
const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const HOSTS = Object.freeze([
  { id: "codex", skillRoot: ".agents/skills", version: "0.146.1", factory: "createCodexAdapter" },
  { id: "claude", skillRoot: ".claude/skills", version: "2.1.241", factory: "createClaudeAdapter" },
  { id: "cursor", skillRoot: ".cursor/skills", version: "3.17.8", factory: "createCursorAdapter" },
  { id: "opencode", skillRoot: ".opencode/skills", version: "1.18.23", factory: "createOpenCodeAdapter" },
  { id: "zcode", skillRoot: ".zcode/skills", version: "0.0.0", factory: "createZCodeAdapter" },
] as const);

test("dashboard is owned, upgradeable, drift-protected, and removable on every host", async (t) => {
  for (const host of HOSTS) {
    await t.test(host.id, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-dashboard-${host.id}-`));
      const project = path.join(root, "project");
      const homeDirectory = path.join(root, "home");
      fs.mkdirSync(project);
      fs.mkdirSync(homeDirectory);
      const adapterModule = require(`../../dist/hosts/${host.id}.cjs`) as Record<string, any>;
      const adapter = adapterModule[host.factory]({ homeDirectory, hostVersion: host.version, evidenceRoot: PACKAGE_ROOT });
      const run = async (command: string): Promise<{ code: number; payload: any }> => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const mutation = ["install", "update", "uninstall"].includes(command);
        const code = await commands.executeCommand([
          command, "--host", host.id,
          ...(mutation ? ["--capability", NAVIGATION, "--yes"] : []), "--json",
        ], {
          cwd: project, packageRoot: PACKAGE_ROOT, nodeVersion: "22.0.0",
          mutationLockRoot: path.join(root, "locks"), confirmTarget: () => true,
          getAdapter: () => adapter,
          stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text),
        });
        assert.equal(stderr.length, 0);
        assert.equal(stdout.length, 1);
        return { code, payload: JSON.parse(stdout[0] as string) };
      };
      const skillPath = `${host.skillRoot}/kcoderag-dashboard/SKILL.md`;
      const metadataPath = `${host.skillRoot}/kcoderag-dashboard/agents/openai.yaml`;
      const ownedPaths = host.id === "codex" ? [skillPath, metadataPath] : [skillPath];
      const statePath = path.join(project, `.${host.id}/kcoderag-nav/install-state.json`);
      try {
        const sentinel = path.join(project, "unrelated.txt");
        fs.writeFileSync(sentinel, "preserve user content\n");
        assert.equal((await run("install")).code, 0);
        assert.equal((await run("status")).payload.status, "healthy");
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        for (const relativePath of ownedPaths) {
          assert.equal(fs.existsSync(path.join(project, relativePath)), true);
          assert.deepEqual(state.files.find((file: any) => file.path === relativePath)?.contributors, [NAVIGATION]);
          assert.equal(state.capabilities.find((entry: any) => entry.id === NAVIGATION).files.includes(relativePath), true);
        }
        const expected = fs.readFileSync(path.join(PACKAGE_ROOT, "plugin-src/skills/kcoderag-dashboard/SKILL.md"));
        assert.deepEqual(fs.readFileSync(path.join(project, skillPath)), expected);

        // Seed a valid prior installation that predates the new asset, then use the public update path.
        for (const relativePath of ownedPaths) fs.unlinkSync(path.join(project, relativePath));
        const legacy = stateModule.createInstallState({
          schemaVersion: state.schemaVersion, packageVersion: "0.0.1", host: state.host,
          files: state.files.filter((file: any) => !ownedPaths.includes(file.path)),
          sections: state.sections,
          capabilities: state.capabilities.map((entry: any) => ({
            ...entry, files: entry.files.filter((file: string) => !ownedPaths.includes(file)),
          })),
        });
        fs.writeFileSync(statePath, `${JSON.stringify(legacy)}\n`);
        assert.equal((await run("update")).code, 0);
        assert.deepEqual(fs.readFileSync(path.join(project, skillPath)), expected);
        for (const relativePath of ownedPaths) assert.equal(fs.existsSync(path.join(project, relativePath)), true);
        assert.equal((await run("doctor")).payload.status, "healthy");

        // Local edits remain user-owned until restored; uninstall must refuse to erase them.
        fs.appendFileSync(path.join(project, skillPath), "\nLocal project note.\n");
        assert.equal((await run("doctor")).payload.status, "drifted");
        assert.equal((await run("uninstall")).code, 1);
        assert.equal(fs.existsSync(path.join(project, skillPath)), true);
        fs.writeFileSync(path.join(project, skillPath), expected);
        assert.equal((await run("uninstall")).code, 0);
        for (const relativePath of ownedPaths) assert.equal(fs.existsSync(path.join(project, relativePath)), false);
        assert.equal((await run("status")).payload.status, "not_installed");
        assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve user content\n");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
