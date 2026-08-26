import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recordKCodeRagCall } = require("../kcoderag-nav/hooks/mcp-call-marker.cjs");
const {
  readHostUpdateNotice,
  scheduleHostUpdateRefresh,
} = require("../kcoderag-nav/hooks/update-notice.cjs");

/** OpenCode's stable after-event marker plus fail-open, cached update awareness. */
export const KCodeRagNav = async ({ client, directory }) => ({
  "tool.execute.after": async (input) => {
    try {
      recordKCodeRagCall(input, { host: "opencode" });
    } catch {
      // Navigation telemetry is advisory and must never affect the tool result.
    }
    try {
      const notice = readHostUpdateNotice("opencode", input, { cwd: directory });
      scheduleHostUpdateRefresh("opencode", input, { cwd: directory, runtimePath: "node" });
      if (notice) {
        void Promise.resolve(client.tui.showToast({
          body: { message: notice, variant: "warning" },
        })).catch(() => {});
      }
    } catch {
      // Update awareness is advisory and must never affect the tool result.
    }
  },
});
