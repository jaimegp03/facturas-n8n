"""Contexto para probar «Generar Excel» en el arnés (tests/arnes.sh) con las filas reales de las Data Tables.
Uso: python tests/contexto_excel.py <cliente_id|todos> <desde> <hasta> > ctx.json"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "auditoria"))
from mcp_cliente import MCP, leer_tabla  # noqa: E402

m = MCP()
fac, _ = leer_tabla(m, "7PLB3ZEQRDVYx6iD")
cli, _ = leer_tabla(m, "vFk59qcLmkSdGzZg")
rec, _ = leer_tabla(m, "0LOu68SrmyMgKOIi")
cid = None if sys.argv[1] == "todos" else int(sys.argv[1])
params = {"origen": "webhook", "_error": False, "desde": sys.argv[2], "hasta": sys.argv[3], "hoy": "2026-10-15", "cliente_id": cid, "generado": "x"}
ctx = {"nodos": {"Parámetros": [{"json": params}], "Leer facturas": [{"json": f} for f in fac], "Leer clientes": [{"json": c} for c in cli],
                 "Leer última recomendación": [{"json": r} for r in rec]}, "input": [{"json": c} for c in cli], "ahora": "2026-10-15T09:00:00+02:00"}
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(ctx, ensure_ascii=False))
