/** Stable five-command controller. Host-specific paths and formats stay in adapters. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import {
  CORE_SCHEMA_VERSION,
  InstallError,
  type EnvironmentId,
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

export const COMMANDS = Object.freeze([
  "install",
  "status",
  "doctor",
  "update",
  "uninstall",
] as const);
export const HOST_CHOICES = Object.freeze(["codex", "claude", "cursor"] as const);

export type CommandName = (typeof COMMANDS)[number];

interface ParsedArguments {
  readonly command: CommandName;
  readonly host?: HostId;
  readonly environment: EnvironmentId;
  readonly target?: string;
  readonly yes: boolean;
  readonly json: boolean;
  readonly allowLegacyUserRemoval: boolean;
}

export interface TargetConfirmation {
  readonly command: CommandName;
  readonly host: HostId;
  readonly environment: EnvironmentId;
  readonly target: string;
}

export interface LegacyRemovalConfirmation extends TargetConfirmation {
  readonly legacyPath: string;
}

export interface CommandDependencies {
  readonly cwd?: string;
  readonly packageRoot?: string;
  readonly nodeVersion?: string;
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
  let environment: EnvironmentId = "qa";
  let target: string | undefined;
  let yes = false;
  let json = false;
  let allowLegacyUserRemoval = false;
  const seen = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (seen.has(argument)) throw new InstallError("invalid_arguments");
    seen.add(argument);
    if (argument === "--yes") yes = true;
    else if (argument === "--json") json = true;
    else if (argument === "--allow-legacy-user-removal") allowLegacyUserRemoval = true;
    else if (argument === "--host") {
      const value = requireFlagValue(argv, index++);
      if (!isHost(value)) throw new InstallError("unsupported_host");
      host = value;
    } else if (argument === "--environment") {
      const value = requireFlagValue(argv, index++);
      if (value !== "qa" && value !== "dev") throw new InstallError("unsupported_environment");
      environment = value;
    } else if (argument === "--target") {
      target = requireFlagValue(argv, index++);
    } else {
      throw new InstallError("invalid_arguments");
    }
  }

  const parsed: {
    command: CommandName;
    host?: HostId;
    environment: EnvironmentId;
    target?: string;
    yes: boolean;
    json: boolean;
    allowLegacyUserRemoval: boolean;
  } = { command, environment, yes, json, allowLegacyUserRemoval };
  if (host !== undefined) parsed.host = host;
  if (target !== undefined) parsed.target = target;
  return parsed;
}

function isMutation(command: CommandName): boolean {
  return command === "install" || command === "update" || command === "uninstall";
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
    "host_required",
    "invalid_arguments",
    "legacy_removal_cancelled",
    "legacy_removal_authority_invalid",
    "unsupported_environment",
    "unsupported_host",
  ]).has(code)
    ? 2
    : 1;
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
  environment: EnvironmentId,
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
    if (args.allowLegacyUserRemoval && (host !== "cursor" || !isMutation(args.command))) {
      throw new InstallError("legacy_removal_authority_invalid");
    }
    if (args.json && isMutation(args.command) && !args.yes) {
      throw new InstallError("confirmation_required");
    }
    if (isMutation(args.command)) {
      assertMutationRuntime(dependencies.nodeVersion ?? process.versions.node);
    }

    const target = resolveProjectTarget(args.target ?? ".", dependencies.cwd ?? process.cwd());
    const request: TargetConfirmation = {
      command: args.command,
      host,
      environment: args.environment,
      target: target.root,
    };
    if (isMutation(args.command) && !args.yes) {
      const confirmed = await (dependencies.confirmTarget?.(request) ?? false);
      if (!confirmed) throw new InstallError("cancelled");
    }

    const adapter = assertHostAdapter(
      dependencies.getAdapter?.(host),
      host,
    );
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
          environment: args.environment,
          observation,
          doctor: args.command === "doctor",
        }),
        runtimeStatusIssue(dependencies.nodeVersion ?? process.versions.node),
        host,
        args.environment,
      );
      const payload = {
        schemaVersion: CORE_SCHEMA_VERSION,
        ok: true,
        command: args.command,
        host,
        environment: status.environment ?? args.environment,
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
    const desired = args.command === "uninstall"
      ? adapter.renderUninstall({
          target,
          packageRoot,
          environment: args.environment,
          observation,
          allowLegacyUserRemoval,
        })
      : adapter.renderInstall({
          target,
          packageRoot,
          command: args.command === "update" ? "update" : "install",
          environment: args.environment,
          observation,
          allowLegacyUserRemoval,
        });
    if (desired.host !== host || desired.target !== target) {
      throw new InstallError("invalid_host_adapter");
    }
    const transaction = applyTransaction(desired);
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
      environment: args.environment,
      target: target.root,
      changedPaths: transaction.changedPaths,
      managedFiles: desired.entries.map((entry) => entry.path.relativePath),
    };
    if (version !== undefined) payload.version = version;
    if (args.json) writeJson(stdout, payload);
    else stdout(`${verb}: ${host}/${args.environment} at ${target.root}`);
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
