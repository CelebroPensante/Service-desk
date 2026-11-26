@echo off
REM ==============================================================================
REM ServiceDesk Server Control & Terminal Launcher
REM ==============================================================================
setlocal EnableDelayedExpansion

if "%~1"=="" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0servicedesk-ctl.ps1" console
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0servicedesk-ctl.ps1" %*
)
