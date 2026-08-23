#!/usr/bin/env node
const path = require("node:path") as typeof import("node:path");
const readline = require("node:readline/promises") as typeof import("node:readline/promises");

import {
  executeCommand,
  type LegacyRemovalConfirmation,
  type TargetConfirmation,
} from "../cli/commands.cjs";
import { InstallError, type HostId } from "../core/contracts.cjs";
import { codexTracerAdapter } from "../tracer/codex-install.cjs";

async function question(prompt: string): Promise<string> {
  const interfaceInstance = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await interfaceInstance.question(prompt);
  } finally {
    interfaceInstance.close();
  }
}

async function selectHost(hosts: readonly HostId[]): Promise<HostId | undefined> {
  const labels: Readonly<Record<HostId, string>> = {
    codex: "Codex",
    claude: "Claude Code",
    cursor: "Cursor",
  };
  const choices = hosts.map((host, index) => `${index + 1}) ${labels[host]}`).join("  ");
  const answer = (await question(`Select host: ${choices}\n> `)).trim();
  const index = Number.parseInt(answer, 10) - 1;
  return Number.isInteger(index) ? hosts[index] : undefined;
}

async function confirmTarget(request: TargetConfirmation): Promise<boolean> {
  const answer = await question(
    `${request.command} KCodeRag Nav ${request.host}/${request.environment} in ${request.target}? [y/N] `,
  );
  return /^(?:y|yes)$/i.test(answer.trim());
}

async function confirmLegacyUserRemoval(request: LegacyRemovalConfirmation): Promise<boolean> {
  const answer = await question(
    `Remove the verified legacy Cursor installation at ${request.legacyPath}? [y/N] `,
  );
  return /^(?:y|yes)$/i.test(answer.trim());
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return executeCommand(argv, {
    cwd: process.cwd(),
    packageRoot: path.resolve(__dirname, "../.."),
    nodeVersion: process.versions.node,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    selectHost,
    confirmTarget,
    confirmLegacyUserRemoval,
    getAdapter: (host) => {
      if (host !== "codex") throw new InstallError("unsupported_host");
      return codexTracerAdapter;
    },
  });
}

exports.main = main;

if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.stderr.write(`${JSON.stringify({ ok: false, code: "install_failed" })}\n`);
      process.exitCode = 1;
    },
  );
}
