@echo off
REM Start the Node proxy server for live Binance prices
echo Starting Binance price proxy on port 4000...
echo.
cd /d %~dp0server
"C:\Program Files\nodejs\npm.cmd" install
"C:\Program Files\nodejs\npm.cmd" run dev
