const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const crypto = require("node:crypto") as typeof import("node:crypto");
const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

type CapabilityId = "kcoderag-navigation" | "code-style-nudge";
type HostId = "codex" | "claude" | "cursor" | "opencode";

interface OriginalRecord {
  readonly kind: "absent" | "base64";
  readonly data?: string;
}

interface ProjectedFile {
  readonly relativePath: string;
  readonly expectedDigest: string | null;
  readonly content: Buffer;
  readonly original?: OriginalRecord;
  readonly shared: boolean;
}

interface ProjectedSection {
  readonly relativePath: string;
  readonly id: string;
  readonly digest: string;
  readonly fileExisted: boolean;
  readonly createdContainers?: readonly string[];
  readonly shared: boolean;
}

interface ProjectedContribution {
  readonly capabilityId: CapabilityId;
  readonly files: readonly ProjectedFile[];
  readonly sections: readonly ProjectedSection[];
}

interface CapabilityState {
  readonly schemaVersion: number;
  readonly packageVersion: string;
  readonly host: HostId;
  readonly capabilities: readonly {
    readonly id: CapabilityId;
    readonly files: readonly string[];
    readonly sections: readonly string[];
  }[];
  readonly files: readonly {
    readonly path: string;
    readonly digest: string;
    readonly original: OriginalRecord;
    readonly contributors: readonly CapabilityId[];
  }[];
  readonly sections: readonly {
    readonly path: string;
    readonly id: string;
    readonly digest: string;
    readonly fileExisted: boolean;
    readonly createdContainers?: readonly string[];
    readonly contributors: readonly CapabilityId[];
  }[];
  readonly compositeDigest: string;
}

interface DesiredState {
  readonly host: HostId;
  readonly statePath: { readonly relativePath: string };
  readonly entries: readonly {
    readonly path: { readonly relativePath: string; readonly absolutePath: string };
    readonly expectedDigest: string | null;
    readonly content: Buffer | null;
  }[];
}

interface ComposeInput {
  readonly host: HostId;
  readonly target: { readonly root: string };
  readonly packageVersion: string;
  readonly managedRoots: readonly string[];
  readonly statePath: string;
  readonly stateExpectedDigest: string | null;
  readonly selectedCapabilities: readonly CapabilityId[];
  readonly contributions: readonly ProjectedContribution[];
  readonly previousState?: CapabilityState;
}

interface ComposeModule {
  composeCapabilitySet(input: ComposeInput): DesiredState;
  applyCapabilitySet<T>(
    input: ComposeInput,
    apply: (desired: DesiredState) => T,
  ): T;
}

interface StateModule {
  parseInstallState(bytes: Buffer): CapabilityState;
  readonly parseCapabilityInstallState?: unknown;
  readonly parseLegacyInstallState?: unknown;
}

interface ProjectTargetModule {
  resolveProjectTarget(rawTarget: string): { readonly root: string };
}

interface TransactionModule {
  applyTransaction(
    desired: DesiredState,
    options?: { readonly failAtStage?: number; readonly failAtCommit?: number },
  ): { readonly changedPaths: readonly string[] };
}

const compose = require("../../dist/capabilities/compose.cjs") as ComposeModule;
const state = require("../../dist/core/state.cjs") as StateModule;
const projectTarget = require("../../dist/core/project-target.cjs") as ProjectTargetModule;
const transaction = require("../../dist/core/transaction.cjs") as TransactionModule;

