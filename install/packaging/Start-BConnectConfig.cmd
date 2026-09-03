@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  bConnect-MCP -- launcher shim for the Start-menu entries and for the
rem  "configure now" checkbox on the setup program's last page.
rem
rem  It exists for exactly one reason, and it is worth stating because a shim
rem  with no reason becomes a second installer:
rem
rem    The Node.js MSI adds its directory to the MACHINE PATH. A process that
rem    the setup program launches inherits the setup program's environment,
rem    which was captured before the MSI ran, so `node` is not resolvable in it
rem    -- and Install-BConnectMcp.ps1 aborts when Get-Command node fails. That
rem    reads as "the installation is broken" one second after a successful
rem    install. This script repairs PATH for the process it starts, and does
rem    nothing else.
rem
rem  It contains no installation logic. Every mode below resolves to one of the
rem  three existing front ends, unmodified.
rem
rem  Usage:  Start-BConnectConfig.cmd [setup|manage|cli]
rem            setup   the guided installer  (Install-BConnectMcp-UI.ps1)
rem            manage  the configuration GUI (Manage-BConnectMcp.ps1)
rem            cli     the verb command line (bconnect.ps1), console stays open
rem ===========================================================================

set "MODE=%~1"
if "%MODE%"=="" set "MODE=manage"

rem --- locate install\ -------------------------------------------------------
rem  This file is installed twice: at install\ (where the Start-menu shortcuts
rem  point) and inside install\packaging\ (because it is part of the offline
rem  bundle). Accept either, so that running the wrong copy still works.
set "INSTALLDIR=%~dp0"
if not exist "%INSTALLDIR%Install-BConnectMcp.ps1" (
    for %%I in ("%INSTALLDIR%..") do set "INSTALLDIR=%%~fI\"
)
if not exist "%INSTALLDIR%Install-BConnectMcp.ps1" (
    echo bConnect-MCP: Install-BConnectMcp.ps1 was not found near "%~dp0".
    echo The installation is incomplete. Reinstall bConnect-MCP.
    pause
    exit /b 1
)

rem --- make node resolvable --------------------------------------------------
rem  Only when it is not already. An existing Node that the administrator put
rem  somewhere of their own choosing keeps precedence; nothing here reorders a
rem  PATH that already answers.
where node >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>&1
if errorlevel 1 (
    echo bConnect-MCP: Node.js is not available on this computer.
    echo The suite requires Node.js 20.0.0 or newer. Install it from the MSI
    echo supplied with this product, or from https://nodejs.org, and try again.
    pause
    exit /b 1
)

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if /i "%MODE%"=="setup" (
    rem  -Sta: WPF will not start on an MTA thread.
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Sta -File "%INSTALLDIR%Install-BConnectMcp-UI.ps1"
    exit /b %ERRORLEVEL%
)

if /i "%MODE%"=="manage" (
    if not exist "%INSTALLDIR%Manage-BConnectMcp.ps1" (
        echo bConnect-MCP: Manage-BConnectMcp.ps1 was not found in "%INSTALLDIR%".
        echo The configuration window is not available in this installation.
        echo Use the bConnect-MCP Setup entry, or the command line: bconnect status.
        pause
        exit /b 1
    )
    "%PS%" -NoProfile -ExecutionPolicy Bypass -Sta -File "%INSTALLDIR%Manage-BConnectMcp.ps1"
    exit /b %ERRORLEVEL%
)

if /i "%MODE%"=="cli" (
    rem  -NoExit leaves the console open after bconnect.ps1 has printed its
    rem  usage, which is the only place an administrator sees the verb list.
    "%PS%" -NoProfile -ExecutionPolicy Bypass -NoExit -Command "Set-Location -LiteralPath '%INSTALLDIR%'; .\bconnect.ps1"
    exit /b %ERRORLEVEL%
)

echo bConnect-MCP: unknown mode "%MODE%".
echo Usage: Start-BConnectConfig.cmd [setup^|manage^|cli]
exit /b 2
