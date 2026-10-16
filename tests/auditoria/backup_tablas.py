"""Copia de seguridad completa (todas las filas y columnas, con id/createdAt/updatedAt) de
fact_facturas, fact_reglas y fact_recomendaciones vía el MCP integrado de n8n.
Uso: python tests/auditoria/backup_tablas.py [carpeta_destino] [--todas]  (--todas: todas las tablas fact_*)"""
import hashlib, json, os, sys
from datetime import datetime
from mcp_cliente import MCP, TABLAS, TABLAS_TODAS, PROYECTO, leer_tabla

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if a != "--todas"]
TABLAS = TABLAS_TODAS if "--todas" in sys.argv else TABLAS
destino = args[0] if args else os.path.join(RAIZ, "salida", "backup-" + datetime.now().strftime("%Y-%m-%d"))
os.makedirs(destino, exist_ok=True)
mcp = MCP()
manifest = {"creado": datetime.now().astimezone().isoformat(timespec="seconds"), "proyecto": PROYECTO, "tablas": {}}
ok = True
for nombre, tid in TABLAS.items():
    filas, total = leer_tabla(mcp, tid)
    ids = [f["id"] for f in filas]
    assert len(ids) == len(set(ids)), f"{nombre}: ids repetidos al paginar"
    ruta = os.path.join(destino, nombre + ".json")
    with open(ruta, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"tabla": nombre, "id": tid, "filas": filas}, fh, ensure_ascii=False, indent=2)
    sha = hashlib.sha256(open(ruta, "rb").read()).hexdigest()
    cuadra = total is None or total == len(filas)
    ok &= cuadra
    manifest["tablas"][nombre] = {"id": tid, "archivo": nombre + ".json", "filas": len(filas),
                                  "filas_en_tabla": total, "sha256": sha}
    print(f"{nombre}: {len(filas)} filas guardadas / {total} en la tabla -> {'OK' if cuadra else 'NO CUADRA'}")
with open(os.path.join(destino, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
print("Destino:", destino)
sys.exit(0 if ok else 1)
