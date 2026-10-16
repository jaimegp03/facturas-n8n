"""Compara fila a fila (todas las columnas, incluidos id/createdAt/updatedAt) el estado actual de
fact_facturas, fact_reglas y fact_recomendaciones con una copia hecha por backup_tablas.py.
Lectura: MCP integrado de n8n por HTTP (get_data_table_rows, paginado de 100 en 100), que sí es
accesible desde Python y devuelve todas las columnas; la API /facturas no expone createdAt/updatedAt
ni las otras dos tablas.
Uso: python tests/auditoria/comparar_backup.py [carpeta_backup]   -> sale con 1 si hay diferencias."""
import hashlib, json, os, sys
from mcp_cliente import MCP, TABLAS_TODAS, leer_tabla

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
carpeta = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "salida", "backup-2026-10-15")
manifest = json.load(open(os.path.join(carpeta, "manifest.json"), encoding="utf-8"))
mcp = MCP()
difs = []
for nombre, info in manifest["tablas"].items():
    tid = TABLAS_TODAS.get(nombre, info["id"])
    ruta = os.path.join(carpeta, info["archivo"])
    sha = hashlib.sha256(open(ruta, "rb").read()).hexdigest()
    if sha != info["sha256"]:
        difs.append(f"{nombre}: el archivo de backup no coincide con su SHA-256 del manifest")
    copia = json.load(open(ruta, encoding="utf-8"))["filas"]
    if len(copia) != info["filas"]:
        difs.append(f"{nombre}: el backup tiene {len(copia)} filas y el manifest dice {info['filas']}")
    actual, total = leer_tabla(mcp, tid)
    a = {f["id"]: f for f in copia}
    b = {f["id"]: f for f in actual}
    for i in sorted(a.keys() - b.keys()):
        difs.append(f"{nombre} id={i}: falta en la tabla actual")
    for i in sorted(b.keys() - a.keys()):
        difs.append(f"{nombre} id={i}: fila nueva que no estaba en el backup")
    for i in sorted(a.keys() & b.keys()):
        for col in sorted(a[i].keys() | b[i].keys()):
            va, vb = a[i].get(col, "<sin columna>"), b[i].get(col, "<sin columna>")
            if va != vb or type(va) is not type(vb):
                # no se imprimen valores (pueden contener datos de facturas), solo tipo y longitud
                difs.append(f"{nombre} id={i} columna {col}: distinto ({type(va).__name__} -> {type(vb).__name__})")
    print(f"{nombre}: backup {len(copia)} filas, actual {len(actual)} (count {total})")
print(f"Diferencias: {len(difs)}")
for d in difs:
    print("  -", d)
sys.exit(1 if difs else 0)
