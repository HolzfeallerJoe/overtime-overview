@echo off
setlocal
set PORT=8080
REM Minutes between automatic Clockify refreshes while a page is open. 0 = off.
if not defined REFRESH_MINUTES set REFRESH_MINUTES=5
cd /d "%~dp0"

echo Starting the overtime dashboard server on port %PORT% ...

REM Launch the server in its own titled window so the logs stay visible.
REM It regenerates www\index.html on startup and then every %REFRESH_MINUTES% minutes.
start "Overtime-Server" cmd /k "node "%~dp0server\serve.cjs""

REM Give it a moment to bind, then open the dashboard.
timeout /t 1 /nobreak >nul
start "" "http://localhost:%PORT%/"

echo.
echo Server window opened (titled "Overtime-Server").
echo Open:    http://localhost:%PORT%/
echo Refresh: automatic every %REFRESH_MINUTES% min, or click "Updated" on the page
echo Stop:    run stop-server.bat  (or just close the server window)
echo.
