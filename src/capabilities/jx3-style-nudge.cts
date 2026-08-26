/** Pure JX3 nudge provider bound to exact checked-in native delivery evidence. */

import { evaluateHostVersionSupport } from "../hosts/host-version-support.cjs";
import {
  copyCapabilityContribution,
  type CapabilityContribution,
  type CapabilityProvider,
  type CapabilitySupportContext,
  type CapabilitySupportDecision,
} from "./contracts.cjs";

const JX3_REQUIREMENTS: CapabilityContribution = copyCapabilityContribution({
  capabilityId: "jx3-style-nudge",
  files: [
    {
      id: "jx3:skill-index",
      sourcePath: "plugin-src/capabilities/jx3-style-nudge/skill/SKILL.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "jx3:skill-cpp-lifetime-control-flow",
      sourcePath:
        "plugin-src/capabilities/jx3-style-nudge/skill/references/cpp-lifetime-control-flow.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "jx3:skill-protocol-serialization-data",
      sourcePath:
        "plugin-src/capabilities/jx3-style-nudge/skill/references/protocol-serialization-data.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "jx3:skill-lua-contracts",
      sourcePath:
        "plugin-src/capabilities/jx3-style-nudge/skill/references/lua-contracts.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "jx3:skill-change-hygiene-self-review",
      sourcePath:
        "plugin-src/capabilities/jx3-style-nudge/skill/references/change-hygiene-self-review.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "jx3:handler",
      sourcePath: "dist/hooks/jx3-style-nudge.cjs",
      kind: "handler",
      shared: false,
    },
    {
      id: "jx3:dispatcher",
      sourcePath: "dist/hooks/pre-tool-dispatcher.cjs",
      kind: "dispatcher",
      shared: true,
    },
    {
      id: "jx3:once-marker",
      sourcePath: "dist/hooks/once-marker.cjs",
      kind: "marker",
      shared: true,
    },
    {
      id: "jx3:pre-tool-launcher-windows",
      sourcePath: "plugin-src/hooks/run_hook.cmd",
      kind: "launcher",
      shared: true,
    },
    {
      id: "jx3:pre-tool-launcher-posix",
      sourcePath: "plugin-src/hooks/run_hook.sh",
      kind: "launcher",
      shared: true,
    },
  ],
  sections: [
    { id: "jx3:pre-tool", kind: "pre-tool", shared: true },
  ],
});

function evaluateJx3Support(
  context: CapabilitySupportContext,
): CapabilitySupportDecision {
  const result = context.evidenceRoot === undefined
    ? evaluateHostVersionSupport(context.host, context.hostVersion)
    : evaluateHostVersionSupport(
        context.host,
        context.hostVersion,
        context.evidenceRoot,
      );
  if (!result.jx3StyleNudge || result.receiptDigest === undefined) {
    return Object.freeze({
      eligible: false,
      code: "host_version_unsupported" as const,
    });
  }
  return Object.freeze({
    eligible: true,
    deliveryMode: "native_pre_write" as const,
    evidenceDigest: result.receiptDigest,
  });
}

export const jx3StyleNudgeCapabilityProvider: CapabilityProvider = Object.freeze({
  id: "jx3-style-nudge" as const,
  contribution: () => copyCapabilityContribution(JX3_REQUIREMENTS),
  evaluateSupport: evaluateJx3Support,
});

