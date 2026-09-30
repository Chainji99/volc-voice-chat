@echo off
title VOLC Voice Chat Launcher
chcp 65001 > NUL
echo ====================================================
echo 🚀 VOLC Voice Chat - กำลังเริ่มต้นระบบ...
echo ====================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ไม่พบ Node.js ในเครื่องของคุณ!
    echo กรุณาดาวน์โหลดและติดตั้ง Node.js จาก https://nodejs.org/
    pause
    exit
)

:: Install dependencies if node_modules missing
if not exist "node_modules\" (
    echo 📦 กำลังติดตั้ง Dependencies ที่จำเป็น...
    npm install
)

echo.
echo 🌐 กำลังเปิดหน้าเว็บในบราวเซอร์...
start http://localhost:3000

echo ⚡ กำลังเปิดใช้งาน Voice Server...
node server.js

pause
