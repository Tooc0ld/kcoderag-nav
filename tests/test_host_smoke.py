"""Offline MCP protocol and dual-host smoke harness contracts."""

from __future__ import annotations

import json
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from tests.stub_mcp_server import StubMCPServer, read_receipts


def post_json(url: str, payload: object) -> tuple[int, dict[str, object] | None]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        raw = response.read()
        return response.status, json.loads(raw) if raw else None


class StubMCPServerTests(unittest.TestCase):
    def test_streamable_http_protocol_and_safe_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "receipts.jsonl"
            with StubMCPServer(receipt_path=receipt_path) as server:
                status, initialized = post_json(
                    server.url,
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-06-18",
                            "capabilities": {},
                            "clientInfo": {"name": "offline-test", "version": "1"},
                        },
                    },
                )
                self.assertEqual(status, 200)
                self.assertEqual(initialized["result"]["serverInfo"]["name"], "synthetic-loopback")

                status, notification = post_json(
                    server.url,
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                )
                self.assertEqual((status, notification), (202, None))

                _, listed = post_json(
                    server.url,
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                )
                tools = listed["result"]["tools"]
                self.assertEqual([tool["name"] for tool in tools], ["search_code"])
                self.assertIn("synthetic", tools[0]["description"].lower())

                _, called = post_json(
                    server.url,
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {
                            "name": "search_code",
                            "arguments": {"query": "SyntheticSymbol"},
                        },
                    },
                )
                content = json.loads(called["result"]["content"][0]["text"])
                self.assertEqual(content, {"status": "ok", "synthetic": True})

                _, unknown = post_json(
                    server.url,
                    {"jsonrpc": "2.0", "id": 4, "method": "unknown/method"},
                )
                self.assertEqual(unknown["error"]["code"], -32601)

                bad = urllib.request.Request(
                    server.url,
                    data=b"not-json",
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(bad, timeout=3)
                self.assertEqual(raised.exception.code, 400)
                raised.exception.close()

            receipts = read_receipts(receipt_path)
            self.assertTrue(receipts)
            self.assertTrue(
                any(
                    receipt["method"] == "tools/call"
                    and receipt["tool_name"] == "search_code"
                    for receipt in receipts
                )
            )
            for receipt in receipts:
                self.assertEqual(
                    set(receipt),
                    {"path", "method", "tool_name", "request_id", "time"},
                )
                self.assertEqual(receipt["path"], "/mcp")
                self.assertNotIn("arguments", receipt)

    def test_non_loopback_bind_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                StubMCPServer(host="0.0.0.0", receipt_path=Path(directory) / "receipts.jsonl")


if __name__ == "__main__":
    unittest.main()
