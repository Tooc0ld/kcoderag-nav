const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

const commands = require("../../dist/cli/commands.cjs") as Record<string, any>;
const codex = require("../../dist/hosts/codex.cjs") as Record<string, any>;
const claude = require("../../dist/hosts/claude.cjs") as Record<string, any>;
const cursor = require("../../dist/hosts/cursor.cjs") as Record<string, any>;
const opencode = require("../../dist/hosts/opencode.cjs") as Record<string, any>;
const zcode = require("../../dist/hosts/zcode.cjs") as Record<string, any>;

const PACKAGE_ROOT = path.resolve(".");
const NAVIGATION = "kcoderag-navigation";
const SOURCE_NAMES = Object.freeze([
  "kcoderag",
  "kcoderag-manage",
  "kcoderag-update",
  "kcoderag-feedback",
  "kcoderag-code-style",
  "kcoderag-nav",
  "code-style-correction",
] as const);

const HOSTS = Object.freeze([
  { id: "codex", skillRoot: ".codex/skills", create: (homeDirectory: string) => codex.createCodexAdapter({ homeDirectory, hostVersion: "0.146.1", evidenceRoot: PACKAGE_ROOT }) },
  { id: "claude", skillRoot: ".claude/skills", create: (homeDirectory: string) => claude.createClaudeAdapter({ homeDirectory, hostVersion: "2.1.241", evidenceRoot: PACKAGE_ROOT }) },
  { id: "cursor", skillRoot: ".cursor/skills", create: (homeDirectory: string) => cursor.createCursorAdapter({ homeDirectory, hostVersion: "3.17.8", evidenceRoot: PACKAGE_ROOT }) },
  { id: "opencode", skillRoot: ".config/opencode/skills", create: (homeDirectory: string) => opencode.createOpenCodeAdapter({ homeDirectory, hostVersion: "1.18.23", evidenceRoot: PACKAGE_ROOT }) },
  { id: "zcode", skillRoot: ".zcode/skills", create: (homeDirectory: string) => zcode.createZCodeAdapter({ homeDirectory, hostVersion: "0.0.0", evidenceRoot: PACKAGE_ROOT }) },
] as const);

function digest(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function snapshot(root: string): readonly string[] {
  const records: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else records.push(`${path.relative(root, absolute).replaceAll("\\", "/")}:${digest(fs.readFileSync(absolute))}`);
    }
  };
  visit(root);
  return Object.freeze(records);
}

test("all hosts gate every current and retained legacy public Skill source before every mutation", async (t) => {
  for (const host of HOSTS) {
    await t.test(host.id, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `kcoderag-public-source-${host.id}-`));
      const targetRoot = path.join(root, "target");
      const homeDirectory = path.join(root, "home");
      try {
        fs.mkdirSync(targetRoot);
        fs.mkdirSync(homeDirectory);
        const secret = `Bearer source-fixture-${crypto.randomUUID()}`;
        for (const name of SOURCE_NAMES) {
          const skillPath = path.join(homeDirectory, ...host.skillRoot.split("/"), name, "SKILL.md");
          fs.mkdirSync(path.dirname(skillPath), { recursive: true });
          fs.writeFileSync(skillPath, `manual source\n${secret}\n`, "utf8");
        }
        const sentinelPath = path.join(targetRoot, "sentinel.txt");
        fs.writeFileSync(sentinelPath, "keep exact bytes\n", "utf8");
        const adapter = host.create(homeDirectory);
        const observation = adapter.detect({ target: require("../../dist/core/project-target.cjs").resolveProjectTarget(targetRoot), packageRoot: PACKAGE_ROOT });
        const scan = await adapter.scanUserSources({
          target: observation.target,
          packageRoot: PACKAGE_ROOT,
          mode: "gate",
          observation,
        });
        const expectedPaths = SOURCE_NAMES.map((name) => `${host.skillRoot}/${name}/SKILL.md`).sort();
        assert.equal(scan.hasConflict, true);
        assert.deepEqual(scan.findings.map((finding: any) => [finding.code, finding.safePath]),
          expectedPaths.map((safePath) => ["ambiguous_source", safePath]));
        assert.equal(JSON.stringify(scan).includes(secret), false);

        for (const command of ["install", "update", "uninstall"] as const) {
          let renderCalled = false;
          const guardedAdapter = {
            ...adapter,
            renderInstall: () => { renderCalled = true; throw new Error("renderInstall must not run after a source conflict"); },
            renderUninstall: () => { renderCalled = true; throw new Error("renderUninstall must not run after a source conflict"); },
          };
          const stdout: string[] = [];
          const stderr: string[] = [];
          const before = snapshot(targetRoot);
          const exitCode = await commands.executeCommand([
            command,
            "--host", host.id,
            "--capability", NAVIGATION,
            "--yes",
            "--json",
          ], {
            cwd: targetRoot,
            packageRoot: PACKAGE_ROOT,
            nodeVersion: "22.0.0",
            mutationLockRoot: path.join(root, "locks"),
            confirmTarget: () => true,
            getAdapter: (selectedHost: string) => {
              assert.equal(selectedHost, host.id);
              return guardedAdapter;
            },
            stdout: (text: string) => stdout.push(text),
            stderr: (text: string) => stderr.push(text),
          });
          assert.equal(exitCode, 1, `${host.id}:${command}`);
          assert.equal(renderCalled, false, `${host.id}:${command}`);
          assert.deepEqual(snapshot(targetRoot), before, `${host.id}:${command}`);
          assert.equal(stderr.length, 0);
          assert.equal(stdout.length, 1);
          assert.equal(JSON.parse(stdout[0] as string).error.code, "source_conflict");
          assert.equal(stdout[0]?.includes(secret), false);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
