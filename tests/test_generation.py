"""End-to-end tests for deterministic plugin generation."""

from __future__ import annotations

import importlib.util
import json
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import generate_plugins


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate_plugins.py"
EXPECTED_FILES = {
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".codex.mcp.json",
    ".mcp.json",
    "README.md",
    "agents/kcode-explorer.md",
            "hooks/grep_nudge.py",
    "hooks/hooks.json",
    "hooks/run_hook.cmd",
    "hooks/run_hook.sh",
    "hooks/test_grep_nudge.py",
    "skills/code-lookup-discipline/SKILL.md",
}


class GenerationTests(unittest.TestCase):
    def test_effective_versions_are_deterministic_and_content_sensitive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(ROOT / "plugin-src", isolated / "plugin-src")

            first = generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            second = generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))

            def versions(outputs: dict[str, bytes]) -> dict[str, str]:
                return {
                    environment: json.loads(
                        outputs[f"kcoderag-{environment}/.codex-plugin/plugin.json"]
                    )["version"]
                    for environment in ("qa", "dev")
                }

            first_versions = versions(first)
            self.assertEqual(versions(second), first_versions)
            for version in first_versions.values():
                self.assertRegex(version, r"^0\.1\.1\+codex\.[0-9a-f]{16}$")

            shared_hook = isolated / "plugin-src" / "hooks" / "grep_nudge.py"
            shared_hook.write_bytes(shared_hook.read_bytes() + b"\n# content identity probe\n")
            shared_versions = versions(
                generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            )
            self.assertNotEqual(shared_versions["qa"], first_versions["qa"])
            self.assertNotEqual(shared_versions["dev"], first_versions["dev"])

            shutil.copytree(ROOT / "plugin-src", isolated / "plugin-src", dirs_exist_ok=True)
            qa_mcp = isolated / "plugin-src" / "environments" / "qa.mcp.json"
            qa_mcp.write_bytes(qa_mcp.read_bytes() + b"\n")
            qa_versions = versions(
                generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            )
            self.assertNotEqual(qa_versions["qa"], first_versions["qa"])
            self.assertEqual(qa_versions["dev"], first_versions["dev"])

    def test_nudge_is_compact_and_policy_complete(self) -> None:
        for environment in ("qa", "dev"):
            script = ROOT / f"kcoderag-{environment}" / "hooks" / "grep_nudge.py"
            spec = importlib.util.spec_from_file_location(f"compact_nudge_{environment}", script)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            nudge = module.NUDGE
            lowered = nudge.lower()

            self.assertLessEqual(len(nudge), 320)
            for tool in ("search_code", "context", "get_call_chain"):
                self.assertIn(tool, nudge)
            self.assertIn("exact", lowered)
            self.assertIn("uncommitted", lowered)
            self.assertIn("explicit fallback", lowered)
            self.assertIn("index is unavailable or stale", lowered)
            self.assertNotIn("qa and dev", lowered)
            self.assertNotIn("routing", lowered)
            self.assertNotIn("mcp__plugin_", nudge)
            self.assertNotIn("deny", lowered)
            self.assertNotIn("enforce", lowered)

    def test_generation_check_accepts_tracked_outputs(self) -> None:
        result = subprocess.run(
            [sys.executable, str(GENERATOR), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, "generation check failed")

    def test_generated_text_checkout_contract_is_lf(self) -> None:
        text_suffixes = {".json", ".md", ".tmpl", ".txt", ".py", ".sh", ".cmd"}
        paths = {
            path.relative_to(ROOT).as_posix()
            for path in (ROOT / "plugin-src").rglob("*")
            if path.is_file() and path.suffix in text_suffixes
        }
        paths.update({".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json"})
        for environment in ("qa", "dev"):
            paths.update(f"kcoderag-{environment}/{relative}" for relative in EXPECTED_FILES)

        result = subprocess.run(
            ["git", "check-attr", "eol", "--", *sorted(paths)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.splitlines(),
            [f"{path}: eol: lf" for path in sorted(paths)],
        )

    def test_generated_packages_are_self_contained(self) -> None:
        for environment in ("qa", "dev"):
            package = ROOT / f"kcoderag-{environment}"
            paths = {
                path.relative_to(package).as_posix()
                for path in package.rglob("*")
                if path.is_file() and "__pycache__" not in path.parts
            }
            self.assertEqual(paths, EXPECTED_FILES)
            self.assertFalse(any(path.is_symlink() for path in package.rglob("*")))

            manifest = json.loads((package / ".codex-plugin" / "plugin.json").read_text())
            self.assertEqual(manifest["name"], f"kcoderag-{environment}")
            self.assertEqual(manifest["mcpServers"], "./.codex.mcp.json")
            self.assertEqual(manifest["skills"], "./skills/")

    def test_isolated_write_is_repeatable_and_check_is_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            isolated.mkdir()
            for relative_path in (
                "plugin-src",
                "scripts",
                "kcoderag-qa",
                "kcoderag-dev",
                ".claude-plugin",
                ".agents",
            ):
                shutil.copytree(ROOT / relative_path, isolated / relative_path)

            command = [sys.executable, "scripts/generate_plugins.py", "--write"]
            first = subprocess.run(command, cwd=isolated, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, "first isolated generation failed")
            first_manifest = self._distribution_manifest(isolated)
            second = subprocess.run(command, cwd=isolated, capture_output=True, text=True, check=False)
            self.assertEqual(second.returncode, 0, "second isolated generation failed")
            self.assertEqual(self._distribution_manifest(isolated), first_manifest)

            drifted = isolated / "kcoderag-qa" / "README.md"
            drifted.write_bytes(drifted.read_bytes() + b"synthetic-drift\n")
            before_check = drifted.read_bytes()
            check = subprocess.run(
                [sys.executable, "scripts/generate_plugins.py", "--check"],
                cwd=isolated,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(check.returncode, 0)
            self.assertEqual(check.stdout, "drift: kcoderag-qa/README.md\n")
            self.assertEqual(drifted.read_bytes(), before_check)

    def test_each_package_runs_without_canonical_parent(self) -> None:
        metadata = json.loads((ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8"))
        by_id = {item["id"]: item for item in metadata["environments"]}
        with tempfile.TemporaryDirectory() as directory:
            standalone_root = Path(directory)
            process_environment = os.environ.copy()
            process_environment["PYTHONIOENCODING"] = "ascii"
            for environment in ("qa", "dev"):
                package = standalone_root / f"standalone-{environment}"
                shutil.copytree(ROOT / f"kcoderag-{environment}", package)
                self.assertFalse((standalone_root / "plugin-src").exists())
                result = subprocess.run(
                    [sys.executable, str(package / "hooks" / "test_grep_nudge.py")],
                    cwd=package,
                    capture_output=True,
                    text=True,
                    check=False,
                    env=process_environment,
                )
                self.assertEqual(result.returncode, 0, f"{environment} standalone hook regression failed")

                source_mcp = ROOT / by_id[environment]["mcp_source"]
                generated_mcp = package / ".mcp.json"
                self.assertEqual(
                    hashlib.sha256(source_mcp.read_bytes()).digest(),
                    hashlib.sha256(generated_mcp.read_bytes()).digest(),
                    "generated MCP bytes differ from their environment source",
                )

                source_entry = json.loads(source_mcp.read_text(encoding="utf-8"))["mcpServers"][
                    by_id[environment]["server_name"]
                ]
                codex_mcp = json.loads((package / ".codex.mcp.json").read_text(encoding="utf-8"))
                self.assertEqual(set(codex_mcp), {"mcp_servers"}, "Codex MCP must use the mcp_servers wrapper")
                codex_entry = codex_mcp["mcp_servers"][by_id[environment]["server_name"]]
                self.assertEqual(set(codex_entry), {"url", "http_headers"})
                self.assertEqual(codex_entry["url"], source_entry["url"])
                self.assertEqual(codex_entry["http_headers"], source_entry["http_headers"])

                self.assertFalse((package / "settings.json").exists())
                base_version = (ROOT / "plugin-src" / "version.txt").read_text(
                    encoding="utf-8"
                ).strip()
                published_versions = json.loads(
                    (ROOT / "kcoderag-update.json").read_text(encoding="utf-8")
                )["versions"]
                for manifest_path in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json"):
                    manifest = json.loads((package / manifest_path).read_text(encoding="utf-8"))
                    self.assertEqual(manifest["version"], published_versions[environment])
                    self.assertRegex(
                        manifest["version"],
                        rf"^{re.escape(base_version)}\+codex\.[0-9a-f]{{16}}$",
                    )

    def test_manifest_and_install_documentation_contracts(self) -> None:
        metadata = json.loads((ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8"))
        environments = metadata["environments"]
        marketplace = json.loads(
            (ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8")
        )
        self.assertEqual([item["name"] for item in marketplace["plugins"]], ["kcoderag-qa", "kcoderag-dev"])

        codex_marketplace = json.loads(
            (ROOT / ".agents" / "plugins" / "marketplace.json").read_text(encoding="utf-8")
        )
        self.assertEqual(codex_marketplace["name"], "kcoderag-nav")
        self.assertEqual(
            [item["name"] for item in codex_marketplace["plugins"]], ["kcoderag-qa", "kcoderag-dev"]
        )
        for item in codex_marketplace["plugins"]:
            self.assertEqual(set(item), {"name", "source", "policy", "category"})
            self.assertRegex(item["source"], r"^\./")
            self.assertEqual(item["policy"]["installation"], "AVAILABLE")
            self.assertEqual(item["policy"]["authentication"], "ON_INSTALL")
            self.assertTrue((ROOT / item["source"]).is_dir())

        root_readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("python scripts/manage_project_install.py install --target PATH", root_readme)
        self.assertIn("--environment dev", root_readme)
        self.assertNotIn("--environment both", root_readme)
        self.assertIn("QA 与 Dev 不能同时安装", root_readme)
        self.assertIn("status --target PATH", root_readme)
        self.assertIn("status --target PATH --json", root_readme)
        self.assertIn("0 = `healthy`", root_readme)
        self.assertIn("2 = `invalid`", root_readme)
        self.assertIn("codex plugin add", root_readme)
        for command in (
            "claude plugin marketplace add Tooc0ld/kcoderag-nav --scope project",
            "claude plugin install kcoderag-qa@kcoderag-nav --scope project",
            "claude plugin uninstall kcoderag-qa@kcoderag-nav --scope project",
        ):
            self.assertIn(command, root_readme)
        self.assertIn("纯 MCP 安装", root_readme)
        self.assertIn("只连接 MCP server", root_readme)
        self.assertIn("不包含 plugin hook、skill 或 agent", root_readme)

        for environment in environments:
            package = ROOT / environment["plugin_name"]
            codex_manifest = json.loads(
                (package / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8")
            )
            self.assertTrue((package / codex_manifest["mcpServers"]).is_file())
            self.assertTrue((package / codex_manifest["skills"]).is_dir())
            claude_manifest = json.loads(
                (package / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
            )
            self.assertEqual(claude_manifest["name"], environment["plugin_name"])
            hooks = json.loads((package / "hooks" / "hooks.json").read_text(encoding="utf-8"))
            registration = hooks["hooks"]["PreToolUse"][0]
            self.assertEqual(registration["matcher"], "^(Grep|Glob|Bash)$")
            handler = registration["hooks"][0]
            self.assertIn("hooks/run_hook.sh", handler["command"])
            self.assertIn("${CLAUDE_PLUGIN_ROOT}", handler["command"])
            self.assertNotIn("grep_nudge.py", handler["command"])
            self.assertIn("hooks\\run_hook.cmd", handler["commandWindows"])
            self.assertIn("PLUGIN_ROOT", handler["commandWindows"])
            self.assertNotIn("grep_nudge.py", handler["commandWindows"])
            for launcher in ("run_hook.sh", "run_hook.cmd"):
                self.assertEqual(
                    (package / "hooks" / launcher).read_bytes(),
                    (ROOT / "plugin-src" / "hooks" / launcher).read_bytes(),
                )
            mcp = json.loads((package / ".mcp.json").read_text(encoding="utf-8"))
            self.assertEqual(list(mcp["mcpServers"]), [environment["server_name"]])

            agent = (package / "agents" / "kcode-explorer.md").read_text(encoding="utf-8")
            for tool in ("search_code", "get_call_chain", "context", "list_indexes", "cypher"):
                self.assertIn(f"{environment['agent_tool_prefix']}{tool}", agent)
            self.assertNotIn(f"mcp__{environment['server_name']}__", agent)

    def test_environment_metadata_locks_plugin_scoped_prefixes(self) -> None:
        metadata = json.loads((ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8"))
        for environment in metadata["environments"]:
            with self.subTest(environment=environment["id"]):
                package = environment["plugin_name"]
                expected_prefix = f"mcp__plugin_{package}_{environment['server_name']}__"
                self.assertEqual(environment["agent_tool_prefix"], expected_prefix)
                self.assertEqual(environment["permission_namespace"], expected_prefix + "*")

    def test_gitignore_protects_install_outputs_with_credentials(self) -> None:
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertIn("/.codex/", gitignore)
        self.assertIn("/.agents/skills/", gitignore)

    @staticmethod
    def _distribution_manifest(root: Path) -> dict[str, str]:
        paths = [root / ".claude-plugin" / "marketplace.json"]
        for environment in ("qa", "dev"):
            package = root / f"kcoderag-{environment}"
            paths.extend(package / relative_path for relative_path in EXPECTED_FILES)
        return {
            path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)
        }


if __name__ == "__main__":
    unittest.main()
