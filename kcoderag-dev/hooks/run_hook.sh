#!/bin/sh
# Select a supported interpreter without ever blocking the host tool.

case $0 in
    */*) hook_script=${0%/*}/grep_nudge.py ;;
    *\\*) hook_script=${0%\\*}\\grep_nudge.py ;;
    *) hook_script=./grep_nudge.py ;;
esac

for candidate in python3 python; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
        >/dev/null 2>&1 || continue

    output=$("$candidate" "$hook_script" 2>/dev/null)
    status=$?
    if [ "$status" -eq 0 ]; then
        printf '%s' "$output"
    fi
    exit 0
done

exit 0
