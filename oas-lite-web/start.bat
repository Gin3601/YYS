@echo off
setlocal EnableExtensions

REM ============================================================
REM  OAS Lite Web - one-click launcher
REM
REM  What this does:
REM    1. Check python / npm are in PATH
REM    2. If node_modules is missing, run npm install
REM    3. Open a new window running python server.py (in OAS root)
REM    4. Open a new window running npm run dev (in oas-lite-web)
REM       Vite will auto-open the browser.
REM
REM  Close either window to stop that service.
REM ============================================================

cd /d "%~dp0"
set "FRONTEND_DIR=%CD%"

pushd ..
set "OAS_ROOT=%CD%"
popd

echo === OAS Lite Web one-click launcher ===
echo   frontend: %FRONTEND_DIR%
echo   backend : %OAS_ROOT%
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found in PATH.
  echo Please install Python 3.10+ and add it to PATH.
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

if not exist "node_modules" (
  echo [INFO] First run - installing frontend deps via npm install...
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
python -c "import zerorpc, fastapi, uvicorn" >nul 2>nul
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
python -m pip install -r requirements.txt
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
echo        pip install -r requirements.txt
echo.
pause
exit /b 1

:deps_ok

echo [INFO] Starting OAS backend window...
start "OAS Backend" /D "%OAS_ROOT%" cmd /k python server.py

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
