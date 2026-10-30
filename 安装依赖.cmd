@echo off
cd /d "%~dp0"
call npm ci --no-audit --no-fund
if errorlevel 1 goto done
call npm run setup
if errorlevel 1 goto done
call npm run doctor
:done
pause
