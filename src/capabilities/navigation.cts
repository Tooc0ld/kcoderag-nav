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
        sourcePath: "plugin-src/skills/kcoderag/SKILL.md",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:skill-openai",
        sourcePath: "plugin-src/skills/kcoderag/agents/openai.yaml",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:manage-skill",
        sourcePath: "plugin-src/skills/kcoderag-manage/SKILL.md",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:manage-skill-openai",
        sourcePath: "plugin-src/skills/kcoderag-manage/agents/openai.yaml",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:feedback-skill",
        sourcePath: "plugin-src/skills/kcoderag-feedback/SKILL.md",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:feedback-skill-openai",
        sourcePath: "plugin-src/skills/kcoderag-feedback/agents/openai.yaml",
        kind: "skill",
        shared: false,
      },
      {
        id: "navigation:pre-tool-handler",
        sourcePath: "dist/hooks/grep-nudge.cjs",
        kind: "handler",
        shared: true,
      },
      {
        id: "navigation:feedback-handler",
        sourcePath: "dist/hooks/feedback-nudge.cjs",
        kind: "handler",
        shared: true,
      },
      {
        id: "navigation:reminder-governor",
        sourcePath: "dist/hooks/once-marker.cjs",
        kind: "marker",
        shared: true,
      },
      {
        id: "navigation:update-check",
        sourcePath: "dist/hooks/update-check.cjs",
        kind: "handler",
        shared: true,
      },
      {
        id: "navigation:update-worker",
        sourcePath: "dist/hooks/update-worker.cjs",
        kind: "handler",
        shared: true,
      },
      {
        id: "navigation:update-notice",
        sourcePath: "dist/hooks/update-notice.cjs",
        kind: "handler",
        shared: true,
      },
      {
        id: "navigation:success-marker",
        sourcePath: "dist/hooks/mcp-call-marker.cjs",
        kind: "marker",
        shared: true,
      },
      {
        id: "navigation:pre-tool-launcher-windows",
        sourcePath: "plugin-src/hooks/run_hook.cmd",
        kind: "launcher",
        shared: true,
      },
      {
        id: "navigation:pre-tool-launcher-posix",
        sourcePath: "plugin-src/hooks/run_hook.sh",
        kind: "launcher",
        shared: true,
      },
      {
        id: "navigation:marker-launcher-windows",
        sourcePath: "plugin-src/hooks/run_marker.cmd",
        kind: "launcher",
        shared: true,
      },
      {
        id: "navigation:marker-launcher-posix",
        sourcePath: "plugin-src/hooks/run_marker.sh",
        kind: "launcher",
        shared: true,
      },
      {
        id: "navigation:cursor-rule",
        sourcePath: "plugin-src/cursor/rules/kcoderag-navigation.mdc",
        kind: "rule",
        shared: false,
      },
      {
        id: "navigation:opencode-plugin",
        sourcePath: "plugin-src/opencode/kcoderag-nav.js",
        kind: "plugin",
        shared: true,
      },
    ],
    sections: [
      { id: "navigation:mcp", kind: "mcp", shared: true },
      { id: "navigation:session-start", kind: "session-start", shared: true },
      { id: "navigation:pre-tool", kind: "pre-tool", shared: true },
      { id: "navigation:post-tool", kind: "post-tool", shared: true },
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
