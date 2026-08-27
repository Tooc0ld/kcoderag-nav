const { test } = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const endpoint = require("../../dist/core/mcp-endpoint.cjs") as Record<string, any>;

test("remote MCP endpoint normalization removes only the terminal MCP slash", () => {
  assert.equal(
    endpoint.normalizeRemoteMcpUrl("https://example.invalid/mcp/", "fixture.json"),
    "https://example.invalid/mcp",
  );
  assert.equal(
    endpoint.normalizeRemoteMcpUrl("https://example.invalid/mcp/?opaque=1#fragment", "fixture.json"),
    "https://example.invalid/mcp?opaque=1#fragment",
  );
  assert.equal(
    endpoint.normalizeRemoteMcpUrl("https://example.invalid/other/", "fixture.json"),
    "https://example.invalid/other/",
  );
});

test("remote MCP endpoint normalization rejects invalid and non-HTTP sources", () => {
  for (const value of ["not-a-url", "file:///mcp/"]) {
    assert.throws(
      () => endpoint.normalizeRemoteMcpUrl(value, "fixture.json"),
      (error: any) => error?.code === "invalid_mcp_source" && error?.safePath === "fixture.json",
    );
  }
});
