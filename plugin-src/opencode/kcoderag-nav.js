import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recordKCodeRagCall } = require("../kcoderag-nav/hooks/mcp-call-marker.cjs");
let feedbackNudgeContribution;
try {
  ({ feedbackNudgeContribution } = require("../kcoderag-nav/hooks/feedback-nudge.cjs"));
} catch {
  // A partial or damaged optional runtime must not stop the project plugin loading.
}
const {
  readHostUpdateNotice,
  scheduleHostUpdateRefresh,
} = require("../kcoderag-nav/hooks/update-notice.cjs");

const MAX_TOOL_NAME_CHARS = 96;
const MAX_SESSION_ID_CHARS = 512;
const SUCCESS_STATUSES = new Set(["ok", "success", "succeeded", "complete", "completed"]);
const FAILURE_STATUSES = new Set([
  "cancelled", "canceled", "error", "failed", "failure", "timeout", "timed_out", "aborted",
]);

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function structuredResultValid(output) {
  let remaining = 128;
  const inspect = (value, depth) => {
    if (remaining <= 0 || depth > 6 || typeof value !== "object" || value === null || Array.isArray(value)) return false;
    remaining -= 1;
    for (const [key, child] of Object.entries(value).slice(0, 64)) {
      if ((key === "structuredContent" || key === "structured_content") &&
          typeof child === "object" && child !== null && !Array.isArray(child)) return true;
      if (["result", "output", "metadata", "data", "response"].includes(key) && inspect(child, depth + 1)) return true;
    }
    return false;
  };
  return inspect(output, 0);
}

function successful(input, output) {
  let success = true;
  for (const value of [input, output]) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    for (const field of ["success", "ok"]) {
      if (value[field] !== undefined && (typeof value[field] !== "boolean" || value[field] === false)) success = false;
    }
    if (value.isError !== undefined && (typeof value.isError !== "boolean" || value.isError === true)) success = false;
    for (const field of ["cancelled", "canceled", "timed_out"]) {
      if (value[field] !== undefined && (typeof value[field] !== "boolean" || value[field] === true)) success = false;
    }
    if (value.error !== undefined && value.error !== null && value.error !== false && value.error !== "") success = false;
    if (value.status !== undefined) {
      if (typeof value.status !== "string" || value.status.length > 64) success = false;
      else {
        const status = value.status.toLowerCase();
        if (FAILURE_STATUSES.has(status) || !SUCCESS_STATUSES.has(status)) success = false;
      }
    }
  }
  return success;
}

/** Reduce the native callback to the closed facts shared policy is allowed to consume. */
function closedOutcome(input, output) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const session = boundedString(input.sessionID, MAX_SESSION_ID_CHARS);
  const tool = boundedString(input.tool, MAX_TOOL_NAME_CHARS);
  const call = boundedString(input.callID, MAX_SESSION_ID_CHARS);
  if (session === undefined || tool === undefined) return undefined;
  return Object.freeze({
    conversation_id: session,
    ...(call === undefined ? {} : { generation_id: call }),
    tool,
    success: successful(input, output),
    structuredResultValid: structuredResultValid(output),
  });
}

/** OpenCode's real after-event observation with closed, fail-open downstream facts. */
export const KCodeRagNav = async ({ client, directory }) => ({
  "tool.execute.after": async (input, output) => {
    const fact = closedOutcome(input, output);
    if (fact === undefined) return;
    try {
      recordKCodeRagCall(fact, { host: "opencode", cwd: directory });
    } catch {
      // Navigation observation is advisory and must never affect the tool result.
    }
    let feedback;
    try {
      feedback = feedbackNudgeContribution?.(fact, {
        host: "opencode",
        managedRoot: directory,
      });
    } catch {
      // Feedback guidance is advisory and independent from all other callbacks.
    }
    let notice;
    try {
      notice = readHostUpdateNotice("opencode", fact, { cwd: directory });
    } catch {
      // Cached update awareness is advisory.
    }
    try {
      scheduleHostUpdateRefresh("opencode", fact, { cwd: directory, runtimePath: "node" });
    } catch {
      // Detached refresh failure is independent from the host tool outcome.
    }
    if (notice) {
      void Promise.resolve(client.tui.showToast({
        body: { message: notice, variant: "warning" },
      })).catch(() => {});
    }
    if (feedback) {
      void Promise.resolve(client.tui.showToast({
        body: { message: feedback, variant: "info" },
      })).catch(() => {});
    }
  },
});
