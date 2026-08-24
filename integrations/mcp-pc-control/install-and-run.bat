@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MCP PC Control - Inicio automatico

echo ======================================
echo   MCP PC Control - Inicio automatico
echo ======================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible en PATH.
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] PowerShell no esta disponible.
  pause
  exit /b 1
)

rem ======================================================================
rem  Cloudflare ELIMINADO de este script (2026-08-21).
rem  La publicacion externa es via Tailscale Funnel con URL estatica:
rem    https://desktop-qcbs0te.tail3cea3.ts.net/mcp
rem  El watchdog (mcp-watchdog.ps1) mantiene vivo el servidor y el Funnel.
rem ======================================================================

if not exist "config.json" (
  if not exist "config.example.json" (
    echo [ERROR] No existe config.json ni config.example.json.
    pause
    exit /b 1
  )
  copy /Y "config.example.json" "config.json" >nul
)

echo Verificando config.json...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content -LiteralPath 'config.json' -Raw | ConvertFrom-Json; if(-not $c.bearerToken -or $c.bearerToken -eq 'change-me'){exit 1}; exit 0"
if errorlevel 1 (
  echo [ERROR] bearerToken invalido en config.json.
  pause
  exit /b 1
)

echo Instalando o actualizando dependencias...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion de dependencias.
  pause
  exit /b 1
)

echo.
echo Cerrando cualquier servidor anterior en el puerto 3337...
for /f "delims=" %%p in ('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"') do taskkill /PID %%p /F >nul 2>nul
timeout /t 1 /nobreak >nul

echo Iniciando MCP actualizado en una ventana nueva...
start "MCP PC Control" /D "%~dp0" "%ComSpec%" /k npm start

echo Esperando que el puerto 3337 quede listo...
for /L %%i in (1,1,30) do (
  powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}"
  if not errorlevel 1 goto server_ready
  timeout /t 1 /nobreak >nul
)

echo [ERROR] El servidor MCP no abrio el puerto 3337 en 30 segundos.
echo Revisa la ventana MCP PC Control para ver el error.
pause
exit /b 1

:server_ready
echo Servidor MCP listo.
echo Asegurando Tailscale Funnel (URL estatica)...
set "TSEXE=%ProgramFiles%\Tailscale\tailscale.exe"
if exist "%TSEXE%" (
  "%TSEXE%" up >nul 2>nul
  "%TSEXE%" funnel --bg 3337 >nul 2>nul
  echo URL publica estatica: https://desktop-qcbs0te.tail3cea3.ts.net/mcp
) else (
  echo [AVISO] No se encontro Tailscale en "%TSEXE%".
  echo Instala Tailscale o ajusta la ruta TSEXE en este script.
)

echo.
echo Todo fue iniciado correctamente.
echo Cloudflare ya no se usa: la conexion es 100%% Tailscale Funnel.
timeout /t 5 /nobreak >nul
exit /b 0
