#!/bin/sh
command -v node >/dev/null 2>&1 || exit 0
HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
node "$HOOK_DIR/dashboard-open.cjs" "$1" 2>/dev/null
exit 0
