/** Stable five-command controller. Host-specific paths and formats stay in adapters. */

const fs = require("node:fs") as typeof import("node:fs");
const os = require("node:os") as typeof import("node:os");
const path = require("node:path") as typeof import("node:path");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type CurrentEnvironmentId,
  type HostId,
  type StatusIssue,
  type StatusResult,
} from "../core/contracts.cjs";
import { resolveProjectTarget } from "../core/project-target.cjs";
import { assertMutationRuntime, createStatusResult, runtimeStatusIssue } from "../core/state.cjs";
import { applyTransaction } from "../core/transaction.cjs";
import {
  assertHostAdapter,
  type HostAdapter,
  type HostObservation,
} from "../hosts/host-adapter.cjs";
import { getHostAdapter, HOST_ADAPTERS } from "../hosts/index.cjs";

const QA_ENVIRONMENT: CurrentEnvironmentId = "qa";

interface LegacyMigrationAdapter extends HostAdapter {
  migrateLegacy(desired: ReturnType<HostAdapter["renderInstall"]>, observation: HostObservation): ReturnType<typeof applyTransaction>;
}

export const COMMANDS = Object.freeze([
  "install",
  "status",
  "doctor",
  "update",
  "uninstall",
] as const);
export const HOST_CHOICES: readonly HostId[] = Object.freeze(
  HOST_ADAPTERS.map((adapter) => adapter.id),
);

export type CommandName = (typeof COMMANDS)[number];

interface ParsedArguments {
  readonly command: CommandName;
  readonly host?: HostId;
  readonly target?: string;
  readonly yes: boolean;
  readonly json: boolean;
  readonly allowLegacyUserRemoval: boolean;
  readonly allowLegacyDevMigration: boolean;
}

export interface TargetConfirmation {
  readonly command: CommandName;
  readonly host: HostId;
  readonly target: string;
}

export interface LegacyRemovalConfirmation extends TargetConfirmation {
  readonly legacyPath: string;
}

export interface CommandDependencies {
  readonly cwd?: string;
  readonly packageRoot?: string;
  readonly nodeVersion?: string;
  readonly homeDirectory?: string;
  readonly hostGlobalRoots?: (host: HostId, homeDirectory: string) => readonly string[];
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly selectHost?: (
    hosts: readonly HostId[],
  ) => HostId | undefined | Promise<HostId | undefined>;
  readonly confirmTarget?: (
    request: TargetConfirmation,
  ) => boolean | Promise<boolean>;
  readonly confirmLegacyUserRemoval?: (
    request: LegacyRemovalConfirmation,
  ) => boolean | Promise<boolean>;
  readonly getAdapter?: (host: HostId) => HostAdapter;
}

function isCommand(value: string | undefined): value is CommandName {
  return COMMANDS.some((command) => command === value);
}

function isHost(value: string | undefined): value is HostId {
  return HOST_CHOICES.some((host) => host === value);
}

function requireFlagValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InstallError("invalid_arguments");
  }
  return value;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (!isCommand(argv[0])) throw new InstallError("invalid_arguments");
  const command = argv[0];
  let host: HostId | undefined;
  let target: string | undefined;
  let yes = false;
  let json = false;
  let allowLegacyUserRemoval = false;
  let allowLegacyDevMigration = false;
  const seen = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (seen.has(argument)) throw new InstallError("invalid_arguments");
    seen.add(argument);
    if (argument === "--yes") yes = true;
    else if (argument === "--json") json = true;
    else if (argument === "--allow-legacy-user-removal") allowLegacyUserRemoval = true;
    else if (argument === "--allow-legacy-dev-migration") allowLegacyDevMigration = true;
    else if (argument === "--host") {
      const value = requireFlagValue(argv, index++);
      if (!isHost(value)) throw new InstallError("unsupported_host");
      host = value;
    } else if (argument === "--environment") {
      requireFlagValue(argv, index++);
      throw new InstallError("environment_selector_retired");
    } else if (argument === "--target") {
      target = requireFlagValue(argv, index++);
    } else {
      throw new InstallError("invalid_arguments");
    }
  }

  const parsed: {
    command: CommandName;
    host?: HostId;
    target?: string;
    yes: boolean;
    json: boolean;
    allowLegacyUserRemoval: boolean;
    allowLegacyDevMigration: boolean;
  } = { command, yes, json, allowLegacyUserRemoval, allowLegacyDevMigration };
  if (host !== undefined) parsed.host = host;
  if (target !== undefined) parsed.target = target;
  return parsed;
}

function isMutation(command: CommandName): boolean {
  return command === "install" || command === "update" || command === "uninstall";
}

