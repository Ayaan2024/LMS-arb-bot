@echo off
REM Install Flask and dependencies if needed
echo Installing/updating Flask, CORS, and Web3...
set PYTHON_EXE=%~dp0.venv\Scripts\python.exe
if not exist "%PYTHON_EXE%" (
	set PYTHON_EXE=python
)

"%PYTHON_EXE%" -m pip install -q flask flask-cors web3

REM Set your QuickNode BSC endpoint before starting for live DEX prices
REM Example:
REM set QUICKNODE_URL=https://your-endpoint.quiknode.pro/xxxxxxxx/
if "%QUICKNODE_URL%"=="" (
	echo WARNING: QUICKNODE_URL is not set. /prices will return connection errors until this is configured.
)

REM Stop any stale server process on port 5000 so new code is always loaded
for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr :5000') do (
	echo Stopping existing process on port 5000 (PID %%p)...
	taskkill /F /PID %%p >nul 2>&1
)

REM Start the API server
echo.
echo Starting ArbBot API Server on port 5000...
echo.
"%PYTHON_EXE%" bot_api.py
