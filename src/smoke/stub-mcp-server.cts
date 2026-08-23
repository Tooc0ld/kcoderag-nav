/** Bounded loopback MCP server that records metadata-only smoke receipts. */

const fs = require("node:fs") as typeof import("node:fs");
const http = require("node:http") as typeof import("node:http");
const path = require("node:path") as typeof import("node:path");

export const MCP_PATH = "/mcp";
export const SYNTHETIC_TOOL = "search_code";
const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 65_536;

export interface StubReceipt {
  readonly path: typeof MCP_PATH;
  readonly method: string;
  readonly toolName: string;
  readonly requestId: string | number | null;
}

export interface StubMcpServer {
  readonly url: string;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receiptFrom(payload: Record<string, unknown>): StubReceipt {
  const params = isRecord(payload.params) ? payload.params : undefined;
  const requestId = payload.id;
  return Object.freeze({
    path: MCP_PATH,
    method: typeof payload.method === "string" ? payload.method : "",
    toolName: params !== undefined && typeof params.name === "string" ? params.name : "",
    requestId: typeof requestId === "string" || typeof requestId === "number" ? requestId : null,
  });
}

function appendReceipt(receiptPath: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.appendFileSync(receiptPath, `${JSON.stringify(receiptFrom(payload))}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function readReceipts(receiptPath: string): readonly StubReceipt[] {
  let source: string;
  try {
    source = fs.readFileSync(receiptPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  const receipts: StubReceipt[] = [];
  for (const line of source.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        isRecord(value) &&
        value.path === MCP_PATH &&
        typeof value.method === "string" &&
        typeof value.toolName === "string" &&
        (value.requestId === null || typeof value.requestId === "string" || typeof value.requestId === "number")
      ) {
        receipts.push(Object.freeze({
          path: MCP_PATH,
          method: value.method,
          toolName: value.toolName,
          requestId: value.requestId,
        }));
      }
    } catch {
      // A partial or corrupt receipt never becomes evidence.
    }
  }
  return Object.freeze(receipts);
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  payload?: unknown,
): void {
  const encoded = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    ...(encoded.length === 0 ? {} : { "content-type": "application/json" }),
    "content-length": String(encoded.length),
    "mcp-session-id": "synthetic-loopback-session",
  });
  response.end(encoded);
}

function handleRpc(
  response: import("node:http").ServerResponse,
  payload: Record<string, unknown>,
): void {
  const method = payload.method;
  const requestId = payload.id;
  if (method === "notifications/initialized" && !Object.hasOwn(payload, "id")) {
    sendJson(response, 202);
    return;
  }
  if (method === "initialize") {
    sendJson(response, 200, {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "synthetic-loopback", version: "1.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    sendJson(response, 200, {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        tools: [{
          name: SYNTHETIC_TOOL,
          description: "Synthetic read-only code search for contract smoke",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        }],
      },
    });
    return;
  }
  if (method === "tools/call") {
    const params = isRecord(payload.params) ? payload.params : undefined;
    if (params?.name !== SYNTHETIC_TOOL) {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: requestId,
        error: { code: -32602, message: "Invalid params" },
      });
      return;
    }
    sendJson(response, 200, {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", synthetic: true }) }],
        isError: false,
      },
    });
    return;
  }
  sendJson(response, 200, {
    jsonrpc: "2.0",
    id: requestId,
    error: { code: -32601, message: "Method not found" },
  });
}

export async function startStubMcpServer(
  receiptPath: string,
  host: string = LOOPBACK_HOST,
): Promise<StubMcpServer> {
  if (host !== LOOPBACK_HOST) throw new Error("stub_mcp_requires_loopback");
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== MCP_PATH) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
      if (rejected) return;
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        rejected = true;
        sendJson(response, 413, { error: "invalid_body" });
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
      } catch {
        sendJson(response, 400, { error: "invalid_json" });
        return;
      }
      if (!isRecord(payload)) {
        sendJson(response, 400, { error: "invalid_request" });
        return;
      }
      appendReceipt(receiptPath, payload);
      handleRpc(response, payload);
    });
    request.on("error", () => {
      if (!response.headersSent) sendJson(response, 400, { error: "invalid_request" });
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("stub_mcp_start_failed");
  }
  return Object.freeze({
    url: `http://${LOOPBACK_HOST}:${address.port}${MCP_PATH}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  });
}

exports.MCP_PATH = MCP_PATH;
exports.SYNTHETIC_TOOL = SYNTHETIC_TOOL;
exports.readReceipts = readReceipts;
exports.startStubMcpServer = startStubMcpServer;
