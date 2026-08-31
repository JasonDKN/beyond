@echo off
rem ---------------------------------------------------------------------------
rem  Beyond, in one double-click.
rem
rem  Starts the dev server inside WSL if it is not already up, waits for it to
rem  answer, and opens the project in VS Code. Clicking it a second time
rem  while it is already running just reopens the window — which matters,
rem  because the dev server is pinned to port 5173 and refuses to start twice
rem  rather than quietly moving to another port and losing every song saved
rem  against the first one.
rem ---------------------------------------------------------------------------
setlocal
title Beyond

set "URL=http://localhost:5173/"

rem --- Already running? Then there is nothing to start. -----------------------
curl.exe -s -o nul --max-time 2 "%URL%"
if not errorlevel 1 goto open

rem --- Where this script lives, in the terms WSL understands. -----------------
set "DEVSH="
for /f "usebackq delims=" %%p in (`wsl.exe wslpath -a "%~dp0dev.sh" 2^>nul`) do set "DEVSH=%%p"
if not defined DEVSH goto nowsl

echo Starting Beyond...
start "Beyond dev server" /min wsl.exe -e bash "%DEVSH%"

rem --- Wait for it to answer. A first run installs packages, so be patient. ---
set /a tries=0
:wait
set /a tries+=1
timeout /t 1 /nobreak >nul
curl.exe -s -o nul --max-time 2 "%URL%"
if not errorlevel 1 goto open
if %tries% lss 120 goto wait

echo.
echo Beyond did not answer on port 5173 after two minutes.
echo Open the minimised "Beyond dev server" window to see what it said.
pause
exit /b 1

:nowsl
echo Could not reach WSL, so there is nowhere to start Beyond.
echo Open a terminal and check that "wsl" runs.
pause
exit /b 1

:open
rem VS Code shows the app in its own Simple Browser tab, and VS Code restores
rem that tab with the window — so once you have opened it the first time it
rem comes back on its own. Ctrl+Alt+B opens it if it is not there.
code "%~dp0.."
exit /b 0
