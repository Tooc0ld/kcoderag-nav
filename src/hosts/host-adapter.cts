/** Pure host adapter seam between CLI policy and the shared filesystem transaction. */

import {
  InstallError,
  type DesiredState,
  type EnvironmentId,
  type HostId,
  type InstallState,
  type ProjectTarget,
  type StatusIssue,
  type StatusResult,
} from "../core/contracts.cjs";

export type MutationCommand = "install" | "update";

export interface HostReadContext {
  readonly target: ProjectTarget;
  readonly packageRoot: string;
}

export interface LegacyUserRemovalObservation {
  /** Normalized user-local directory shown only in its independent confirmation prompt. */
  readonly path: string;
}

/**
 * Immutable output from a host-specific read-only inspection.
 * `details` is adapter-private and must never be serialized by the CLI.
 */
export interface HostObservation {
  readonly host: HostId;
  readonly target: ProjectTarget;
  readonly currentState?: InstallState;
  readonly issues?: readonly StatusIssue[];
  readonly legacyUserRemoval?: LegacyUserRemovalObservation;
  readonly details?: unknown;
}

export interface HostInstallContext extends HostReadContext {
  readonly command: MutationCommand;
  readonly environment: EnvironmentId;
  readonly observation: HostObservation;
  /** Independent authority; it is never inferred from general target confirmation. */
  readonly allowLegacyUserRemoval: boolean;
}

export interface HostUninstallContext extends HostReadContext {
  readonly environment: EnvironmentId;
  readonly observation: HostObservation;
  readonly allowLegacyUserRemoval: boolean;
}

export interface HostStatusContext extends HostReadContext {
  readonly environment: EnvironmentId;
  readonly observation: HostObservation;
  readonly doctor: boolean;
}

/**
 * Adapters may read during detection/status and render complete desired state, but never write.
 * The CLI sends the selected adapter's desired state to `applyTransaction` exactly once.
 */
export interface HostAdapter {
  readonly id: HostId;
  readonly managedRoots: readonly string[];
  detect(context: HostReadContext): HostObservation;
  renderInstall(context: HostInstallContext): DesiredState;
  renderUninstall(context: HostUninstallContext): DesiredState;
  status(context: HostStatusContext): StatusResult;
}

export function assertHostAdapter(value: unknown, expectedHost: HostId): HostAdapter {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Partial<HostAdapter>).id !== expectedHost ||
    !Array.isArray((value as Partial<HostAdapter>).managedRoots) ||
    typeof (value as Partial<HostAdapter>).detect !== "function" ||
    typeof (value as Partial<HostAdapter>).renderInstall !== "function" ||
    typeof (value as Partial<HostAdapter>).renderUninstall !== "function" ||
    typeof (value as Partial<HostAdapter>).status !== "function"
  ) {
    throw new InstallError("invalid_host_adapter");
  }
  return value as HostAdapter;
}
