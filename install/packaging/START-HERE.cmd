@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ===========================================================================
rem  bConnect-MCP -- offline bundle launcher
rem
rem  New-OfflineBundle.ps1 copies this to the ROOT of the bundle, beside
rem  bConnect-MCP-main\, install\ and offline-bundle.json. It is what an
rem  administrator double-clicks.
rem
rem  It contains no installation logic. It clears three conditions that stop the
rem  installer before it can report anything useful, then starts the existing
rem  front end. Each of the three was measured, not guessed:
rem
rem    1. MAX_PATH. The deepest file in the bundle is 147 characters below its
rem       own root, so an extraction directory longer than about 110 characters
rem       exceeds the 260-character limit. LongPathsEnabled is 0 by default. The
rem       failure is a partial extraction or a server that will not start, and
rem       both read as a corrupt download.
rem
rem    2. Mark of the Web. A package that arrives by download or e-mail is marked,
rem       and extraction copies that mark to every file. Under the RemoteSigned
rem       policy that is common on servers, an unsigned .ps1 carrying the mark is
rem       refused. The unblock below runs through -Command, which execution policy
rem       does not govern, so it works even when running a .ps1 would not.
rem
rem    3. No graphical shell. Windows Server Core has PowerShell 5.1 and no GUI,
rem       so the WPF wizard cannot start there. The console installer is the same
rem       engine and is used instead.
rem
rem  Node.js is NOT checked here. The installer provisions it, and a second
rem  implementation of that decision would be one more thing to keep in step.
rem ===========================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "INSTALLDIR=%ROOT%\install"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo.
echo   bConnect-MCP -- guided installation
echo   ==================================
echo.

rem --- the payload is present ------------------------------------------------
if not exist "%INSTALLDIR%\Install-BConnectMcp.ps1" (
    echo   The installer was not found at "%INSTALLDIR%".
    echo.
    echo   Extract the whole package to one directory and run START-HERE.cmd from
    echo   that directory. Three items must stay together: bConnect-MCP-main,
    echo   install, and offline-bundle.json.
    echo.
    pause
    exit /b 1
)

if not exist "%PS%" (
    echo   Windows PowerShell 5.1 was not found at the expected location:
    echo     %PS%
    echo   This installer requires it. PowerShell 7 alone is not sufficient.
    echo.
    pause
    exit /b 1
)

rem --- 1: MAX_PATH headroom --------------------------------------------------
rem  147 is the deepest path in the bundle relative to its own root, measured.
rem  A margin of 10 leaves room for the temporary files the build writes.
call :strlen ROOT ROOTLEN
set /a "NEEDED=%ROOTLEN%+147+10"
if %NEEDED% GTR 260 (
    set /a "OVER=%NEEDED%-260"
    echo   This directory is too deeply nested for the files in this package.
    echo.
    echo     Directory        %ROOT%
    echo     Length           %ROOTLEN% characters
    echo     Longest file     147 characters below it
    echo     Windows limit    260 characters, exceeded by !OVER!
    echo.
    echo   Extract the package closer to the root of a drive, for example
    echo   C:\bConnect-MCP, and run START-HERE.cmd from there.
    echo.
    pause
    exit /b 1
)

rem --- 2: Mark of the Web ----------------------------------------------------
rem  Only the scripts need it: the .js files under node_modules are read by
rem  node.exe, which execution policy does not govern. Unblocking 22,000 files
rem  would take minutes and change nothing.
rem  EVERY PowerShell invocation below is ONE line. Caret continuation does not
rem  survive inside a for /f backtick block: cmd truncated the command at the
rem  first fragment, %%P was never assigned, and an empty GPOPOL then failed the
rem  "not none" test -- so the launcher reported a Group Policy restriction on
rem  every machine, including ones with no policy at all. Long lines here are
rem  deliberate; readability is not worth a launcher that cannot start.
echo   Preparing files.
"%PS%" -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; Get-ChildItem -LiteralPath '%ROOT%' -Recurse -File -Include *.ps1,*.psm1,*.psd1,*.cmd,*.bat,*.exe,*.dll,*.msi | Unblock-File" >nul 2>&1

