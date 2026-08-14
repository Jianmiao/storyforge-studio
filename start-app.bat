@echo off
rem StoryForge Studio - launch desktop app (double-click me)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "start.ps1" -Mode tauri
pause
