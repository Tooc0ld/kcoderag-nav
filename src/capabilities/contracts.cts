/** Host-neutral contracts for closed built-in capability declarations. */

import type { HostId } from "../core/contracts.cjs";

export type CapabilityId = "kcoderag-navigation" | "code-style-nudge";

export type CapabilityFileKind =
  | "mcp-config"
  | "skill"
  | "handler"
  | "dispatcher"
  | "marker"
  | "launcher"
  | "rule"
  | "plugin";

export type CapabilitySectionKind =
  | "mcp"
  | "session-start"
  | "session-end"
  | "pre-tool"
  | "post-tool";

/** One package-relative canonical asset requirement. Host adapters choose its target path. */
export interface CapabilityFileRequirement {
  readonly id: string;
  readonly sourcePath: string;
  readonly kind: CapabilityFileKind;
  readonly shared: boolean;
}

/** One logical shared-configuration claim. Host adapters own native merge semantics. */
export interface CapabilitySectionRequirement {
  readonly id: string;
  readonly kind: CapabilitySectionKind;
  readonly shared: boolean;
}

export interface CapabilityContribution {
  readonly capabilityId: CapabilityId;
  readonly files: readonly CapabilityFileRequirement[];
  readonly sections: readonly CapabilitySectionRequirement[];
}

export interface CapabilityManifest {
  readonly id: CapabilityId;
}

export interface CapabilitySupportContext {
  readonly host: HostId;
  readonly hostVersion: string;
  /** Repository root used only by the frozen checked-in evidence verifier. */
  readonly evidenceRoot?: string;
}

export type AutomaticNudgeSupportDecision =
  | {
      readonly eligible: true;
      readonly evidenceDigest: string;
    }
  | {
      readonly eligible: false;
      readonly code: "host_version_unsupported";
    };

export type CapabilitySupportDecision =
  | {
      readonly eligible: true;
      readonly deliveryMode: "host_native";
    }
  | {
      readonly eligible: true;
      readonly deliveryMode: "manual_skill";
      readonly automaticNudge: AutomaticNudgeSupportDecision;
    };

/** A provider declares requirements and support only; it has no project mutation authority. */
export interface CapabilityProvider extends CapabilityManifest {
  contribution(): CapabilityContribution;
  evaluateSupport(context: CapabilitySupportContext): CapabilitySupportDecision;
}

function copyFileRequirement(
  requirement: CapabilityFileRequirement,
): CapabilityFileRequirement {
  return Object.freeze({
    id: requirement.id,
    sourcePath: requirement.sourcePath,
    kind: requirement.kind,
    shared: requirement.shared,
  });
}

function copySectionRequirement(
  requirement: CapabilitySectionRequirement,
): CapabilitySectionRequirement {
  return Object.freeze({
    id: requirement.id,
    kind: requirement.kind,
    shared: requirement.shared,
  });
}

/** Copy every caller-owned container before exposing a contribution. */
export function copyCapabilityContribution(
  contribution: CapabilityContribution,
): CapabilityContribution {
  return Object.freeze({
    capabilityId: contribution.capabilityId,
    files: Object.freeze(contribution.files.map(copyFileRequirement)),
    sections: Object.freeze(contribution.sections.map(copySectionRequirement)),
  });
}
