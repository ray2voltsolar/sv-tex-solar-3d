@echo off
rem ---------------------------------------------------------------------------
rem  Sri Venkateswara Tex Process - 145.08 kWp rooftop solar 3D model
rem  Double-click this file: it starts a small local web server for the
rem  "webapp" folder and opens the 3D model in your default browser.
rem  Keep this window open while presenting; close it when you are done.
rem  Needs Python (already installed on this PC) and an internet connection
rem  the first time (three.js library + satellite imagery are loaded online).
rem ---------------------------------------------------------------------------
cd /d "%~dp0webapp"
set PORT=8765
start "" "http://127.0.0.1:%PORT%/index.html"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
) else (
  python -m http.server %PORT% --bind 127.0.0.1
)
echo.
echo The server stopped. If the browser shows "site can't be reached", another
echo program may already be using port %PORT% - the model may already be open.
pause
