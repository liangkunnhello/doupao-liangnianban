@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo    GPT Image Playground - Electron 版
echo ========================================
echo.

:: 检查 Node.js 是否安装
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)
echo [✓] Node.js 已安装: 
for /f "tokens=*" %%a in ('node --version') do echo   %%a

:: 检查 npm 是否可用
call npm --version >nul 2>&1
if errorlevel 1 (
    echo [错误] npm 不可用，请检查 Node.js 安装
    pause
    exit /b 1
)
echo [✓] npm 已安装

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo.
    echo [!] 检测到缺少依赖（node_modules 不存在）
    echo 正在自动安装依赖，请稍候...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
    echo [✓] 依赖安装完成
) else (
    :: 检查关键依赖是否完整（通过检查核心包是否存在）
    if not exist "node_modules\electron" (
        echo.
        echo [!] 检测到依赖不完整（缺少 electron）
        echo 正在自动安装依赖，请稍候...
        echo.
        call npm install
        if errorlevel 1 (
            echo.
            echo [错误] 依赖安装失败
            pause
            exit /b 1
        )
        echo.
        echo [✓] 依赖安装完成
    ) else (
        echo [✓] 依赖已安装
    )
)

echo.
echo 正在清理旧的构建缓存...
if exist "dist-electron" (
  rmdir /s /q "dist-electron"
  echo 已清理 dist-electron 目录
)
echo.

echo 正在启动 Electron 开发服务器...
echo.
call npm run electron:dev
echo.
pause
