@echo off
setlocal
set PORT=8080

echo Stopping the overtime dashboard server on port %PORT% ...

set FOUND=
REM Find the PID(s) listening on the port and kill them.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    set FOUND=1
    echo Killing process PID %%p
    taskkill /F /PID %%p >nul 2>&1
)

REM Also close the titled server window if it is still open.
taskkill /F /FI "WINDOWTITLE eq Overtime-Server*" >nul 2>&1

if defined FOUND (
    echo Server stopped.
) else (
    echo No server was listening on port %PORT%.
)
echo.
