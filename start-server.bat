@echo off
setlocal
set PORT=8080
REM Time of day (HH:MM) for the automatic Clockify refresh. off = never.
if not defined REFRESH_AT set REFRESH_AT=00:00
cd /d "%~dp0"

echo Starting the overtime dashboard server on port %PORT% ...

REM Launch the server in its own titled window so the logs stay visible.
REM It regenerates www\index.html on startup and then daily at %REFRESH_AT%.
start "Overtime-Server" cmd /k "node "%~dp0server\serve.cjs""

REM Give it a moment to bind, then open the dashboard.
timeout /t 1 /nobreak >nul
start "" "http://localhost:%PORT%/"

echo.
echo Server window opened (titled "Overtime-Server").
echo Open:    http://localhost:%PORT%/
echo Refresh: automatic daily at %REFRESH_AT%, or click "Refresh" on the page
echo Stop:    run stop-server.bat  (or just close the server window)
echo.
