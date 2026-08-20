@echo off
setlocal EnableExtensions DisableDelayedExpansion

call :try_python py -3
if defined KCODERAG_RUNTIME_SELECTED exit /b 0
call :try_python python3
if defined KCODERAG_RUNTIME_SELECTED exit /b 0
call :try_python python
exit /b 0

:try_python
set "KCODERAG_RUNTIME=%~1"
set "KCODERAG_RUNTIME_ARG=%~2"
if defined KCODERAG_RUNTIME_ARG (
    call %KCODERAG_RUNTIME% %KCODERAG_RUNTIME_ARG% -c "import sys;raise SystemExit(0 if sys.version_info ^>= (3,10) else 1)" >nul 2>nul
) else (
    call %KCODERAG_RUNTIME% -c "import sys;raise SystemExit(0 if sys.version_info ^>= (3,10) else 1)" >nul 2>nul
)
if errorlevel 1 exit /b 0

set "KCODERAG_RUNTIME_SELECTED=1"
if not defined TEMP set "TEMP=%CD%"
set "KCODERAG_HOOK_OUTPUT=%TEMP%\kcoderag-nav-hook-%RANDOM%-%RANDOM%.tmp"
if defined KCODERAG_RUNTIME_ARG (
    call %KCODERAG_RUNTIME% %KCODERAG_RUNTIME_ARG% "%~dp0grep_nudge.py" >"%KCODERAG_HOOK_OUTPUT%" 2>nul
) else (
    call %KCODERAG_RUNTIME% "%~dp0grep_nudge.py" >"%KCODERAG_HOOK_OUTPUT%" 2>nul
)
if not errorlevel 1 type "%KCODERAG_HOOK_OUTPUT%" 2>nul
del /q "%KCODERAG_HOOK_OUTPUT%" >nul 2>nul
exit /b 0