rem  An execution policy set by Group Policy outranks -ExecutionPolicy Bypass on
rem  the command line, so the unblock above does not rescue it. Report it here
rem  rather than letting the wizard fail with a policy error.
rem  Output goes through a temporary file rather than `for /f ... in (backticks)`.
rem  A for/f backtick block re-parses its command, and a QUOTED executable path
rem  inside one is a known cmd trap: it split at the first quote and reported
rem  powershell.exe as an unrecognised command. Two attempts to quote around it
rem  failed, so the cleverness is gone instead.
set "GPOPOL="
set "PROBE=%TEMP%\bconnect-gpo-%RANDOM%.txt"
"%PS%" -NoProfile -Command "$m=Get-ExecutionPolicy -Scope MachinePolicy; $u=Get-ExecutionPolicy -Scope UserPolicy; if ($m -ne 'Undefined') { $m } elseif ($u -ne 'Undefined') { $u } else { 'none' }" > "%PROBE%" 2>nul
if exist "%PROBE%" set /p GPOPOL=<"%PROBE%"
del "%PROBE%" >nul 2>&1
rem  An unset GPOPOL means the probe itself failed, which is NOT evidence of a
rem  restriction. Treat it as unknown and carry on: the installer reports a real
rem  policy error far better than a launcher guessing at one.
if not defined GPOPOL set "GPOPOL=none"
if not "%GPOPOL%"=="none" if not "%GPOPOL%"=="Bypass" if not "%GPOPOL%"=="Unrestricted" (
    echo.
    echo   PowerShell script execution is restricted by Group Policy.
    echo.
    echo     Effective policy   %GPOPOL%
    echo.
    echo   A policy set by Group Policy takes precedence over the setting this
    echo   launcher would otherwise use, so the installer cannot start. Ask the
    echo   administrator responsible for that policy to permit these scripts, or
    echo   to run the installation on a computer where it does not apply.
    echo.
    pause
    exit /b 1
)

rem --- 3: graphical shell ----------------------------------------------------
rem  Server Core reports its installed roles under ServerLevels. Server-Gui-Shell
rem  absent with ServerCore present is Core. The WPF probe covers everything the
rem  registry does not answer, including a Core installation that has had the
rem  App Compatibility feature added.
set "GUISHELL="
set "PROBE=%TEMP%\bconnect-gui-%RANDOM%.txt"
"%PS%" -NoProfile -Command "try { Add-Type -AssemblyName PresentationFramework -EA Stop; 'gui' } catch { 'nogui' }" > "%PROBE%" 2>nul
if exist "%PROBE%" set /p GUISHELL=<"%PROBE%"
del "%PROBE%" >nul 2>&1
rem  If the probe could not answer, prefer the console installer. It performs the
rem  same installation and works everywhere, so an unknown answer costs nothing;
rem  guessing "gui" on a machine without one costs a type-load failure.
if not defined GUISHELL set "GUISHELL=nogui"

if "%GUISHELL%"=="gui" (
    set "FRONTEND=Install-BConnectMcp-UI.ps1"
    set "ARGS=-Sta"
    echo   Starting the installation wizard.
) else (
    set "FRONTEND=Install-BConnectMcp.ps1"
    set "ARGS="
    echo   No graphical shell is available on this computer.
    echo   Starting the console installer, which performs the same installation.
)
echo   This window stays open and shows the installer's output.
echo.

"%PS%" -NoProfile -ExecutionPolicy Bypass %ARGS% -File "%INSTALLDIR%\%FRONTEND%" -SkipBuild
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo   The installer closed without reporting an error.
) else (
    echo   The installer exited with code %RC%. The output above states what stopped it.
)
echo.
echo   To change settings afterwards:   install\Manage-BConnectMcp.ps1
echo   To remove what was installed:    install\bconnect.ps1 uninstall
echo.
pause
exit /b %RC%

rem --- helper: length of the value of a variable ------------------------------
:strlen
setlocal EnableDelayedExpansion
set "s=!%~1!#"
set "len=0"
for %%A in (4096 2048 1024 512 256 128 64 32 16 8 4 2 1) do (
    if "!s:~%%A!" NEQ "" (
        set /a "len+=%%A"
        set "s=!s:~%%A!"
    )
)
endlocal & set "%~2=%len%"
goto :eof