const NAVIGATION = "kcoderag-navigation" as const;
const CODE_STYLE = "code-style-nudge" as const;
const STATE_PATH = "owned/install-state.json";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function temporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(root: string, relativePath: string, bytes: Buffer | string): void {
  const destination = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

function read(root: string, relativePath: string): Buffer {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")));
}

function absentOriginal(): OriginalRecord {
  return Object.freeze({ kind: "absent" as const });
}

function existingOriginal(bytes: Buffer): OriginalRecord {
  return Object.freeze({ kind: "base64" as const, data: bytes.toString("base64") });
}

function fixture() {
  const root = temporaryDirectory("kcoderag-compose-");
  const target = projectTarget.resolveProjectTarget(root);
  const originalShared = Buffer.from("opaque-user-config\n", "utf8");
  write(root, "owned/shared.json", originalShared);
  write(root, "unrelated/keep.bin", Buffer.from([0, 255, 17, 42]));
  const mergedShared = Buffer.from("opaque-composed-config\n", "utf8");
  const navigationFile = Buffer.from("navigation-runtime\n", "utf8");
  const codeStyleFile = Buffer.from("code-style-runtime\n", "utf8");
  const expectedShared = sha256(originalShared);
  const original = existingOriginal(originalShared);
  const contributions: ProjectedContribution[] = [
    {
      capabilityId: CODE_STYLE,
      files: [
        {
          relativePath: "owned/shared.json",
          expectedDigest: expectedShared,
          content: mergedShared,
          original,
          shared: true,
        },
        {
          relativePath: "owned/code-style.bin",
          expectedDigest: null,
          content: codeStyleFile,
          original: absentOriginal(),
          shared: false,
        },
      ],
      sections: [
        {
          relativePath: "owned/shared.json",
          id: "pre-tool.code-style",
          digest: sha256("code-style-section"),
          fileExisted: true,
          shared: false,
        },
      ],
    },
    {
      capabilityId: NAVIGATION,
      files: [
        {
          relativePath: "owned/navigation.bin",
          expectedDigest: null,
          content: navigationFile,
          original: absentOriginal(),
          shared: false,
        },
        {
          relativePath: "owned/shared.json",
          expectedDigest: expectedShared,
          content: mergedShared,
          original,
          shared: true,
        },
      ],
      sections: [
        {
          relativePath: "owned/shared.json",
          id: "mcp.kcoderag",
          digest: sha256("navigation-section"),
          fileExisted: true,
          shared: false,
        },
      ],
    },
  ];
  return {
    root,
    target,
    originalShared,
    mergedShared,
    navigationFile,
    codeStyleFile,
    contributions,
  };
}

function initialInput(value: ReturnType<typeof fixture>): ComposeInput {
  return {
    host: "claude",
    target: value.target,
    packageVersion: "9.8.7",
    managedRoots: ["owned"],
    statePath: STATE_PATH,
    stateExpectedDigest: null,
    selectedCapabilities: [CODE_STYLE, NAVIGATION],
    contributions: value.contributions,
  };
}

function cloneContributions(
  contributions: readonly ProjectedContribution[],
): ProjectedContribution[] {
  return contributions.map((contribution) => ({
    capabilityId: contribution.capabilityId,
    files: contribution.files.map((file) => ({
      ...file,
      content: Buffer.from(file.content),
      ...(file.original === undefined
        ? {}
        : { original: { ...file.original } }),
    })),
    sections: contribution.sections.map((section) => ({
      ...section,
      ...(section.createdContainers === undefined
        ? {}
        : { createdContainers: [...section.createdContainers] }),
    })),
  }));
}

function desiredStateBytes(desired: DesiredState): Buffer {
  const entry = desired.entries.find((candidate) => candidate.path.relativePath === STATE_PATH);
  assert.ok(entry?.content);
  return entry.content;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as Error & { readonly code: unknown }).code)
    : undefined;
}

