@echo off
rem Arranca n8n (Docker) y Caddy y abre la web de Facturas en https://localhost
rem Uso: iniciar-facturas.cmd [sinnavegador]
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "COMPOSE=docker compose -f n8n\docker-base\docker-compose.yml -f n8n\docker\docker-compose.override.yml"

echo [1/4] Comprobando Docker...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
echo       Docker no esta en marcha: abriendo Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a T=0
:espera_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
set /a T+=3
if %T% GEQ 180 goto err_docker
timeout /t 3 /nobreak >nul
goto espera_docker
:err_docker
echo ERROR: Docker no responde tras 3 minutos. Abre Docker Desktop a mano y vuelve a ejecutar este archivo.
goto fin
:docker_ok

echo [2/4] Arrancando n8n...
%COMPOSE% up -d
if errorlevel 1 goto err_compose
set /a T=0
:espera_n8n
curl -s -o nul -f http://localhost:5678/healthz
if not errorlevel 1 goto n8n_ok
set /a T+=3
if %T% GEQ 120 goto err_n8n
timeout /t 3 /nobreak >nul
goto espera_n8n
:err_compose
echo ERROR: no se pudo arrancar n8n con docker compose.
goto fin
:err_n8n
echo ERROR: n8n no responde en http://localhost:5678/healthz tras 2 minutos.
goto fin
:n8n_ok
echo       n8n responde.

echo [3/4] Arrancando Caddy...
set "CADDY="
where caddy >nul 2>&1
if not errorlevel 1 set "CADDY=caddy"
if not defined CADDY for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\CaddyServer.Caddy_*") do if exist "%%D\caddy.exe" set "CADDY=%%D\caddy.exe"
if not defined CADDY goto err_nocaddy
set "WEBDIR=%~dp0web"
set "FACTURAS_WEB_DIR=%WEBDIR:\=/%"
curl -s -o nul -f http://localhost:2019/config/
if not errorlevel 1 goto caddy_ya
powershell -NoProfile -Command "Start-Process -FilePath '%CADDY%' -ArgumentList 'run','--config','n8n\caddy\Caddyfile','--adapter','caddyfile' -WindowStyle Hidden -WorkingDirectory '%~dp0.' -RedirectStandardError '%TEMP%\caddy-facturas.log'"
set /a T=0
:espera_caddy
curl -s -o nul -f http://localhost:2019/config/
if not errorlevel 1 goto caddy_ok
set /a T+=1
if %T% GEQ 15 goto err_caddy
timeout /t 1 /nobreak >nul
goto espera_caddy
:err_nocaddy
echo ERROR: no encuentro Caddy. Instalalo con: winget install CaddyServer.Caddy
goto fin
:err_caddy
echo ERROR: Caddy no arranca. Mira %TEMP%\caddy-facturas.log (puertos 443, 8080 o 2019 ocupados?).
goto fin
:caddy_ya
echo       Caddy ya estaba en marcha.
:caddy_ok

echo [4/4] Listo: https://localhost
if /i not "%~1"=="sinnavegador" start "" "https://localhost"
:fin
endlocal
