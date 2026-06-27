@echo off
REM Start the Vite dashboard on port 5176
echo Starting ArbBot dashboard on port 5176...
echo.
cd /d %~dp0

set NPM_CMD=
where npm.cmd >nul 2>nul
if %errorlevel%==0 (
	set NPM_CMD=npm.cmd
) else (
	if exist "C:\Program Files\nodejs\npm.cmd" (
		set NPM_CMD="C:\Program Files\nodejs\npm.cmd"
	)
)

if "%NPM_CMD%"=="" (
	echo npm.cmd was not found. Please install Node.js or add npm to PATH.
	exit /b 1
)

start "" "http://localhost:5176"
%NPM_CMD% run dev -- --host --port 5176 --strictPort