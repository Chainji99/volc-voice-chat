@echo off
title VOLC Voice Chat - Internet Share
chcp 65001 > NUL
echo ====================================================
echo 🌍 VOLC Voice Chat - สร้างลิงก์ส่งให้เพื่อนบนอินเทอร์เน็ต
echo ====================================================
echo.
echo 📌 หมายเหตุ: ไมโครโฟนจำเป็นต้องใช้งานผ่าน HTTPS เมื่อส่งให้เพื่อนภายนอกบ้าน
echo 🚀 กำลังสร้างลิงก์ HTTPS สาธารณะด้วย Localtunnel...
echo.

npx localtunnel --port 3000

pause
