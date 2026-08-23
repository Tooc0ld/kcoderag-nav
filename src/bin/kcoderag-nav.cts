#!/usr/bin/env node
const tracer = require("../tracer/codex-install.cjs") as {
  main(argv?: string[]): Promise<number>;
};

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return tracer.main(argv);
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
