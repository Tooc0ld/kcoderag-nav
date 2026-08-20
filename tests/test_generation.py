"""End-to-end tests for deterministic plugin generation."""

from __future__ import annotations

import json
import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate_plugins.py"
EXPECTED_FILES = {
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "agents/kcode-explorer.md",
    "hooks/grep_nudge.py",
    "hooks/hooks.json",
    "hooks/test_grep_nudge.py",
    "settings.json",
    "skills/code-lookup-discipline/SKILL.md",
}


class GenerationTests(unittest.TestCase):
    def test_generation_check_accepts_tracked_outputs(self) -> None:
        result = subprocess.run(
            [sys.executable, str(GENERATOR), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, "generation check failed")

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
            self.assertEqual(manifest["mcpServers"], "./.mcp.json")
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
                )
                self.assertEqual(result.returncode, 0, f"{environment} standalone hook regression failed")

                source_mcp = ROOT / by_id[environment]["mcp_source"]
                generated_mcp = package / ".mcp.json"
                self.assertEqual(
                    hashlib.sha256(source_mcp.read_bytes()).digest(),
                    hashlib.sha256(generated_mcp.read_bytes()).digest(),
                    "generated MCP bytes differ from their environment source",
                )
                settings = json.loads((package / "settings.json").read_text(encoding="utf-8"))
                self.assertEqual(
                    settings["permissions"]["allow"],
                    [by_id[environment]["permission_namespace"]],
                )

    def test_manifest_and_install_documentation_contracts(self) -> None:
        metadata = json.loads((ROOT / "plugin-src" / "environments.json").read_text(encoding="utf-8"))
        environments = metadata["environments"]
        marketplace = json.loads(
            (ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8")
        )
        self.assertEqual([item["name"] for item in marketplace["plugins"]], ["kcoderag-qa", "kcoderag-dev"])

        root_readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("python scripts/manage_project_install.py install --target PATH", root_readme)
        self.assertIn("--environment dev", root_readme)
        self.assertIn("--environment both", root_readme)
        self.assertIn("codex plugin add", root_readme)
        self.assertIn("/plugin marketplace add", root_readme)

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
            self.assertIn("hooks/grep_nudge.py", registration["hooks"][0]["command"])
            mcp = json.loads((package / ".mcp.json").read_text(encoding="utf-8"))
            self.assertEqual(list(mcp["mcpServers"]), [environment["server_name"]])

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
