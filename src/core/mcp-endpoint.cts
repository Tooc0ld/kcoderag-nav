/** Secret-opaque normalization for remote MCP endpoint projection. */

const { URL } = require("node:url") as typeof import("node:url");

import { InstallError } from "./contracts.cjs";

export function normalizeRemoteMcpUrl(value: string, safePath: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InstallError("invalid_mcp_source", safePath);
  }
  if (!parsed.pathname.endsWith("/mcp/")) return value;

  // The native clients treat the final slash as a distinct endpoint; preserve every opaque suffix byte.
  const suffixIndex = [value.indexOf("?"), value.indexOf("#")]
    .filter((index) => index >= 0)
    .reduce((current, index) => Math.min(current, index), value.length);
  return `${value.slice(0, suffixIndex - 1)}${value.slice(suffixIndex)}`;
}
