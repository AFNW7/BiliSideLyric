@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本。扩展本身无需 Node.js，可直接在 Edge 中加载。
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node tools/serve.mjs
pause
