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
import type { DesiredState } from "../core/contracts.cjs";
import type { CapabilityId } from "../capabilities/contracts.cjs";
import {
  BUILT_IN_CAPABILITIES,
  resolveCapabilitySelection,
} from "../capabilities/registry.cjs";
import { acquireMutationLock } from "../core/mutation-lock.cjs";
import { resolveProjectTarget } from "../core/project-target.cjs";
import { assertMutationRuntime, createStatusResult, runtimeStatusIssue } from "../core/state.cjs";
import { applyTransaction } from "../core/transaction.cjs";
import {
  assertHostAdapter,
  type HostAdapter,
  type HostObservation,
} from "../hosts/host-adapter.cjs";
import { getHostAdapter, HOST_ADAPTERS } from "../hosts/index.cjs";
import {
  createSourceScanResult,
  type SourceScanMode,
  type SourceScanResult,
} from "../hosts/user-sources.cjs";

const QA_ENVIRONMENT: CurrentEnvironmentId = "qa";

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
  readonly capabilities: readonly CapabilityId[];
}

export interface TargetConfirmation {
  readonly command: CommandName;
  readonly host: HostId;
  readonly target: string;
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
  readonly selectCapabilities?: (
    capabilities: readonly CapabilityId[],
  ) => readonly CapabilityId[] | undefined | Promise<readonly CapabilityId[] | undefined>;
  readonly confirmTarget?: (
    request: TargetConfirmation,
  ) => boolean | Promise<boolean>;
  readonly getAdapter?: (host: HostId) => HostAdapter;
  readonly mutationLockRoot?: string;
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
  const capabilities: string[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument !== "--capability" && seen.has(argument)) throw new InstallError("invalid_arguments");
    if (argument !== "--capability") seen.add(argument);
    if (argument === "--yes") yes = true;
    else if (argument === "--json") json = true;
    else if (argument === "--capability") capabilities.push(requireFlagValue(argv, index++));
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
    capabilities: readonly CapabilityId[];
  } = {
    command,
    yes,
    json,
    capabilities: capabilities.length === 0
      ? Object.freeze([])
      : Object.freeze(resolveCapabilitySelection(capabilities).map((entry) => entry.id)),
  };
  if (host !== undefined) parsed.host = host;
  if (target !== undefined) parsed.target = target;
  return parsed;
}

async function selectInstallCapabilities(
  args: ParsedArguments,
  dependencies: CommandDependencies,
): Promise<readonly CapabilityId[]> {
  if (args.capabilities.length > 0) return args.capabilities;
  if (args.json) throw new InstallError("capability_selection_required");
  const available = Object.freeze(BUILT_IN_CAPABILITIES.map((entry) => entry.id));
  const selected = await (dependencies.selectCapabilities?.(available) ?? undefined);
  if (selected === undefined) throw new InstallError("cancelled");
  return Object.freeze(resolveCapabilitySelection(selected).map((entry) => entry.id));
}

function isMutation(command: CommandName): boolean {
  return command === "install" || command === "update" || command === "uninstall";
}

