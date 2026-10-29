@echo off
chcp 65001 > nul
title Stop Tailor PWA Server
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3333 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>nul
)
echo Server stopped.
