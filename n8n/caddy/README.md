# Acceso por HTTPS (Caddy)

Caddy es la «puerta única» de la web: sirve `web/` y reenvía `/webhook/*` a n8n (`localhost:5678`), todo desde el mismo origen. Así no hay CORS ni contenido mixto, y el navegador permite la cámara, el escáner y la instalación como aplicación (PWA).

| Dirección | Para qué |
|---|---|
| `https://localhost` | Uso diario (certificado interno de Caddy) |
| `http://localhost:8080` | Sin TLS: lo usa Tailscale Serve y las pruebas. `localhost` cuenta como contexto seguro |

## Lanzadores (raíz del proyecto)
- `iniciar-facturas.cmd`: arranca Docker Desktop si hace falta, levanta n8n con el compose del proyecto, espera a `http://localhost:5678/healthz`, arranca Caddy en segundo plano (si el puerto 2019 está libre) y abre `https://localhost`. Con `sinnavegador` no abre el navegador.
- `parar-facturas.cmd`: para Caddy. No apaga n8n ni Docker.

No crean tareas programadas ni arranque con Windows. No contienen credenciales.

## Confiar en el certificado (una vez, lo haces tú)
Caddy firma `https://localhost` con su propia CA. Para que el navegador no avise, ejecuta en una consola con Caddy parado o en marcha: `caddy trust` (pide confirmar la instalación de la CA en Windows). Sin hacerlo, la web funciona igual pero el navegador muestra «No es seguro» y no deja instalar la app desde `https://localhost`; en ese caso usa `http://localhost:8080`.

## Verlo desde el móvil o fuera de casa: Tailscale
1. Instala Tailscale en el PC y en el móvil e inicia sesión con la misma cuenta.
2. En el PC: `tailscale serve --bg --https=443 http://localhost:8080`
3. En el móvil abre `https://<equipo>.<tailnet>.ts.net` (lo muestra `tailscale serve status`). Es un HTTPS real y solo lo ven tus dispositivos.
4. Para dejar de publicar: `tailscale serve --https=443 off`.

## Si un puerto está ocupado
Mira qué proceso lo usa: `netstat -ano | findstr :443` (o `:8080`, `:2019`) y `tasklist /fi "pid eq <PID>"`. Cierra ese programa (suele ser IIS, otro servidor local o Skype antiguo) o cambia el puerto en `n8n/caddy/Caddyfile`. Si `iniciar-facturas.cmd` dice que Caddy no arranca, el motivo queda en `%TEMP%\caddy-facturas.log`.
