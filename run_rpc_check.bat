@echo off
setlocal

if not exist requirements.txt (
  echo requirements.txt not found in current directory.
  exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Failed to install dependencies.
    exit /b 1
  )

  py -3 bsc_rpc_check.py
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Failed to install dependencies.
    exit /b 1
  )

  python bsc_rpc_check.py
  exit /b %errorlevel%
)

echo Neither py nor python was found on PATH.
exit /b 1
