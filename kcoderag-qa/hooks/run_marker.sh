#!/bin/sh
# Record a matching KCodeRag MCP call and always fail open without stdout.

case $0 in
    */*) marker_script=${0%/*}/mcp-call-marker.cjs ;;
    *\\*) marker_script=${0%\\*}\\mcp-call-marker.cjs ;;
    *) marker_script=./mcp-call-marker.cjs ;;
esac

command -v node >/dev/null 2>&1 || exit 0
node "$marker_script" "$1" >/dev/null 2>&1 || :
exit 0
