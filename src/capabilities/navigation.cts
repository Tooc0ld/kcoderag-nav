/** Pure navigation capability provider; host adapters project these requirements. */

import {
  copyCapabilityContribution,
  type CapabilityContribution,
  type CapabilityProvider,
  type CapabilitySupportDecision,
} from "./contracts.cjs";

const NAVIGATION_REQUIREMENTS: CapabilityContribution =
  copyCapabilityContribution({
    capabilityId: "kcoderag-navigation",
    files: [
      {
        id: "navigation:mcp-config",
        sourcePath: "plugin-src/environments/qa.mcp.json",
        kind: "mcp-config",
        shared: true,
      },
      {
        id: "navigation:skill",
        sourcePath: "plugin-src/skills/code-lookup-discipline/SKILL.md",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:pre-tool-handler",
        sourcePath: "dist/hooks/grep-nudge.cjs",
        kind: "handler",
        shared: true,
      },
    ],
    sections: [
      { id: "navigation:mcp", kind: "mcp", shared: true },
      { id: "navigation:pre-tool", kind: "pre-tool", shared: true },
    ],
  });

const NAVIGATION_SUPPORT: CapabilitySupportDecision = Object.freeze({
  eligible: true,
  deliveryMode: "host_native",
});

export const navigationCapabilityProvider: CapabilityProvider = Object.freeze({
  id: "kcoderag-navigation" as const,
  contribution: () => copyCapabilityContribution(NAVIGATION_REQUIREMENTS),
  evaluateSupport: () => NAVIGATION_SUPPORT,
});

