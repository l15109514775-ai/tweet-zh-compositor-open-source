@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first.
  pause
  exit /b 1
)
if not exist "node_modules\playwright\package.json" (
  echo Run the dependency installer in this folder first.
  pause
  exit /b 1
)
echo Local PNG check runs first. Open http://127.0.0.1:4317 after the Local message.
call npm start
set "compositorExit=%errorlevel%"
pause
exit /b %compositorExit%
