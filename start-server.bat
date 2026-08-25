@echo off
setlocal
set PORT=8080
cd /d "%~dp0"

echo Starting the overtime dashboard server on port %PORT% ...

if not exist "%~dp0www\index.html" (
    echo.
    echo   www\index.html does not exist yet.
    echo   Generating it now ...
    echo.
    call npm run dashboard
    if errorlevel 1 (
        echo.
        echo   Could not generate the dashboard. Check your .env and try:
        echo       npm run dashboard
        echo.
        pause
        exit /b 1
    )
)

REM Launch the server in its own titled window so the logs stay visible.
start "Overtime-Server" cmd /k "node "%~dp0server\serve.cjs""

REM Give it a moment to bind, then open the dashboard.
timeout /t 1 /nobreak >nul
start "" "http://localhost:%PORT%/"

echo.
echo Server window opened (titled "Overtime-Server").
echo Open:    http://localhost:%PORT%/
echo Refresh: npm run dashboard, then reload the page
echo Stop:    run stop-server.bat  (or just close the server window)
echo.
