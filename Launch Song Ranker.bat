@echo off
title Song Ranker server
cd /d "%~dp0"
echo Starting Song Ranker at http://127.0.0.1:5500 ...
start "" "http://127.0.0.1:5500"
npx -y http-server -a 127.0.0.1 -p 5500 -c-1 .
pause
