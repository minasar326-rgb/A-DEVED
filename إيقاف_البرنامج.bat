@echo off
chcp 65001 > nul
title إيقاف سيرفر محل الخياطة
color 0C

echo ============================================================
echo        جاري إيقاف سيرفر محل الخياطة على المنفذ 3333...
echo ============================================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3333 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo.
echo ✅ تم إيقاف السيرفر بنجاح.
timeout /t 2 >nul
