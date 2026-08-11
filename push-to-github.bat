@echo off
title Pushing to GitHub
color 0A
echo ======================================================
echo   Pushing WhatsFlow to GitHub
echo ======================================================
echo.

set GIT="C:\Program Files\Git\bin\git.exe"

cd /d "%~dp0"

%GIT% config user.email "rafiq@whatsflow.app"
%GIT% config user.name "Rafiq Jalalia"

rem Remove old remote if it exists, then add the new one
%GIT% remote remove origin 2>nul
%GIT% remote add origin https://github.com/Rafiqjalalia/salesbot.git

echo [1/4] Staging all files (excluding node_modules, secrets, cache)...
%GIT% add .

echo [2/4] Creating commit...
%GIT% commit -m "feat: full WhatsFlow project with RemoteAuth cloud support"

echo [3/4] Setting branch to main...
%GIT% branch -M main

echo [4/4] Pushing to GitHub...
echo.
echo NOTE: A browser window or login prompt may appear. Sign in with your GitHub account.
echo.
%GIT% push -u origin main

if %errorlevel% EQU 0 (
  echo.
  echo ======================================================
  echo   SUCCESS! Code pushed to GitHub!
  echo   Now go back to Render and click "Manual Deploy"
  echo ======================================================
) else (
  echo.
  echo ======================================================
  echo   ERROR! Push failed. See message above.
  echo   Make sure you are logged in to GitHub.
  echo ======================================================
)

pause
