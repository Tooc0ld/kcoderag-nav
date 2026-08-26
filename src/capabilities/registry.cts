/** Closed, ordered registry for package-internal capability providers. */

import { InstallError } from "../core/contracts.cjs";
import {
  copyCapabilityContribution,
  type CapabilityContribution,
  type CapabilityId,
  type CapabilityManifest,
  type CapabilityProvider,
  type CapabilitySupportContext,
} from "./contracts.cjs";
import { navigationCapabilityProvider } from "./navigation.cjs";
import { jx3StyleNudgeCapabilityProvider } from "./jx3-style-nudge.cjs";

const BUILT_IN_PROVIDERS: readonly CapabilityProvider[] = Object.freeze([
  navigationCapabilityProvider,
  jx3StyleNudgeCapabilityProvider,
]);

export const BUILT_IN_CAPABILITIES: readonly CapabilityManifest[] = Object.freeze(
  BUILT_IN_PROVIDERS.map((provider) => Object.freeze({ id: provider.id })),
);

const KNOWN_IDS = new Set<CapabilityId>(
  BUILT_IN_CAPABILITIES.map((manifest) => manifest.id),
);

const PROVIDER_BY_ID = new Map<CapabilityId, CapabilityProvider>(
  BUILT_IN_PROVIDERS.map((provider) => [provider.id, provider]),
);

function copyProvider(provider: CapabilityProvider): CapabilityProvider {
  return Object.freeze({
    id: provider.id,
    contribution: () => copyCapabilityContribution(provider.contribution()),
    evaluateSupport: (context: CapabilitySupportContext) =>
      provider.evaluateSupport(context),
  });
}

function canonicalCapabilityIds(ids: readonly string[]): readonly CapabilityId[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new InstallError("capability_selection_required");
  }
  const requested = new Set<CapabilityId>();
  for (const value of ids) {
    if (typeof value !== "string" || value.length === 0) {
      throw new InstallError("invalid_capability_id");
    }
    if (!KNOWN_IDS.has(value as CapabilityId)) {
      throw new InstallError("unknown_capability");
    }
    requested.add(value as CapabilityId);
  }
  return Object.freeze(
    BUILT_IN_CAPABILITIES
      .map((manifest) => manifest.id)
      .filter((id) => requested.has(id)),
  );
}

export function getCapabilityProvider(id: CapabilityId): CapabilityProvider {
  if (!KNOWN_IDS.has(id)) throw new InstallError("unknown_capability");
  const provider = PROVIDER_BY_ID.get(id);
  if (provider === undefined) {
    throw new InstallError("capability_provider_unavailable");
  }
  return copyProvider(provider);
}

export function resolveCapabilitySelection(
  ids: readonly string[],
): readonly CapabilityManifest[] {
  return Object.freeze(
    canonicalCapabilityIds(ids).map((id) => Object.freeze({ id })),
  );
}

export function resolveCapabilityContributions(
  ids: readonly string[],
): readonly CapabilityContribution[] {
  const canonicalIds = canonicalCapabilityIds(ids);
  return Object.freeze(
    canonicalIds.map((id) => getCapabilityProvider(id).contribution()),
  );
}