function defaultHostGlobalRoots(host: HostId, homeDirectory: string): readonly string[] {
  if (host === "codex") return Object.freeze([path.join(homeDirectory, ".codex")]);
  if (host === "claude") return Object.freeze([path.join(homeDirectory, ".claude")]);
  const roots = [path.join(homeDirectory, ".cursor")];
  if (process.platform === "win32") {
    roots.push(
      path.join(homeDirectory, "AppData", "Roaming", "Cursor"),
      path.join(homeDirectory, "AppData", "Local", "Cursor"),
    );
  } else if (process.platform === "darwin") {
    roots.push(
      path.join(homeDirectory, "Library", "Application Support", "Cursor"),
      path.join(homeDirectory, "Library", "Caches", "Cursor"),
    );
  } else {
    roots.push(
      path.join(homeDirectory, ".config", "Cursor"),
      path.join(homeDirectory, ".cache", "Cursor"),
    );
  }
  return Object.freeze(roots);
}

function safeError(error: unknown): StatusIssue {
  if (error instanceof InstallError) {
    return error.safePath === undefined
      ? Object.freeze({ code: error.code, path: "." })
      : Object.freeze({ code: error.code, path: error.safePath });
  }
  return Object.freeze({ code: "command_failed", path: "." });
}

function errorExitCode(code: string): number {
  return new Set([
    "cancelled",
    "confirmation_required",
    "environment_selector_retired",
    "host_required",
    "invalid_arguments",
    "legacy_removal_cancelled",
    "legacy_removal_authority_required",
    "legacy_removal_authority_invalid",
    "legacy_dev_migration_authority_invalid",
    "legacy_dev_migration_authority_required",
    "unsupported_environment",
    "unsupported_host",
  ]).has(code)
    ? 2
    : 1;
}

function hasLegacyMigration(adapter: HostAdapter): adapter is LegacyMigrationAdapter {
  return typeof (adapter as Partial<LegacyMigrationAdapter>).migrateLegacy === "function";
}

function writeJson(
  stdout: (text: string) => void,
  value: Readonly<Record<string, unknown>>,
): void {
  stdout(JSON.stringify(value));
}

function packageVersion(packageRoot: string): string | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "kcoderag-nav" &&
      typeof (value as { version?: unknown }).version === "string"
    ) {
      return (value as { version: string }).version;
    }
  } catch {
    // Version is optional command metadata; adapters still validate their package inputs.
  }
  return undefined;
}

function withRuntimeIssue(
  status: StatusResult,
  issue: StatusIssue | undefined,
  host: HostId,
  environment: CurrentEnvironmentId,
): StatusResult {
  if (issue === undefined) return status;
  return createStatusResult({
    status: "invalid",
    host,
    environment: status.environment ?? environment,
    issues: [...status.issues, issue],
  });
}

async function selectHost(
  args: ParsedArguments,
  dependencies: CommandDependencies,
): Promise<HostId> {
  if (args.host !== undefined) return args.host;
  if (args.json) throw new InstallError("host_required");
  const selected = await (dependencies.selectHost?.(HOST_CHOICES) ?? undefined);
  if (selected === undefined) throw new InstallError("cancelled");
  if (!isHost(selected)) throw new InstallError("unsupported_host");
  return selected;
}

async function legacyRemovalAuthority(
  args: ParsedArguments,
  host: HostId,
  observation: HostObservation,
  request: TargetConfirmation,
  dependencies: CommandDependencies,
): Promise<boolean> {
  if (args.allowLegacyUserRemoval && host !== "cursor") {
    throw new InstallError("legacy_removal_authority_invalid");
  }
  if (args.allowLegacyUserRemoval) return true;
  if (observation.legacyUserRemoval === undefined) return false;
  if (host !== "cursor") throw new InstallError("invalid_host_adapter");
  if (args.json) throw new InstallError("legacy_removal_authority_required");
  const confirmed = await (dependencies.confirmLegacyUserRemoval?.({
    ...request,
    legacyPath: observation.legacyUserRemoval.path,
  }) ?? false);
  if (!confirmed) throw new InstallError("legacy_removal_cancelled");
  return true;
}

function legacyDevMigrationAuthority(
  args: ParsedArguments,
  observation: HostObservation,
): boolean {
  const legacyEnvironment = observation.legacyEnvironment;
  if (args.allowLegacyDevMigration && legacyEnvironment !== "dev") {
    throw new InstallError("legacy_dev_migration_authority_invalid");
  }
  if (!args.allowLegacyDevMigration && legacyEnvironment === "dev") {
    throw new InstallError("legacy_dev_migration_authority_required");
  }
  return args.allowLegacyDevMigration;
}

