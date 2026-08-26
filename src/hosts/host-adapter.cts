/** Pure host adapter seam between CLI policy and the shared filesystem transaction. */

import {
  InstallError,
  type CurrentEnvironmentId,
  type DesiredState,
  type HostId,
  type InstallState,
  type LegacyEnvironmentId,
  type ProjectTarget,
  type StatusIssue,
  type StatusResult,
} from "../core/contracts.cjs";
import type {
  CapabilityContribution,
  CapabilityId,
} from "../capabilities/contracts.cjs";
import type {
  NativeCleanupPlan,
  OwnedCleanupAuthority,
  SourceScanMode,
  SourceScanResult,
} from "./user-sources.cjs";

export type MutationCommand = "install" | "update";

export interface HostReadContext {
  readonly target: ProjectTarget;
  readonly packageRoot: string;
}

/** Host-neutral inputs that a later adapter projection maps to native paths and merges. */
export interface HostCapabilityProjectionContext extends HostReadContext {
  readonly selectedCapabilities: readonly CapabilityId[];
  readonly contributions: readonly CapabilityContribution[];
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
  /** Exact legacy identity only; it is never a desired public environment. */
  readonly legacyEnvironment?: LegacyEnvironmentId;
  readonly issues?: readonly StatusIssue[];
  readonly legacyUserRemoval?: LegacyUserRemovalObservation;
  readonly details?: unknown;
}

export interface HostInstallContext extends HostReadContext {
  readonly command: MutationCommand;
  readonly environment: CurrentEnvironmentId;
  readonly observation: HostObservation;
  /** Independent authority; it is never inferred from general target confirmation. */
  readonly allowLegacyUserRemoval: boolean;
  /** Independent authority; general target confirmation never implies legacy conversion. */
  readonly allowLegacyDevMigration: boolean;
}

export interface HostUninstallContext extends HostReadContext {
  readonly environment: CurrentEnvironmentId;
  readonly observation: HostObservation;
  readonly allowLegacyUserRemoval: boolean;
  readonly allowLegacyDevMigration: boolean;
}

export interface HostStatusContext extends HostReadContext {
  readonly environment: CurrentEnvironmentId;
  readonly observation: HostObservation;
  readonly doctor: boolean;
}

export interface HostSourceScanContext extends HostReadContext {
  readonly mode: SourceScanMode;
  readonly observation: HostObservation;
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
  /** Optional until a host implements the shared selected-host source contract. */
  scanUserSources?(context: HostSourceScanContext): Promise<SourceScanResult> | SourceScanResult;
  cleanupOwnedSource?(
    plan: NativeCleanupPlan,
    authority: OwnedCleanupAuthority,
  ): Promise<SourceScanResult>;
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
