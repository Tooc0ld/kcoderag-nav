@echo off
setlocal EnableExtensions DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 exit /b 0
node "%~dp0dashboard-open.cjs" "%~1" 2>nul
exit /b 0
