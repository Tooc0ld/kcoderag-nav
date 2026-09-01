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

/** Reduce the native callback to the closed facts shared policy is allowed to consume. */
function closedOutcome(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const session = boundedString(input.sessionID, MAX_SESSION_ID_CHARS);
  const tool = boundedString(input.tool, MAX_TOOL_NAME_CHARS);
  if (session === undefined || tool === undefined) return undefined;
  let success = true;
  for (const field of ["success", "ok"]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "boolean" || input[field] === false) success = false;
    }
  }
  for (const field of ["cancelled", "canceled", "timed_out"]) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "boolean" || input[field] === true) success = false;
    }
  }
  if (input.error !== undefined && input.error !== null && input.error !== false && input.error !== "") {
    success = false;
  }
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || input.status.length > 64) success = false;
    else {
      const status = input.status.toLowerCase();
      if (FAILURE_STATUSES.has(status) || !SUCCESS_STATUSES.has(status)) success = false;
    }
  }
  return Object.freeze({ conversation_id: session, tool, success });
}

/** OpenCode's real after-event observation with closed, fail-open downstream facts. */
export const KCodeRagNav = async ({ client, directory }) => ({
  "tool.execute.after": async (input) => {
    const fact = closedOutcome(input);
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