function defaultHostGlobalRoots(host: HostId, homeDirectory: string): readonly string[] {
  if (host === "codex") return Object.freeze([path.join(homeDirectory, ".codex")]);
  if (host === "claude") return Object.freeze([path.join(homeDirectory, ".claude")]);
  if (host === "opencode") {
    return Object.freeze([path.join(homeDirectory, ".config", "opencode")]);
  }
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

function desiredStateIsCurrent(
  desired: DesiredState,
  preserveValidatedState: boolean,
): boolean {
  for (const entry of desired.entries) {
    let stats: import("node:fs").Stats;
    try {
      stats = fs.lstatSync(entry.path.absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (entry.content === null) continue;
        return false;
      }
      return false;
    }
    if (entry.content === null || !stats.isFile() || stats.isSymbolicLink()) return false;
    if (
      preserveValidatedState &&
      entry.path.relativePath === desired.statePath.relativePath
    ) continue;
    try {
      if (!fs.readFileSync(entry.path.absolutePath).equals(entry.content)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function withRuntimeIssue(
  status: StatusResult,
  issue: StatusIssue | undefined,
  host: HostId,
  environment: CurrentEnvironmentId,
): StatusResult {
  if (issue === undefined) return status;
  return createStatusResult({
    status: status.status === "source_conflict" ? "source_conflict" : "invalid",
    host,
    environment: status.environment ?? environment,
    issues: [...status.issues, issue],
    findings: status.findings,
  });
}

function emptySourceScan(mode: SourceScanMode): SourceScanResult {
  return createSourceScanResult(mode, []);
}

async function scanUserSources(
  adapter: HostAdapter,
  mode: SourceScanMode,
  target: ReturnType<typeof resolveProjectTarget>,
  packageRoot: string,
  observation: HostObservation,
): Promise<SourceScanResult> {
  return adapter.scanUserSources === undefined
    ? emptySourceScan(mode)
    : await adapter.scanUserSources({ target, packageRoot, observation, mode });
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

/** Execute exactly one command against exactly one selected adapter. */
export async function executeCommand(
  argv: string[],
  dependencies: CommandDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  let json = argv.includes("--json");
  let releaseMutationLock: (() => void) | undefined;
  try {
    const args = parseArguments(argv);
    json = args.json;
    const host = await selectHost(args, dependencies);
    const requestedCapabilities = args.command === "install"
      ? await selectInstallCapabilities(args, dependencies)
      : args.capabilities;
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

    if (isMutation(args.command)) {
      const lock = acquireMutationLock({
        host,
        targetRoot: target.root,
        ...(dependencies.mutationLockRoot === undefined
          ? {}
          : { lockRoot: dependencies.mutationLockRoot }),
      });
      releaseMutationLock = lock.release;
    }

    const adapter = assertHostAdapter(dependencies.getAdapter?.(host) ?? getHostAdapter(host), host);
    const packageRoot = path.resolve(dependencies.packageRoot ?? path.resolve(__dirname, "../.."));
    const observation = adapter.detect({ target, packageRoot });
    if (observation.host !== host || observation.target !== target) {
      throw new InstallError("invalid_host_adapter");
    }

    if (!isMutation(args.command)) {
      const mode: SourceScanMode = args.command === "doctor" ? "deep" : "fast";
      const sourceScan = await scanUserSources(adapter, mode, target, packageRoot, observation);
      const adapterStatus = adapter.status({
        target,
        packageRoot,
        environment: QA_ENVIRONMENT,
        observation,
        doctor: args.command === "doctor",
      });
      const normalizedStatus = createStatusResult({
        status: sourceScan.hasConflict ? "source_conflict" : adapterStatus.status,
        host,
        environment: adapterStatus.environment ?? QA_ENVIRONMENT,
        issues: adapterStatus.issues,
        findings: sourceScan.findings,
      });
      const status = withRuntimeIssue(
        normalizedStatus,
        runtimeStatusIssue(dependencies.nodeVersion ?? process.versions.node),
        host,
        QA_ENVIRONMENT,
      );
      const ok = status.status !== "source_conflict";
      const payload = {
        schemaVersion: CORE_SCHEMA_VERSION,
        ok,
        command: args.command,
        host,
        environment: QA_ENVIRONMENT,
        target: target.root,
        status: status.status,
        issues: status.issues,
        findings: status.findings,
      };
      if (args.json) writeJson(stdout, payload);
      else {
        stdout(`${args.command}: ${status.status} ${host} at ${target.root}`);
        for (const finding of status.findings) {
          stdout(`${finding.code}: ${finding.safePath}`);
        }
      }
      return ok ? 0 : 1;
    }

    const mutationSourceScan = await scanUserSources(
      adapter,
      "gate",
      target,
      packageRoot,
      observation,
    );
    if (mutationSourceScan.mode !== "gate" || mutationSourceScan.hasConflict) {
      throw new InstallError("source_conflict", mutationSourceScan.findings[0]?.safePath);
    }

    const installedCapabilities = observation.currentState?.capabilities.map((entry) => entry.id) ?? [];
    const targetCapabilities = args.command === "install"
      ? Object.freeze(resolveCapabilitySelection([
          ...installedCapabilities,
          ...requestedCapabilities,
        ]).map((entry) => entry.id))
      : requestedCapabilities;
    const sharedMutationContext = {
      target,
      packageRoot,
      environment: QA_ENVIRONMENT,
      observation,
      allowLegacyUserRemoval: false,
      allowLegacyDevMigration: false,
      ...(targetCapabilities.length === 0 ? {} : { selectedCapabilities: targetCapabilities }),
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
    const exactInstalledTarget = args.command === "install" &&
      installedCapabilities.length === targetCapabilities.length &&
      installedCapabilities.every((id, index) => id === targetCapabilities[index]);
    const noChange = desiredStateIsCurrent(desired, exactInstalledTarget);
    const transaction = noChange
      ? Object.freeze({ changedPaths: Object.freeze([] as string[]) })
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
      changed: transaction.changedPaths.length > 0,
      changedPaths: transaction.changedPaths,
      capabilities: targetCapabilities,
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
  } finally {
    releaseMutationLock?.();
  }
}

exports.executeCommand = executeCommand;
