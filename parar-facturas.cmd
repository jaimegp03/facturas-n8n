@echo off
rem Para Caddy (la puerta https://localhost). No apaga n8n ni Docker.
setlocal
set "CADDY="
where caddy >nul 2>&1 && set "CADDY=caddy"
if not defined CADDY for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\CaddyServer.Caddy_*") do if exist "%%D\caddy.exe" set "CADDY=%%D\caddy.exe"
if not defined CADDY ( echo No encuentro Caddy. & goto fin )
"%CADDY%" stop --address localhost:2019
if errorlevel 1 ( echo Caddy no estaba en marcha. ) else ( echo Caddy parado. n8n sigue funcionando. )
:fin
endlocal
