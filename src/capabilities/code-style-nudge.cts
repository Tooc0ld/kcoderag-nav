/** Pure code-style nudge provider bound to exact checked-in native delivery evidence. */

import { evaluateHostVersionSupport } from "../hosts/host-version-support.cjs";
import {
  copyCapabilityContribution,
  type CapabilityContribution,
  type CapabilityProvider,
  type CapabilitySupportContext,
  type CapabilitySupportDecision,
} from "./contracts.cjs";

const CODE_STYLE_REQUIREMENTS: CapabilityContribution = copyCapabilityContribution({
  capabilityId: "code-style-nudge",
  files: [
    {
      id: "code-style:skill-index",
      sourcePath: "plugin-src/capabilities/code-style-nudge/skill/SKILL.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:skill-openai",
      sourcePath: "plugin-src/capabilities/code-style-nudge/skill/agents/openai.yaml",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:skill-cpp-lifetime-control-flow",
      sourcePath:
        "plugin-src/capabilities/code-style-nudge/skill/references/cpp-lifetime-control-flow.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:skill-protocol-serialization-data",
      sourcePath:
        "plugin-src/capabilities/code-style-nudge/skill/references/protocol-serialization-data.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:skill-lua-contracts",
      sourcePath:
        "plugin-src/capabilities/code-style-nudge/skill/references/lua-contracts.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:skill-change-hygiene-self-review",
      sourcePath:
        "plugin-src/capabilities/code-style-nudge/skill/references/change-hygiene-self-review.md",
      kind: "skill",
      shared: false,
    },
    {
      id: "code-style:handler",
      sourcePath: "dist/hooks/code-style-nudge.cjs",
      kind: "handler",
      shared: false,
    },
    {
      id: "code-style:dispatcher",
      sourcePath: "dist/hooks/pre-tool-dispatcher.cjs",
      kind: "dispatcher",
      shared: true,
    },
    {
      id: "code-style:once-marker",
      sourcePath: "dist/hooks/once-marker.cjs",
      kind: "marker",
      shared: true,
    },
    {
      id: "code-style:pre-tool-launcher-windows",
      sourcePath: "plugin-src/hooks/run_hook.cmd",
      kind: "launcher",
      shared: true,
    },
    {
      id: "code-style:pre-tool-launcher-posix",
      sourcePath: "plugin-src/hooks/run_hook.sh",
      kind: "launcher",
      shared: true,
    },
  ],
  sections: [
    { id: "code-style:pre-tool", kind: "pre-tool", shared: true },
  ],
});

function evaluateCodeStyleSupport(
  context: CapabilitySupportContext,
): CapabilitySupportDecision {
  const result = context.evidenceRoot === undefined
    ? evaluateHostVersionSupport(context.host, context.hostVersion)
    : evaluateHostVersionSupport(
        context.host,
        context.hostVersion,
        context.evidenceRoot,
      );
  return Object.freeze({
    eligible: true,
    deliveryMode: "manual_skill" as const,
    automaticNudge: result.codeStyleNudge && result.receiptDigest !== undefined
      ? Object.freeze({
          eligible: true as const,
          evidenceDigest: result.receiptDigest,
        })
      : Object.freeze({
          eligible: false as const,
          code: "host_version_unsupported" as const,
        }),
  });
}

export const codeStyleNudgeCapabilityProvider: CapabilityProvider = Object.freeze({
  id: "code-style-nudge" as const,
  contribution: () => copyCapabilityContribution(CODE_STYLE_REQUIREMENTS),
  evaluateSupport: evaluateCodeStyleSupport,
});
