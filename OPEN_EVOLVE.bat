@echo off
setlocal
cd /d "%~dp0"

set "EVOLVE_PORT=8765"
set "EVOLVE_URL=http://127.0.0.1:%EVOLVE_PORT%/"

where py >nul 2>nul
if not errorlevel 1 goto use_py

where python >nul 2>nul
if not errorlevel 1 goto use_python

echo.
echo Evolve needs Python 3 to start its local web server.
echo Install Python from https://www.python.org/downloads/ and enable "Add Python to PATH".
echo.
pause
exit /b 1

:use_py
start "" /b powershell -NoProfile -Command "Start-Sleep -Milliseconds 700; Start-Process '%EVOLVE_URL%'"
echo Evolve is starting at %EVOLVE_URL%
echo Close this window or press Control-C to stop.
py -3 -m http.server %EVOLVE_PORT% --bind 127.0.0.1
goto done

:use_python
start "" /b powershell -NoProfile -Command "Start-Sleep -Milliseconds 700; Start-Process '%EVOLVE_URL%'"
echo Evolve is starting at %EVOLVE_URL%
echo Close this window or press Control-C to stop.
python -m http.server %EVOLVE_PORT% --bind 127.0.0.1

:done
if errorlevel 1 (
  echo.
  echo Evolve could not start. Port %EVOLVE_PORT% may already be in use.
  pause
)
endlocal
