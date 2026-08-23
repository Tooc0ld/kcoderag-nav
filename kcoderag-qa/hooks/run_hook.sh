#!/bin/sh
# Run the deployed CommonJS hook from this launcher's directory and always fail open.

case $0 in
    */*) hook_script=${0%/*}/grep-nudge.cjs ;;
    *\\*) hook_script=${0%\\*}\\grep-nudge.cjs ;;
    *) hook_script=./grep-nudge.cjs ;;
esac

command -v node >/dev/null 2>&1 || exit 0
node -e 'const major=Number(process.versions.node.split(".")[0]);process.exit(Number.isInteger(major) && major >= 22 ? 0 : 1)' \
    >/dev/null 2>&1 || exit 0

output=$(node "$hook_script" 2>/dev/null)
status=$?
if [ "$status" -eq 0 ]; then
    printf '%s' "$output"
fi
exit 0
