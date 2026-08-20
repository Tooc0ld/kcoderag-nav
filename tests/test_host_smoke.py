"""Offline MCP protocol and dual-host smoke harness contracts."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import re

from scripts import run_host_smoke
from tests.stub_mcp_server import StubMCPServer, read_receipts


ROOT = Path(__file__).resolve().parents[1]


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


class HostCommandTests(unittest.TestCase):
    def test_host_commands_enforce_isolated_headless_contracts(self) -> None:
        workspace = Path("synthetic-workspace")
        plugin = Path("synthetic-plugin")
        config = Path("synthetic-mcp.json")

        codex = run_host_smoke.build_host_command(
            "codex",
            ("codex",),
            workspace=workspace,
            plugin_dir=plugin,
            mcp_config=config,
        )
        self.assertEqual(
            codex[:7],
            [
                "codex",
                "exec",
                "--ephemeral",
                "--ignore-user-config",
                "--dangerously-bypass-hook-trust",
                "--json",
                "--sandbox",
            ],
        )
        self.assertEqual(codex[7], "read-only")
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", codex)

        claude = run_host_smoke.build_host_command(
            "claude",
            ("claude",),
            workspace=workspace,
            plugin_dir=plugin,
            mcp_config=config,
        )
        for argument in (
            "-p",
            "--plugin-dir",
            "--mcp-config",
            "--strict-mcp-config",
            "--output-format",
            "stream-json",
        ):
            self.assertIn(argument, claude)
        self.assertNotIn("--dangerously-skip-permissions", claude)


def write_fake_host(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.request

mode = os.environ.get("SYNTHETIC_HOST_MODE", "pass")
if mode == "auth":
    print("authentication required", file=sys.stderr)
    raise SystemExit(2)
if mode == "timeout":
    time.sleep(10)
    raise SystemExit(0)

url = os.environ["KCODERAG_NAV_STUB_URL"]
def post(payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        response.read()

post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
post({"jsonrpc": "2.0", "method": "notifications/initialized"})
post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
post({
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {"name": "search_code", "arguments": {"query": "SyntheticSymbol"}},
})
if mode == "plain":
    print("hook and tool passed")
else:
    print(json.dumps({"type": "hook_event", "hook_event_name": "PreToolUse"}))
    print(json.dumps({"type": "mcp_tool_call", "tool_name": "search_code"}))
""",
        encoding="utf-8",
        newline="\n",
    )


class HostSmokeHarnessTests(unittest.TestCase):
    def test_fake_hosts_require_structured_events_and_stub_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_host = Path(directory) / "fake_host.py"
            write_fake_host(fake_host)
            executable = (sys.executable, str(fake_host))
            for host in ("codex", "claude"):
                with self.subTest(host=host):
                    result = run_host_smoke.run_smoke(
                        host,
                        executable=executable,
                        repository_root=ROOT,
                        timeout_seconds=5,
                    )
                    self.assertEqual(result["status"], "PASS")
                    self.assertEqual(result["reason"], "verified")
                    self.assertTrue(result["hook_event"])
                    self.assertTrue(result["tool_event"])
                    self.assertTrue(result["stub_receipt"])
                    self.assertTrue(result["config_wired"])
                    self.assertEqual(
                        set(result),
                        {
                            "schema_version",
                            "status",
                            "host",
                            "reason",
                            "hook_event",
                            "tool_event",
                            "stub_receipt",
                            "config_wired",
                        },
                    )

    def test_natural_language_success_is_not_accepted_as_host_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake_host = Path(directory) / "fake_host.py"
            write_fake_host(fake_host)
            environment = os.environ.copy()
            environment["SYNTHETIC_HOST_MODE"] = "plain"
            result = run_host_smoke.run_smoke(
                "codex",
                executable=(sys.executable, str(fake_host)),
                repository_root=ROOT,
                process_environment=environment,
                timeout_seconds=5,
            )
            self.assertEqual(result["status"], "FAIL")
            self.assertEqual(result["reason"], "structured_evidence_incomplete")
            self.assertFalse(result["hook_event"])
            self.assertFalse(result["tool_event"])
            self.assertTrue(result["stub_receipt"])

    def test_missing_auth_and_timeout_have_stable_safe_verdicts(self) -> None:
        missing = run_host_smoke.run_smoke(
            "codex",
            executable=("synthetic-host-does-not-exist",),
            repository_root=ROOT,
        )
        self.assertEqual((missing["status"], missing["reason"]), ("NOT_RUN", "cli_missing"))

        with tempfile.TemporaryDirectory() as directory:
            fake_host = Path(directory) / "fake_host.py"
            write_fake_host(fake_host)
            executable = (sys.executable, str(fake_host))
            for mode, expected in (
                ("auth", ("NOT_RUN", "auth_missing")),
                ("timeout", ("FAIL", "timeout")),
            ):
                environment = os.environ.copy()
                environment["SYNTHETIC_HOST_MODE"] = mode
                with self.subTest(mode=mode):
                    result = run_host_smoke.run_smoke(
                        "claude",
                        executable=executable,
                        repository_root=ROOT,
                        process_environment=environment,
                        timeout_seconds=0.1,
                    )
                    self.assertEqual((result["status"], result["reason"]), expected)
                    serialized = json.dumps(result)
                    self.assertNotIn("authentication required", serialized)
                    self.assertNotIn("KCODERAG_NAV_STUB_URL", serialized)


