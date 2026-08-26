@echo off
setlocal EnableExtensions DisableDelayedExpansion
node "%~dp0mcp-call-marker.cjs" "%~1" >nul 2>nul
exit /b 0
