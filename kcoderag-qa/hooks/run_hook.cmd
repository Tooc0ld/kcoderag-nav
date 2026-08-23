@echo off
setlocal EnableExtensions DisableDelayedExpansion

if defined TEMP (
    set "KCODERAG_HOOK_OUTPUT=%TEMP%\kcoderag-nav-hook-%RANDOM%-%RANDOM%.tmp"
) else if defined TMP (
    set "KCODERAG_HOOK_OUTPUT=%TMP%\kcoderag-nav-hook-%RANDOM%-%RANDOM%.tmp"
) else (
    set "KCODERAG_HOOK_OUTPUT=%~dp0.kcoderag-nav-hook-%RANDOM%-%RANDOM%.tmp"
)

node -e "const major=Number(process.versions.node.split('.')[0]);if(Number.isInteger(major) && major >= 22){process.exitCode=require(process.argv[1]).main()}" "%~dp0grep-nudge.cjs" >"%KCODERAG_HOOK_OUTPUT%" 2>nul
if not errorlevel 1 type "%KCODERAG_HOOK_OUTPUT%" 2>nul
del /q "%KCODERAG_HOOK_OUTPUT%" >nul 2>nul
exit /b 0
