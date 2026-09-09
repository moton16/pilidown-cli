@echo off
setlocal
REM pilidown Windows wrapper �� probes Node.js before launching the bundled CLI.

REM 1. Probe Node.js from PATH (covers official install, nvm-windows, volta, fnm)
where node >nul 2>nul
if %errorlevel%==0 (
    node "%~dp0cli.cjs" %*
    exit /b %errorlevel%
)

REM 2. Probe common install locations (fallback)
if exist "C:\Program Files\nodejs\node.exe" (
    "C:\Program Files\nodejs\node.exe" "%~dp0cli.cjs" %*
    exit /b %errorlevel%
)

if exist "%LOCALAPPDATA%\fnm_multishells" (
    for /d %%D in ("%LOCALAPPDATA%\fnm_multishells\*") do (
        if exist "%%D\node.exe" (
            "%%D\node.exe" "%~dp0cli.cjs" %*
            exit /b %errorlevel%
        )
    )
)

if exist "%LOCALAPPDATA%\nvs\default\node.exe" (
    "%LOCALAPPDATA%\nvs\default\node.exe" "%~dp0cli.cjs" %*
    exit /b %errorlevel%
)

echo [pilidown] Node.js not found.
echo [pilidown] Please install Node.js 18+ from https://nodejs.org/
echo [pilidown] After installing, restart your terminal or IDE and try again.
exit /b 1
