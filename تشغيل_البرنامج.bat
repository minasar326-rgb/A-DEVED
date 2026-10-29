@echo off
chcp 65001 > nul
title نظام إدارة محل الخياطة - السيرفر المحلي
color 0A

echo ============================================================
echo        🧵 جاري تشغيل نظام إدارة محل الخياطة...
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [خطأ] Node.js غير مثبت على هذا الجهاز!
    echo يرجى تحميل وتثبيت Node.js من: https://nodejs.org
    echo.
    pause
    exit /b
)

echo [1/2] جاري تشغيل السيرفر المحلي الآمن...
start /b "" cmd /c "timeout /t 2 >nul & start http://localhost:3333"

node server.js

echo.
echo تم إيقاف السيرفر.
pause
