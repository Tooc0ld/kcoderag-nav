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
    "hooks/update_check.py",
    "skills/code-lookup-discipline/SKILL.md",
}
CURSOR_EXPECTED_FILES = {
    ".cursor-plugin/plugin.json",
    "README.md",
    "mcp.json",
    "rules/kcoderag-navigation.mdc",
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
                result = {
                    environment: json.loads(
                        outputs[f"kcoderag-{environment}/.codex-plugin/plugin.json"]
                    )["version"]
                    for environment in ("qa", "dev")
                }
                result["cursor"] = json.loads(
                    outputs["kcoderag-cursor/.cursor-plugin/plugin.json"]
                )["version"]
                return result

            first_versions = versions(first)
            self.assertEqual(versions(second), first_versions)
            for version in (first_versions["qa"], first_versions["dev"]):
                self.assertRegex(version, r"^0\.1\.1\+codex\.[0-9a-f]{16}$")
            self.assertRegex(
                first_versions["cursor"], r"^0\.1\.1\+cursor\.[0-9a-f]{16}$"
            )

            shared_hook = isolated / "plugin-src" / "hooks" / "grep_nudge.py"
            shared_hook.write_bytes(shared_hook.read_bytes() + b"\n# content identity probe\n")
            shared_versions = versions(
                generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            )
            self.assertNotEqual(shared_versions["qa"], first_versions["qa"])
            self.assertNotEqual(shared_versions["dev"], first_versions["dev"])
            self.assertEqual(shared_versions["cursor"], first_versions["cursor"])

            shutil.copytree(ROOT / "plugin-src", isolated / "plugin-src", dirs_exist_ok=True)
            qa_mcp = isolated / "plugin-src" / "environments" / "qa.mcp.json"
            qa_mcp.write_bytes(qa_mcp.read_bytes() + b"\n")
            qa_versions = versions(
                generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            )
            self.assertNotEqual(qa_versions["qa"], first_versions["qa"])
            self.assertEqual(qa_versions["dev"], first_versions["dev"])
            self.assertEqual(qa_versions["cursor"], first_versions["cursor"])

            cursor_rule = (
                isolated
                / "plugin-src"
                / "cursor"
                / "rules"
                / "kcoderag-navigation.mdc"
            )
            cursor_rule.write_bytes(cursor_rule.read_bytes() + b"\nCursor identity probe.\n")
            cursor_versions = versions(
                generate_plugins.render_outputs(generate_plugins.load_inputs(isolated))
            )
            self.assertEqual(cursor_versions["qa"], qa_versions["qa"])
            self.assertEqual(cursor_versions["dev"], qa_versions["dev"])
            self.assertNotEqual(cursor_versions["cursor"], qa_versions["cursor"])

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

    def test_cursor_profile_errors_do_not_expose_connection_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(ROOT / "plugin-src", isolated / "plugin-src")
            metadata = json.loads(
                (isolated / "plugin-src" / "environments.json").read_text(
                    encoding="utf-8"
                )
            )
            qa = next(item for item in metadata["environments"] if item["id"] == "qa")
            qa_path = isolated / qa["mcp_source"]
            qa_mcp = json.loads(qa_path.read_text(encoding="utf-8"))
            qa_entry = qa_mcp["mcpServers"][qa["server_name"]]
            qa_headers = qa_entry.get("http_headers", qa_entry.get("headers"))
            original_url = qa_entry["url"]
            original_authorization = qa_headers["Authorization"]
            qa_headers["Authorization"] = "invalid-auth-scheme"
            qa_path.write_text(json.dumps(qa_mcp), encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(GENERATOR), "--check", "--root", str(isolated)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("generation failed (environment_mismatch)", result.stderr)
            self.assertTrue(original_url not in result.stderr)
            self.assertTrue(original_authorization not in result.stderr)

    def test_cursor_profile_can_require_an_admin_supplied_bearer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            shutil.copytree(ROOT / "plugin-src", isolated / "plugin-src")
            metadata = json.loads(
                (isolated / "plugin-src" / "environments.json").read_text(
                    encoding="utf-8"
                )
            )
            qa = next(item for item in metadata["environments"] if item["id"] == "qa")
            qa_path = isolated / qa["mcp_source"]
            qa_mcp = json.loads(qa_path.read_text(encoding="utf-8"))
            qa_entry = qa_mcp["mcpServers"][qa["server_name"]]
            qa_entry.get("http_headers", qa_entry.get("headers")).pop("Authorization")
            qa_path.write_text(json.dumps(qa_mcp), encoding="utf-8")

            outputs = generate_plugins.render_outputs(
                generate_plugins.load_inputs(isolated)
            )
            manifest = json.loads(
                outputs["kcoderag-cursor/.cursor-plugin/plugin.json"]
            )
            bearer_variable = manifest["variables"]["properties"][
                "KCODERAG_BEARER_TOKEN"
            ]
            self.assertNotIn("default", bearer_variable)
            self.assertIn(
                "KCODERAG_BEARER_TOKEN", manifest["variables"]["required"]
            )

    def test_generated_text_checkout_contract_is_lf(self) -> None:
        text_suffixes = {".json", ".md", ".tmpl", ".txt", ".py", ".sh", ".cmd"}
        paths = {
            path.relative_to(ROOT).as_posix()
            for path in (ROOT / "plugin-src").rglob("*")
            if path.is_file() and path.suffix in text_suffixes
        }
        paths.update(
            {
                ".agents/plugins/marketplace.json",
                ".claude-plugin/marketplace.json",
                ".cursor-plugin/marketplace.json",
            }
        )
        for environment in ("qa", "dev"):
            paths.update(f"kcoderag-{environment}/{relative}" for relative in EXPECTED_FILES)
        paths.update(f"kcoderag-cursor/{relative}" for relative in CURSOR_EXPECTED_FILES)

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

        cursor_package = ROOT / "kcoderag-cursor"
        cursor_paths = {
            path.relative_to(cursor_package).as_posix()
            for path in cursor_package.rglob("*")
            if path.is_file() and "__pycache__" not in path.parts
        }
        self.assertEqual(cursor_paths, CURSOR_EXPECTED_FILES)
        self.assertFalse(any(path.is_symlink() for path in cursor_package.rglob("*")))
        self.assertFalse((cursor_package / "hooks").exists())
        self.assertFalse((cursor_package / "agents").exists())

    def test_isolated_write_is_repeatable_and_check_is_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory) / "repository"
            isolated.mkdir()
            for relative_path in (
                "plugin-src",
                "scripts",
                "kcoderag-qa",
                "kcoderag-dev",
                "kcoderag-cursor",
                ".claude-plugin",
                ".agents",
                ".cursor-plugin",
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

        cursor_marketplace = json.loads(
            (ROOT / ".cursor-plugin" / "marketplace.json").read_text(encoding="utf-8")
        )
        self.assertEqual(cursor_marketplace["name"], "kcoderag-nav")
        self.assertEqual(len(cursor_marketplace["plugins"]), 1)
        cursor_entry = cursor_marketplace["plugins"][0]
        self.assertEqual(cursor_entry["name"], "kcoderag-nav")
        self.assertEqual(cursor_entry["source"], "kcoderag-cursor")
        self.assertTrue((ROOT / cursor_entry["source"]).is_dir())

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
        for update_contract in (
            "首次相关 `PreToolUse`",
            "24 小时",
            "旧版安装",
            "git pull --ff-only",
            "python scripts/manage_project_install.py update --target PATH",
            "普通 marketplace 用户",
            "可选安全封装",
            "项目级 update 仍要求本仓库 checkout",
            "codex plugin marketplace upgrade kcoderag-nav --json",
            "codex plugin add kcoderag-qa@kcoderag-nav --json",
            "claude plugin marketplace update kcoderag-nav",
            "claude plugin update kcoderag-qa@kcoderag-nav --scope project",
            "python scripts/update_plugin.py --host codex --environment qa",
            "python scripts/update_plugin.py --host claude --environment qa",
        ):
            self.assertIn(update_contract, root_readme)
        self.assertNotIn("SessionStart", root_readme)

        qa_guide = (ROOT / "MCP_QA_EXPERIENCE_GUIDE.md").read_text(encoding="utf-8")
        for update_contract in (
            "首次相关 `PreToolUse`",
            "24 小时",
            "旧版安装",
            "git pull --ff-only",
            "python scripts/manage_project_install.py update --target PATH",
            "普通 marketplace 用户",
            "可选安全封装",
            "项目级 update 仍要求本仓库 checkout",
            "codex plugin marketplace upgrade kcoderag-nav --json",
            "codex plugin add kcoderag-qa@kcoderag-nav --json",
            "claude plugin marketplace update kcoderag-nav",
            "claude plugin update kcoderag-qa@kcoderag-nav --scope project",
            "python scripts/update_plugin.py --host codex --environment qa",
            "python scripts/update_plugin.py --host claude --environment qa",
        ):
            self.assertIn(update_contract, qa_guide)
        self.assertNotIn("SessionStart", qa_guide)
        self.assertIn("Cursor 私有插件", root_readme)
        self.assertIn("~/.cursor/plugins/local/kcoderag-nav", root_readme)
        self.assertIn("Default Off", root_readme)
        self.assertIn("project scope", root_readme)
        self.assertIn("不要在本仓库中安装", root_readme)

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
            package_readme = (package / "README.md").read_text(encoding="utf-8")
            self.assertIn("first relevant `PreToolUse`", package_readme)
            self.assertIn("24-hour", package_readme)
            self.assertIn("ordinary marketplace users", package_readme)
            self.assertIn("optional repository-checkout safety wrapper", package_readme)
            self.assertIn(
                "Project-installed updates still require a repository checkout.",
                package_readme,
            )
            for command in (
                "codex plugin marketplace upgrade kcoderag-nav --json",
                f"codex plugin add {environment['plugin_name']}@kcoderag-nav --json",
                "claude plugin marketplace update kcoderag-nav",
                (
                    f"claude plugin update {environment['plugin_name']}@kcoderag-nav "
                    "--scope project"
                ),
                f"python scripts/update_plugin.py --host codex --environment {environment['id']}",
                f"python scripts/update_plugin.py --host claude --environment {environment['id']}",
            ):
                self.assertIn(command, package_readme)
            hooks = json.loads((package / "hooks" / "hooks.json").read_text(encoding="utf-8"))
            self.assertEqual(set(hooks["hooks"]), {"PreToolUse"})
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

    def test_cursor_package_uses_one_configured_environment(self) -> None:
        package = ROOT / "kcoderag-cursor"
        manifest = json.loads(
            (package / ".cursor-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["name"], "kcoderag-nav")
        self.assertEqual(manifest["mcpServers"], "./mcp.json")
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertEqual(manifest["rules"], "./rules/")
        self.assertRegex(manifest["version"], r"^0\.1\.1\+cursor\.[0-9a-f]{16}$")

        variables = manifest["variables"]
        self.assertEqual(variables["type"], "object")
        self.assertEqual(
            set(variables["properties"]),
            {"KCODERAG_MCP_URL", "KCODERAG_BEARER_TOKEN"},
        )
        self.assertEqual(
            set(variables["required"]),
            {"KCODERAG_MCP_URL", "KCODERAG_BEARER_TOKEN"},
        )

        metadata = json.loads(
            (ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8")
        )
        qa = next(item for item in metadata["environments"] if item["id"] == "qa")
        qa_entry = json.loads((ROOT / qa["mcp_source"]).read_text(encoding="utf-8"))[
            "mcpServers"
        ][qa["server_name"]]
        qa_headers = qa_entry.get("http_headers", qa_entry.get("headers"))
        self.assertTrue(
            variables["properties"]["KCODERAG_MCP_URL"]["default"] == qa_entry["url"]
        )
        self.assertTrue(
            "Bearer " + variables["properties"]["KCODERAG_BEARER_TOKEN"]["default"]
            == qa_headers["Authorization"]
        )

        mcp = json.loads((package / "mcp.json").read_text(encoding="utf-8"))
        self.assertEqual(list(mcp["mcpServers"]), ["kcoderag"])
        self.assertEqual(mcp["mcpServers"]["kcoderag"]["url"], "${KCODERAG_MCP_URL}")
        self.assertEqual(
            mcp["mcpServers"]["kcoderag"]["headers"]["Authorization"],
            "Bearer ${KCODERAG_BEARER_TOKEN}",
        )

        rule = (package / "rules" / "kcoderag-navigation.mdc").read_text(encoding="utf-8")
        self.assertIn("alwaysApply: true", rule)
        for tool in ("search_code", "context", "get_call_chain"):
            self.assertIn(tool, rule)
        self.assertIn("explicit fallback", rule)
        self.assertNotIn("preToolUse", rule)

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
        paths = [
            root / ".claude-plugin" / "marketplace.json",
            root / ".cursor-plugin" / "marketplace.json",
        ]
        for environment in ("qa", "dev"):
            package = root / f"kcoderag-{environment}"
            paths.extend(package / relative_path for relative_path in EXPECTED_FILES)
        cursor_package = root / "kcoderag-cursor"
        paths.extend(cursor_package / relative_path for relative_path in CURSOR_EXPECTED_FILES)
        return {
            path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)
        }


if __name__ == "__main__":
    unittest.main()
