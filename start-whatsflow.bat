@echo off
title WhatsFlow AI Sales Bot
color 0A
echo ======================================================
echo   WhatsFlow AI Sales Bot
echo   Keep this window OPEN while you use the app.
echo   Close this window to STOP the bot.
echo   Dashboard:  http://localhost:3000
echo ======================================================
echo.
cd /d "%~dp0"
:loop
node backend\src\index.js
if %errorlevel% EQU 0 goto :eof
echo.
echo *** The server stopped unexpectedly. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
