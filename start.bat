@echo off
title Sawmill ERP
cd /d "%~dp0"

if not exist node_modules (
  echo Installing required files - this only happens once, please wait...
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong installing dependencies.
    echo Make sure Node.js is installed: https://nodejs.org
    pause
    exit /b 1
  )
)

start "" http://localhost:4173
node server.js

pause