test("two projected capabilities compose canonically into one immutable desired state and one transaction", () => {
  const value = fixture();
  try {
    const input = initialInput(value);
    let calls = 0;
    const desired = compose.applyCapabilitySet(input, (composed) => {
      calls += 1;
      return composed;
    });
    assert.equal(calls, 1);
    assert.equal(Object.isFrozen(desired), true);
    assert.equal(Object.isFrozen(desired.entries), true);
    assert.deepEqual(desired.entries.map((entry) => entry.path.relativePath), [
      "owned/code-style.bin",
      "owned/navigation.bin",
      "owned/shared.json",
      STATE_PATH,
    ]);

    const installed = state.parseInstallState(desiredStateBytes(desired));
    assert.deepEqual(installed.capabilities.map((capability) => capability.id), [NAVIGATION, CODE_STYLE]);
    assert.deepEqual(
      installed.files.find((file) => file.path === "owned/shared.json")?.contributors,
      [NAVIGATION, CODE_STYLE],
    );
    assert.deepEqual(
      installed.capabilities.find((capability) => capability.id === NAVIGATION),
      {
        id: NAVIGATION,
        files: ["owned/navigation.bin", "owned/shared.json"],
        sections: ["owned/shared.json#mcp.kcoderag"],
      },
    );
    assert.match(installed.compositeDigest, DIGEST_PATTERN);

    value.mergedShared.fill(0);
    value.contributions.reverse();
    assert.equal(
      desired.entries.find((entry) => entry.path.relativePath === "owned/shared.json")?.content?.toString("utf8"),
      "opaque-composed-config\n",
    );
    assert.deepEqual(installed.capabilities.map((capability) => capability.id), [NAVIGATION, CODE_STYLE]);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("collisions, path escapes, and incomplete selected sets fail before the transaction boundary", () => {
  const value = fixture();
  try {
    const cases: ComposeInput[] = [];
    const collision = cloneContributions(value.contributions);
    const codeStyleShared = collision[0]?.files.find((file) => file.relativePath === "owned/shared.json");
    assert.ok(codeStyleShared);
    (codeStyleShared as { content: Buffer }).content = Buffer.from("different");
    cases.push({ ...initialInput(value), contributions: collision });

    const escaped = cloneContributions(value.contributions);
    const escapedFile = escaped[0]?.files[0];
    assert.ok(escapedFile);
    (escapedFile as { relativePath: string }).relativePath = "owned/../outside.bin";
    cases.push({ ...initialInput(value), contributions: escaped });
    cases.push({ ...initialInput(value), contributions: [value.contributions[0] as ProjectedContribution] });

    for (const input of cases) {
      let calls = 0;
      assert.throws(
        () => compose.applyCapabilitySet(input, () => { calls += 1; }),
        (error: unknown) => [
          "capability_collision",
          "path_escape",
          "invalid_capability_composition",
        ].includes(errorCode(error) ?? ""),
      );
      assert.equal(calls, 0);
    }
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("single-capability recomposition preserves contributors and final removal restores originals", () => {
  const value = fixture();
  try {
    const initialDesired = compose.composeCapabilitySet(initialInput(value));
    transaction.applyTransaction(initialDesired);
    const initialStateBytes = read(value.root, STATE_PATH);
    const initialState = state.parseInstallState(initialStateBytes);
    const sharedDigest = sha256(read(value.root, "owned/shared.json"));
    const navigationDigest = sha256(read(value.root, "owned/navigation.bin"));

    const navigationOnly: ProjectedContribution = {
      capabilityId: NAVIGATION,
      files: [
        {
          relativePath: "owned/navigation.bin",
          expectedDigest: navigationDigest,
          content: value.navigationFile,
          shared: false,
        },
        {
          relativePath: "owned/shared.json",
          expectedDigest: sharedDigest,
          content: Buffer.from("opaque-navigation-only\n", "utf8"),
          shared: false,
        },
      ],
      sections: [
        {
          relativePath: "owned/shared.json",
          id: "mcp.kcoderag",
          digest: sha256("navigation-section"),
          fileExisted: true,
          shared: false,
        },
      ],
    };
    const partialDesired = compose.composeCapabilitySet({
      ...initialInput(value),
      selectedCapabilities: [NAVIGATION],
      contributions: [navigationOnly],
      previousState: initialState,
      stateExpectedDigest: sha256(initialStateBytes),
    });
    transaction.applyTransaction(partialDesired);

    assert.equal(fs.existsSync(path.join(value.root, "owned", "code-style.bin")), false);
    assert.equal(read(value.root, "owned/navigation.bin").toString("utf8"), "navigation-runtime\n");
    assert.equal(read(value.root, "owned/shared.json").toString("utf8"), "opaque-navigation-only\n");
    const partialStateBytes = read(value.root, STATE_PATH);
    const partialState = state.parseInstallState(partialStateBytes);
    assert.deepEqual(partialState.capabilities.map((capability) => capability.id), [NAVIGATION]);
    assert.deepEqual(
      partialState.files.find((file) => file.path === "owned/shared.json")?.contributors,
      [NAVIGATION],
    );

    const finalDesired = compose.composeCapabilitySet({
      ...initialInput(value),
      selectedCapabilities: [],
      contributions: [],
      previousState: partialState,
      stateExpectedDigest: sha256(partialStateBytes),
    });
    transaction.applyTransaction(finalDesired);
    assert.equal(fs.existsSync(path.join(value.root, "owned", "navigation.bin")), false);
    assert.deepEqual(read(value.root, "owned/shared.json"), value.originalShared);
    assert.equal(fs.existsSync(path.join(value.root, ...STATE_PATH.split("/"))), false);
    assert.deepEqual(read(value.root, "unrelated/keep.bin"), Buffer.from([0, 255, 17, 42]));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("the only install-state decoder rejects retired Node and Python schemas", () => {
  assert.equal(state.parseCapabilityInstallState, undefined);
  assert.equal(state.parseLegacyInstallState, undefined);

  const retiredNode = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    packageVersion: "0.1.9",
    host: "codex",
    environment: "dev",
    managedFiles: [".codex/kcoderag-nav/install-state.json"],
    originals: {},
    digests: {},
  })}\n`, "utf8");
  const retiredPython = Buffer.from(`${JSON.stringify({
    version: 1,
    active_environments: ["qa"],
    originals: {},
    digests: {},
  })}\n`, "utf8");

  for (const bytes of [retiredNode, retiredPython]) {
    assert.throws(
      () => state.parseInstallState(bytes),
      (error: unknown) => errorCode(error) === "invalid_state",
    );
  }
});
