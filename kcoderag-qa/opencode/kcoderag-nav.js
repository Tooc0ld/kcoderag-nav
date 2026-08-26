import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { recordKCodeRagCall } = require("../kcoderag-nav/hooks/mcp-call-marker.cjs");

/** OpenCode's stable plugin event equivalent for the shared successful-call marker. */
export const KCodeRagNav = async () => ({
  "tool.execute.after": async (input) => {
    try {
      recordKCodeRagCall(input, { host: "opencode" });
    } catch {
      // Navigation telemetry is advisory and must never affect the tool result.
    }
  },
});