/** Execute exactly one command against exactly one selected adapter. */
export async function executeCommand(
  argv: string[],
  dependencies: CommandDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  let json = argv.includes("--json");
  try {
    const args = parseArguments(argv);
    json = args.json;
    const host = await selectHost(args, dependencies);
    if (args.allowLegacyDevMigration && (args.command !== "install" && args.command !== "update")) {
      throw new InstallError("legacy_dev_migration_authority_invalid");
    }
    if (args.allowLegacyUserRemoval && (host !== "cursor" || !isMutation(args.command))) {
      throw new InstallError("legacy_removal_authority_invalid");
    }
    if (args.json && isMutation(args.command) && !args.yes) {
      throw new InstallError("confirmation_required");
    }
    if (isMutation(args.command)) {
      assertMutationRuntime(dependencies.nodeVersion ?? process.versions.node);
    }

    const homeDirectory = path.resolve(dependencies.homeDirectory ?? os.homedir());
    const forbiddenRoots = dependencies.hostGlobalRoots?.(host, homeDirectory) ??
      defaultHostGlobalRoots(host, homeDirectory);
    const target = resolveProjectTarget(args.target ?? ".", dependencies.cwd ?? process.cwd(), {
      homeDirectory,
      forbiddenRoots,
    });
    const request: TargetConfirmation = {
      command: args.command,
      host,
      target: target.root,
    };
    if (isMutation(args.command) && !args.yes) {
      const confirmed = await (dependencies.confirmTarget?.(request) ?? false);
      if (!confirmed) throw new InstallError("cancelled");
    }

    const adapter = assertHostAdapter(dependencies.getAdapter?.(host) ?? getHostAdapter(host), host);
    const packageRoot = path.resolve(dependencies.packageRoot ?? path.resolve(__dirname, "../.."));
    const observation = adapter.detect({ target, packageRoot });
    if (observation.host !== host || observation.target !== target) {
      throw new InstallError("invalid_host_adapter");
    }

    if (!isMutation(args.command)) {
      const status = withRuntimeIssue(
        adapter.status({
          target,
          packageRoot,
          environment: QA_ENVIRONMENT,
          observation,
          doctor: args.command === "doctor",
        }),
        runtimeStatusIssue(dependencies.nodeVersion ?? process.versions.node),
        host,
        QA_ENVIRONMENT,
      );
      const payload = {
        schemaVersion: CORE_SCHEMA_VERSION,
        ok: true,
        command: args.command,
        host,
        environment: QA_ENVIRONMENT,
        target: target.root,
        status: status.status,
        issues: status.issues,
      };
      if (args.json) writeJson(stdout, payload);
      else stdout(`${args.command}: ${status.status} ${host} at ${target.root}`);
      return 0;
    }

    const allowLegacyUserRemoval = await legacyRemovalAuthority(
      args,
      host,
      observation,
      request,
      dependencies,
    );
    const allowLegacyDevMigration = args.command === "install" || args.command === "update"
      ? legacyDevMigrationAuthority(args, observation)
      : false;
    const sharedMutationContext = {
      target,
      packageRoot,
      environment: QA_ENVIRONMENT,
      observation,
      allowLegacyUserRemoval,
      allowLegacyDevMigration,
    };
    const desired = args.command === "uninstall"
      ? adapter.renderUninstall({
          ...sharedMutationContext,
        })
      : adapter.renderInstall({
          ...sharedMutationContext,
          command: args.command === "update" ? "update" : "install",
        });
    if (desired.host !== host || desired.target !== target) {
      throw new InstallError("invalid_host_adapter");
    }
    const transaction = observation.legacyUserRemoval !== undefined && allowLegacyUserRemoval
      ? hasLegacyMigration(adapter)
        ? adapter.migrateLegacy(desired, observation)
        : (() => { throw new InstallError("invalid_host_adapter"); })()
      : applyTransaction(desired);
    const verb = args.command === "install"
      ? "installed"
      : args.command === "update"
        ? "updated"
        : "uninstalled";
    const version = packageVersion(packageRoot);
    const payload: Record<string, unknown> = {
      schemaVersion: CORE_SCHEMA_VERSION,
      ok: true,
      command: args.command,
      host,
      environment: QA_ENVIRONMENT,
      target: target.root,
      changedPaths: transaction.changedPaths,
      managedFiles: desired.entries.map((entry) => entry.path.relativePath),
    };
    if (version !== undefined) payload.version = version;
    if (args.json) writeJson(stdout, payload);
    else stdout(`${verb}: ${host} at ${target.root}`);
    return 0;
  } catch (error) {
    const safe = safeError(error);
    const payload = {
      schemaVersion: CORE_SCHEMA_VERSION,
      ok: false,
      code: safe.code,
      path: safe.path,
      error: safe,
    };
    if (json) writeJson(stdout, payload);
    else stderr(JSON.stringify(payload));
    return errorExitCode(safe.code);
  }
}

exports.executeCommand = executeCommand;