class WorkflowAndDocumentationTests(unittest.TestCase):
    def test_required_and_optional_ci_are_strictly_separated(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertRegex(workflow, r"actions/checkout@[0-9a-f]{40}")
        self.assertRegex(workflow, r"actions/setup-python@[0-9a-f]{40}")
        for token in (
            "push:",
            "pull_request:",
            "workflow_dispatch:",
            "ubuntu-latest",
            "windows-latest",
            '"3.10"',
            "scripts/generate_plugins.py --check",
            'unittest discover -s tests -p "test_*.py" -v',
            "kcoderag-qa/hooks/test_grep_nudge.py",
            "kcoderag-dev/hooks/test_grep_nudge.py",
            "kcoderag-host-smoke",
            "scripts/run_host_smoke.py --host",
        ):
            self.assertIn(token, workflow)
        self.assertNotRegex(workflow, r"(?i)(pip|npm|cargo)\s+install")

    def test_readme_and_experience_guide_document_safe_operational_boundaries(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        guide = (ROOT / "MCP_QA_EXPERIENCE_GUIDE.md").read_text(encoding="utf-8")
        combined = "\n".join((readme, guide))
        for token in (
            "Python 3.10+",
            "python3",
            "py -3",
            "fail-open",
            "status --target PATH --json",
            "required CI",
            "optional host smoke",
            "--dangerously-bypass-hook-trust",
        ):
            self.assertIn(token, combined)
        for document in (readme, guide):
            for command in (
                "claude plugin marketplace add Tooc0ld/kcoderag-nav --scope project",
                "claude plugin install kcoderag-qa@kcoderag-nav --scope project",
                "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope project",
            ):
                self.assertIn(command, document)
            self.assertIn("纯 MCP 安装", document)
            self.assertIn("只连接 MCP server", document)
            self.assertIn("不包含 plugin hook、skill 或 agent", document)
        self.assertNotIn("Authorization", combined)
        self.assertNotIn("Bearer", combined)

        sensitive_values: list[str] = []
        metadata = json.loads(
            (ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8")
        )
        for environment in metadata["environments"]:
            document = json.loads((ROOT / environment["mcp_source"]).read_text(encoding="utf-8"))
            entry = document["mcpServers"][environment["server_name"]]
            sensitive_values.append(entry["url"])
            headers = entry.get("headers", entry.get("http_headers", {}))
            sensitive_values.extend(headers.values())
        artifacts = "\n".join(
            (
                combined,
                (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"),
                (ROOT / "scripts" / "run_host_smoke.py").read_text(encoding="utf-8"),
            )
        )
        self.assertFalse(
            any(value and value in artifacts for value in sensitive_values),
            "public smoke artifacts contain a canonical sensitive value",
        )
        self.assertIsNone(re.search(r"https?://[^\s)>]+", guide))


if __name__ == "__main__":
    unittest.main()
