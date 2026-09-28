@echo off
title bConnect-MCP setup build
rem Double-click target for building the setup .exe. All logic lives in
rem Build-BConnectMcpSetup.ps1 -- this file only starts PowerShell on it and
rem keeps the window open afterwards, the same division of labour as
rem Start-BConnectConfig.cmd. Nothing clever happens in cmd on purpose:
rem Test-BundleLauncher.ps1 documents two defects that shipped from for/f
rem caret tricks in a .cmd, and this file takes the lesson.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-BConnectMcpSetup.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
pause
exit /b %EXITCODE%
