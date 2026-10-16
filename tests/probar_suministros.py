"""Categorías de suministros (Agua, Luz, Gas, Telefonía e internet) SIN Gemini.
1) GET /categorias: 28 activas, las 4 nuevas con su cuenta y el «Suministros (…)» antiguo desactivado.
2) Arnés del Code «Preparar petición Gemini» de la Ingesta con las categorías reales de fact_categorias:
   el enum contiene las 4 y no el antiguo, y el prompt trae las pistas por compañía.
Uso: .venv\Scripts\python tests\probar_suministros.py  (N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path
AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI)); sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import Api, check, leer_env, resumen_final  # noqa: E402
from mcp_cliente import MCP, PROYECTO, leer_tabla  # noqa: E402

env = leer_env()
api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
items = api.get("/categorias").json()["items"]
nombres = [i["nombre"] for i in items]
cuentas = {i["nombre"]: i["cuenta_pgc"] for i in items}
check("GET /categorias: 28 activas", len(items) == 28, str(len(items)))
for n, c in [("Agua", "628"), ("Luz", "628"), ("Gas", "628"), ("Telefonía e internet", "629")]:
    check(f"{n} activa con cuenta {c}", cuentas.get(n) == c)
check("el antiguo Suministros ya no se ofrece", not any(n.startswith("Suministros") for n in nombres))
check("las 4 nuevas son contiguas y van antes de Seguros", nombres[4:9] == ["Agua", "Luz", "Gas", "Telefonía e internet", "Seguros"], str(nombres[4:9]))

# arnés: todas las filas (también la inactiva) como las lee el nodo «Leer categorías»
filas, _ = leer_tabla(MCP(), "wUG04k8qKHE1fL8A")
ctx = {"nodos": {"Recorrer archivos": [{"json": {"mime": "application/pdf", "nombre": "x.pdf", "cliente_id": 1}}],
                 "Leer categorías": [{"json": f} for f in filas]},
       "input": [{"json": {"text": "Factura de suministro eléctrico " * 10}}]}
tmp = AQUI / "salida" / "ctx_suministros.json"; tmp.parent.mkdir(exist_ok=True)
tmp.write_text(json.dumps(ctx), encoding="utf-8")
r = subprocess.run(["sh", str(AQUI / "arnes.sh"), str(AQUI.parent / "n8n/codigo/ingesta_preparar_gemini.js"), str(tmp), str(AQUI / "salida" / "sal_suministros.json")], capture_output=True, text=True)
check("el arnés ejecuta el Code", r.returncode == 0, (r.stderr or r.stdout)[-200:])
out = json.loads((AQUI / "salida" / "sal_suministros.json").read_text(encoding="utf-8"))
j = out[0]["json"] if isinstance(out, list) else out
enum = j.get("categorias", [])
check("enum con Agua, Luz, Gas y Telefonía e internet", all(n in enum for n in ["Agua", "Luz", "Gas", "Telefonía e internet"]))
check("enum sin el Suministros antiguo", not any(n.startswith("Suministros") for n in enum))
p = json.dumps(j.get("peticion"), ensure_ascii=False)
check("el prompt trae las pistas por compañía", all(s in p for s in ["«Luz»", "«Agua»", "«Gas»", "«Telefonía e internet»", "Movistar"]))
sys.exit(resumen_final())
