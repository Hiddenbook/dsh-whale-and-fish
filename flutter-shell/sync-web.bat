@echo off
chcp 65001 >nul
cd /d "%~dp0"

set SRC=..\web

if not exist "%SRC%\index.html" (
  echo [x] %SRC%\index.html not found.
  pause
  exit /b 1
)

if not exist "assets\web" mkdir "assets\web"
if not exist "assets\web\assets" mkdir "assets\web\assets"

copy /Y "%SRC%\index.html" "assets\web\index.html" >nul
copy /Y "%SRC%\style.css"  "assets\web\style.css"  >nul
copy /Y "%SRC%\app.js"     "assets\web\app.js"     >nul
xcopy "%SRC%\assets\*" "assets\web\assets\" /E /I /Y >nul

echo.
echo   [ok] web assets copied into assets\web
echo   next: flutter build apk --release --split-per-abi
echo.
pause
