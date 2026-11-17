@echo off
title OK SUR - Cuando Llega Transpuntano (PWA Android)
cd /d "%~dp0"
echo Iniciando servidor OK SUR en tiempo real...
start "" "http://localhost:3000"
node scripts/local-server.js
pause
