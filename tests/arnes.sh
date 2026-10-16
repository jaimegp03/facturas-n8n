#!/bin/sh
# Ejecuta un Code node en el contenedor: tests/arnes.sh <codigo.js> <contexto.json> <salida.json>
# (copia los archivos a /tmp/arnes del contenedor n8n_local y trae la salida). En Git Bash las rutas
# del host se pasan a Windows con cygpath y las del contenedor sin traducir (MSYS_NO_PATHCONV).
export MSYS_NO_PATHCONV=1
w() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
docker exec n8n_local mkdir -p /tmp/arnes
docker cp "$(w "$RAIZ/tests/arnes_code.js")" n8n_local:/tmp/arnes/arnes_code.js >/dev/null
docker cp "$(w "$1")" n8n_local:/tmp/arnes/codigo.js >/dev/null
docker cp "$(w "$2")" n8n_local:/tmp/arnes/ctx.json >/dev/null
docker exec -w /tmp/arnes n8n_local node arnes_code.js codigo.js ctx.json salida.json || exit 1
docker cp n8n_local:/tmp/arnes/salida.json "$(w "$3")" >/dev/null
