#!/bin/sh
# Run the deployed CommonJS hook from this launcher's directory and always fail open.

case $0 in
    */*) hook_script=${0%/*}/pre-tool-dispatcher.cjs ;;
    *\\*) hook_script=${0%\\*}\\pre-tool-dispatcher.cjs ;;
    *) hook_script=./pre-tool-dispatcher.cjs ;;
esac

command -v node >/dev/null 2>&1 || exit 0
node -e 'const major=Number(process.versions.node.split(".")[0]);process.exit(Number.isInteger(major) && major >= 22 ? 0 : 1)' \
    >/dev/null 2>&1 || exit 0

output=$(node -e '
const path = require("node:path");
const dispatcher = process.argv[1];
const host = process.argv[2];
const managedRoot = path.resolve(path.dirname(dispatcher), "..", "..", "..", "..");
process.exitCode = require(dispatcher).main(
  undefined,
  (text) => process.stdout.write(text),
  undefined,
  { host, managedRoot },
);
' "$hook_script" "$1" 2>/dev/null)
status=$?
if [ "$status" -eq 0 ]; then
    printf '%s' "$output"
fi
exit 0
