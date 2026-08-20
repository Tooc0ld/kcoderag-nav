"""Standard-library loopback MCP server used by deterministic host smoke tests."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import TracebackType
from typing import Any


MCP_PATH = "/mcp"
MAX_BODY_BYTES = 65_536
SYNTHETIC_TOOL = "search_code"


def read_receipts(path: Path) -> list[dict[str, object]]:
    """Read the metadata-only JSONL receipt emitted by the stub."""
    if not path.is_file():
        return []
    receipts: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line:
            value = json.loads(line)
            if isinstance(value, dict):
                receipts.append(value)
    return receipts


class _StubHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], receipt_path: Path) -> None:
        super().__init__(address, _StubHandler)
        self.receipt_path = receipt_path
        self.receipt_lock = threading.Lock()

    def record(self, payload: dict[str, Any]) -> None:
        method = payload.get("method")
        request_id = payload.get("id")
        params = payload.get("params")
        tool_name = params.get("name") if isinstance(params, dict) else ""
        receipt = {
            "path": MCP_PATH,
            "method": method if isinstance(method, str) else "",
            "tool_name": tool_name if isinstance(tool_name, str) else "",
            "request_id": request_id if isinstance(request_id, (str, int)) else None,
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        }
        encoded = json.dumps(receipt, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.receipt_lock:
            self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
            with self.receipt_path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(encoded)


class _StubHandler(BaseHTTPRequestHandler):
    server: _StubHTTPServer

    def log_message(self, format: str, *args: object) -> None:
        return

    def _send_json(self, status: int, payload: object | None) -> None:
        encoded = (
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if payload is not None
            else b""
        )
        self.send_response(status)
        if encoded:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Mcp-Session-Id", "synthetic-loopback-session")
        self.end_headers()
        if encoded:
            self.wfile.write(encoded)

    def do_POST(self) -> None:
        if self.path != MCP_PATH:
            self._send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "invalid_length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(400, {"error": "invalid_body"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid_json"})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "invalid_request"})
            return

        self.server.record(payload)
        method = payload.get("method")
        request_id = payload.get("id")
        if method == "notifications/initialized" and "id" not in payload:
            self._send_json(202, None)
            return
        if method == "initialize":
            result: object = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "synthetic-loopback", "version": "1.0"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": SYNTHETIC_TOOL,
                        "description": "Synthetic read-only code search for offline smoke tests",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"query": {"type": "string"}},
                            "required": ["query"],
                            "additionalProperties": False,
                        },
                    }
                ]
            }
        elif method == "tools/call":
            params = payload.get("params")
            if not isinstance(params, dict) or params.get("name") != SYNTHETIC_TOOL:
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32602, "message": "Invalid params"},
                    },
                )
                return
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {"status": "ok", "synthetic": True},
                            separators=(",", ":"),
                        ),
                    }
                ],
                "isError": False,
            }
        else:
            self._send_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": "Method not found"},
                },
            )
            return
        self._send_json(200, {"jsonrpc": "2.0", "id": request_id, "result": result})


class StubMCPServer:
    """Context-managed MCP stub that refuses every non-loopback bind."""

    def __init__(
        self,
        *,
        receipt_path: Path,
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        if host != "127.0.0.1":
            raise ValueError("stub_mcp_requires_loopback")
        self._httpd = _StubHTTPServer((host, port), receipt_path)
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        host, port = self._httpd.server_address[:2]
        return f"http://{host}:{port}{MCP_PATH}"

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._thread is None:
            return
        self._httpd.shutdown()
        self._thread.join(timeout=5)
        self._httpd.server_close()
        self._thread = None

    def __enter__(self) -> StubMCPServer:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.stop()


if __name__ == "__main__":
    raise SystemExit("This test stub is started by scripts/run_host_smoke.py")
