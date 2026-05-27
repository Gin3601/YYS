@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM  OAS Lite Web - one-click launcher
REM
REM  What this does:
REM    1. Check python / npm are in PATH
REM    2. If frontend deps are missing/incomplete, run npm install
REM    3. Open a new window running python server.py (in OAS root)
REM    4. Open a new window running npm run dev (in oas-lite-web)
REM       Vite will auto-open the browser.
REM
REM  Close either window to stop that service.
REM ============================================================

cd /d "%~dp0"
set "FRONTEND_DIR=%CD%"
set "npm_config_cache=%FRONTEND_DIR%\.npm-cache"
set "OAS_WEB_HOST=127.0.0.1"
set "OAS_WEB_PORT=22267"
set "VITE_OAS_BASE_URL=http://%OAS_WEB_HOST%:%OAS_WEB_PORT%"

pushd ..
set "OAS_ROOT=%CD%"
popd
set "LOCAL_PY_ENV=%OAS_ROOT%\.conda\oas310"
set "PYTHON_EXE=python"

echo === OAS Lite Web one-click launcher ===
echo   frontend: %FRONTEND_DIR%
echo   backend : %OAS_ROOT%
echo   api     : %VITE_OAS_BASE_URL%
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found in PATH.
  echo Please install Python 3.10 or 3.11 and add it to PATH.
  pause
  exit /b 1
)

"%PYTHON_EXE%" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 12) else 1)" >nul 2>nul
if errorlevel 1 (
  if exist "%LOCAL_PY_ENV%\python.exe" (
    set "PYTHON_EXE=%LOCAL_PY_ENV%\python.exe"
    echo [INFO] System Python is not supported; using local Python env:
    echo        !PYTHON_EXE!
    echo.
    "!PYTHON_EXE!" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 12) else 1)" >nul 2>nul
    if errorlevel 1 (
      echo [ERROR] Local Python env exists but has an unsupported version:
      "!PYTHON_EXE!" --version
      pause
      exit /b 1
    )
  ) else (
    echo [ERROR] Unsupported Python version:
    "%PYTHON_EXE%" --version
    echo.
    echo OAS dependencies are pinned for Python 3.10/3.11.
    echo Python 3.12 may fail while building packages such as zerorpc/gevent.
    echo.
    echo Recommended fix:
    echo   Create a local conda env at:
    echo   %LOCAL_PY_ENV%
    echo.
    set "_CREATE_ENV="
    set /p _CREATE_ENV=Create it now via "conda create --prefix %LOCAL_PY_ENV% python=3.10"? [y/N]:
    if /i not "!_CREATE_ENV!"=="y" (
      echo.
      echo [ABORT] Please create a Python 3.10/3.11 env before retrying.
      pause
      exit /b 1
    )
    where conda >nul 2>nul
    if errorlevel 1 (
      echo.
      echo [ERROR] conda not found in PATH.
      pause
      exit /b 1
    )
    echo.
    echo [INFO] Creating local Python 3.10 env...
    call conda create --prefix "%LOCAL_PY_ENV%" python=3.10 -y
    if errorlevel 1 (
      echo.
      echo [ERROR] Failed to create local conda env.
      pause
      exit /b 1
    )
    set "PYTHON_EXE=%LOCAL_PY_ENV%\python.exe"
  )
)

"%PYTHON_EXE%" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 12) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Unsupported Python version:
  "%PYTHON_EXE%" --version
  echo.
  echo OAS dependencies are pinned for Python 3.10/3.11.
  echo Python 3.12 may fail while building packages such as zerorpc/gevent.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  echo Please install Node.js 18+ and add it to PATH.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo [INFO] Frontend deps are missing or incomplete - running npm install...
  echo        This may take 1-3 minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed - see messages above.
    pause
    exit /b 1
  )
  echo.
  echo [INFO] Dependencies installed.
  echo.
)

if not exist "node_modules\.bin\tsc.cmd" (
  echo [INFO] TypeScript executable is missing - running npm install...
  echo        This may take 1-3 minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed - see messages above.
    pause
    exit /b 1
  )
  echo.
  echo [INFO] Dependencies installed.
  echo.
)

REM ---------- Check OAS backend Python deps ----------
echo [INFO] Checking OAS backend Python deps (zerorpc, fastapi, uvicorn)...
"%PYTHON_EXE%" -c "import zerorpc, fastapi, uvicorn" >nul 2>nul
if not errorlevel 1 goto deps_ok

echo.
echo [WARN] OAS backend Python deps are NOT installed.
echo        Required by %OAS_ROOT%\server.py
echo.
set "_INSTALL="
set /p _INSTALL=Install them now via "pip install -r requirements.txt"? [y/N]:
if /i not "%_INSTALL%"=="y" goto deps_abort

pushd "%OAS_ROOT%"
echo.
echo [INFO] Running: pip install -r requirements.txt
echo        This can take several minutes on first run.
echo.
"%PYTHON_EXE%" -m pip install -r requirements.txt
set "_PIP_RC=%ERRORLEVEL%"
popd
if not "%_PIP_RC%"=="0" (
  echo.
  echo [ERROR] pip install failed. The backend will not start.
  echo        Tip: zerorpc on Windows may need Microsoft C++ Build Tools.
  echo        See OAS README for manual install instructions.
  pause
  exit /b 1
)
echo.
echo [INFO] Backend deps installed.
echo.
goto deps_ok

:deps_abort
echo.
echo [ABORT] Backend deps missing. Run this command manually before retrying:
echo        cd /d "%OAS_ROOT%"
echo        "%PYTHON_EXE%" -m pip install -r requirements.txt
echo.
pause
exit /b 1

:deps_ok

echo [INFO] Starting OAS backend window...
start "OAS Backend" /D "%OAS_ROOT%" cmd /k ""%PYTHON_EXE%" server.py --host %OAS_WEB_HOST% --port %OAS_WEB_PORT%"

echo [INFO] Starting frontend dev server...
start "OAS Lite Web" /D "%FRONTEND_DIR%" cmd /k npm run dev

echo.
echo ============================================================
echo  Two windows have been opened:
echo    "OAS Backend"   - backend (OCR + FastAPI)
echo    "OAS Lite Web"  - frontend (Vite will open the browser)
echo.
echo  Close the corresponding window to stop a service.
echo  If browser does not open, visit: http://127.0.0.1:5173
echo.
echo  Backend takes ~10-30s to start (loads OCR model).
echo  Frontend will auto-detect and load the UI when ready.
echo ============================================================
echo.
echo  This launcher window will close in 5 seconds...
timeout /t 5 >nul
endlocal
exit /b 0
