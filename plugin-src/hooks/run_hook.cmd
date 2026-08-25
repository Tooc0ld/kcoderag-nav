@echo off
setlocal EnableExtensions DisableDelayedExpansion

if defined TEMP (
    set "KCODERAG_HOOK_BASE=%TEMP%"
) else if defined TMP (
    set "KCODERAG_HOOK_BASE=%TMP%"
) else (
    set "KCODERAG_HOOK_BASE=%~dp0"
)

set "KCODERAG_HOOK_ATTEMPTS=0"
:allocate_output
set /a KCODERAG_HOOK_ATTEMPTS+=1 >nul 2>nul
if %KCODERAG_HOOK_ATTEMPTS% GTR 16 exit /b 0
set "KCODERAG_HOOK_DIR=%KCODERAG_HOOK_BASE%\kcoderag-nav-hook-%RANDOM%-%RANDOM%"
2>nul md "%KCODERAG_HOOK_DIR%"
if errorlevel 1 goto allocate_output
set "KCODERAG_HOOK_OUTPUT=%KCODERAG_HOOK_DIR%\stdout.tmp"

node -e "const major=Number(process.versions.node.split('.')[0]);if(Number.isInteger(major) && major >= 22){process.exitCode=require(process.argv[1]).main()}" "%~dp0grep-nudge.cjs" 2>nul >"%KCODERAG_HOOK_OUTPUT%"
if not errorlevel 1 type "%KCODERAG_HOOK_OUTPUT%" 2>nul
del /q "%KCODERAG_HOOK_OUTPUT%" >nul 2>nul
rd "%KCODERAG_HOOK_DIR%" >nul 2>nul
exit /b 0
