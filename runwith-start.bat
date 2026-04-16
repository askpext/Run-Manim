@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
if defined RUNWITH_VENV_DIR (
  set "VENV_DIR=%RUNWITH_VENV_DIR%"
) else (
  set "VENV_DIR=%PROJECT_ROOT%env"
)
set "VENV_ACTIVATE=%VENV_DIR%\Scripts\activate"

cd /d "%PROJECT_ROOT%"

if /I "%~1"=="heartbeat" goto run_heartbeat
if /I "%~1"=="qcluster" goto run_qcluster
if /I "%~1"=="server" goto run_server
if not "%~1"=="" goto usage

echo Starting heartbeat...
start "RunWith heartbeat" cmd /k ""%~f0" heartbeat"

timeout /t 2 > nul

echo Starting qcluster...
start "RunWith qcluster" cmd /k ""%~f0" qcluster"

timeout /t 2 > nul

echo Starting Django server...
start "RunWith Django server" cmd /k ""%~f0" server"

echo Done. Open http://127.0.0.1:8000
pause
exit /b 0

:prepare_django
if not exist "%VENV_ACTIVATE%" (
  echo Virtual environment not found: "%VENV_ACTIVATE%"
  exit /b 1
)

echo Activating virtual environment...
call "%VENV_ACTIVATE%"

echo Setting environment variables...
set "DJANGO_SECRET_KEY=devsecret123"
set "DJANGO_ENV=dev"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
exit /b 0

:run_heartbeat
call :prepare_django
if errorlevel 1 exit /b %ERRORLEVEL%
echo Starting heartbeat...
python manage.py create_heartbeat
exit /b %ERRORLEVEL%

:run_qcluster
call :prepare_django
if errorlevel 1 exit /b %ERRORLEVEL%
echo Starting qcluster...
python manage.py qcluster
exit /b %ERRORLEVEL%

:run_server
call :prepare_django
if errorlevel 1 exit /b %ERRORLEVEL%
echo Starting Django server...
python manage.py runserver 127.0.0.1:8000
exit /b %ERRORLEVEL%

:usage
echo Usage: %~nx0 [heartbeat^|qcluster^|server]
exit /b 1
