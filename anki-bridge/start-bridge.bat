@echo off
title Kevin-OS Anki Sync Bridge
cd /d "%~dp0"
echo Starting Kevin-OS Anki Background Sync Bridge...
node sync.mjs
pause
