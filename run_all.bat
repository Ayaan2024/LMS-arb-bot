@echo off
REM Start both the dashboard and the Binance price proxy
echo Starting ArbBot dashboard and proxy server...
echo.
start "ArbBot Dashboard" cmd /c "cd /d %~dp0 && ""C:\Program Files\nodejs\npm.cmd"" run dev -- --host --port 5176 --strictPort"
start "ArbBot Proxy" cmd /c "cd /d %~dp0server && ""C:\Program Files\nodejs\npm.cmd"" run dev"