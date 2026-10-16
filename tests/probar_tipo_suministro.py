r"""Tipo de suministro por contenido (sin Gemini, sin datos personales en la salida).
1) Detector sobre los PDF reales de C:\Users\GOMEZ\Downloads\Facturas reales: exactitud >= 98 % (lista los fallos).
2) Code real «Interpretar y validar» (arnés) con textos sintéticos: Endesa gas/luz, Energía XXI gas, regla Luz + gas -> Gas,
   regla que coincide, incoherencia -> revisar, no suministros, visión sin texto.
3) Bloques COMÚN idénticos (probar_gestoria_a.py --bloques) se ejecuta aparte.
Uso: .venv\Scripts\python tests\probar_tipo_suministro.py  (N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations
import glob, json, os, subprocess, sys
from pathlib import Path
import pymupdf
AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI)); sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import check, resumen_final  # noqa: E402
from mcp_cliente import MCP, leer_tabla  # noqa: E402
SAL = AQUI / "salida" / "sum"; SAL.mkdir(parents=True, exist_ok=True)

# --- 1) exactitud sobre los PDF reales ---
carpeta = r"C:\Users\GOMEZ\Downloads\Facturas reales"
ent, verdad = [], {}
for p in sorted(glob.glob(os.path.join(carpeta, "*.pdf"))):
    n = os.path.basename(p); t = "\n".join(pg.get_text() for pg in pymupdf.open(p))
    ent.append({"id": n, "texto": t, "archivo": n})
    u = n.upper()
    verdad[n] = ("luz" if u.startswith("LUZ") else "gas" if u.startswith("GAS") or n[:2] == "20" else "agua" if u.startswith(("AGUA", "FACTURA_2")) or n.startswith("factura_") else "telefonia")
    if n.startswith("AGUA 07-25"): verdad[n] = "luz"  # nombre mal puesto: el contenido es una factura de electricidad
(SAL / "ent_t.json").write_text(json.dumps(ent, ensure_ascii=False), encoding="utf-8")
subprocess.run(["node", str(AQUI / "detector_lote.js"), str(SAL / "ent_t.json"), str(SAL / "sal_t.json")], check=True)
sal = json.loads((SAL / "sal_t.json").read_text())
fallos = [e["id"][:12] for e, s in zip(ent, sal) if s["tipo"] != verdad[e["id"]] or not s["concluyente"]]
exactitud = 100 * (len(ent) - len(fallos)) / max(1, len(ent))
check(f"detector sobre {len(ent)} PDF reales: exactitud {exactitud:.1f} % (>= 98 %)", len(ent) >= 50 and exactitud >= 98, "fallos: " + ", ".join(fallos))

# --- 2) Code real con textos sintéticos ---
subprocess.run([sys.executable, str(AQUI.parent / "n8n" / "codigo" / "montar.py")], check=True, capture_output=True)
codigo = AQUI.parent / "n8n" / "codigo" / "montado" / "ingesta_interpretar.js"
m = MCP()
cats, _ = leer_tabla(m, "wUG04k8qKHE1fL8A"); clis, _ = leer_tabla(m, "vFk59qcLmkSdGzZg")
activas = [c["nombre"] for c in sorted(cats, key=lambda c: c.get("orden") or 0) if c.get("activa")]
GAS = "DATOS DE LA FACTURA DE GAS\nTérmino Fijo Gas\nTérmino Energía Gas\nTipo de gas: Gas natural\n10,481 kWh/m³\nAlquiler de Equipos Gas\n"
LUZ = "DATOS DE LA FACTURA DE ELECTRICIDAD\nPotencia contratada en punta-llano: 6,9 kW\nImpuesto electricidad\nPeaje de transporte y distribución: 2.0TD\n"


def correr(texto, prov, tipo_g, cat_g, reglas=(), archivo="x.pdf", modo="texto", subcat=None):
    d = {"proveedor": prov, "numero": "T-1", "fecha_emision": "2026-09-01", "total": 121.0, "total_a_pagar": 121.0, "moneda": "EUR", "confianza": 0.95,
         "categoria": cat_g, "subcategoria": subcat, "tipo_suministro": tipo_g, "tipo_gasto": "contrato", "periodicidad": "mensual", "tipo_factura": "completa",
         "desglose_iva": [{"base": 100.0, "tipo_iva": 21, "cuota_iva": 21.0, "tipo_re": None, "cuota_re": None}], "lineas": [], "mencion_operacion": "ninguna",
         "legibilidad": "buena", "pagada": None, "metodo_pago": "Domiciliación"}
    ctx = {"ahora": "2026-10-16T10:00:00+02:00", "input": [{"json": {}}], "nodos": {
        "Recorrer archivos": [{"json": {"orden": 0, "archivo": archivo, "hash": "a" * 64, "ext": "pdf", "mime": "application/pdf", "cliente_id": 1}}],
        "Preparar petición Gemini": [{"json": {"modo": modo, "categorias": activas, "texto_factura": texto}}],
        "Leer respuesta Gemini": [{"json": {"_error": False, "d": d, "modelo": "t", "moneda": "EUR", "bce": {"fecha": "2026-09-01", "desde": "2026-08-25"}}}],
        "Leer categorías": [{"json": c} for c in cats], "Leer clientes": [{"json": c} for c in clis],
        "Leer reglas": [{"json": r} for r in reglas]}}
    (SAL / "ctx_t.json").write_text(json.dumps(ctx), encoding="utf-8")
    r = subprocess.run(["sh", str(AQUI / "arnes.sh"), str(codigo), str(SAL / "ctx_t.json"), str(SAL / "out_t.json")], capture_output=True, text=True)
    if r.returncode: return {"_fallo": (r.stderr or r.stdout)[-200:]}
    o = json.loads((SAL / "out_t.json").read_text(encoding="utf-8"))[0]["json"]
    return {**o.get("fila", {}), "errores": o.get("errores", []), "_error": o.get("_error")}


def regla(prov_norm, cat): return {"proveedor_norm": prov_norm, "categoria": cat, "subcategoria": None, "usos": 3, "cliente_id": None}


c = correr(GAS, "Endesa Energía, S.A.U.", "luz", "Luz")
check("Endesa gas (Gemini dice Luz) -> Gas", c.get("categoria") == "Gas", str(c.get("categoria") or c))
c = correr(LUZ, "Endesa Energía, S.A.U.", "gas", "Gas")
check("Endesa luz (Gemini dice Gas) -> Luz", c.get("categoria") == "Luz", str(c.get("categoria")))
c = correr(GAS, "Energía XXI Comercializadora", "luz", "Luz")
check("Energía XXI gas -> Gas", c.get("categoria") == "Gas", str(c.get("categoria")))
c = correr(GAS, "Endesa Energía, S.A.U.", "gas", "Gas", [regla("endesa energia", "Luz")])
check("regla Luz para Endesa + factura de gas -> Gas, la regla no manda", c.get("categoria") == "Gas" and c.get("origen_categoria") != "regla", f"{c.get('categoria')} {c.get('origen_categoria')}")
check("... y sin aviso de incoherencia", not any("no coincide" in e for e in c.get("errores", [])))
c = correr(LUZ, "Endesa Energía, S.A.U.", "luz", "Luz", [regla("endesa energia", "Luz")])
check("regla Luz + factura de luz -> Luz por contenido (la regla de suministro se ignora)", c.get("categoria") == "Luz" and c.get("origen_categoria") == "llm", f"{c.get('categoria')} {c.get('origen_categoria')}")
c = correr("", "Proveedor raro", "ninguno", "Otros", [regla("proveedor raro", "Seguros")], modo="vision")
check("sin texto ni tipo: una regla de otra categoría sigue aplicando", c.get("categoria") == "Seguros" and c.get("origen_categoria") == "regla", str(c.get("categoria")))
c = correr("", "Proveedor raro", "ninguno", "Otros", [regla("proveedor raro", "Gas")], modo="vision")
check("sin texto ni tipo: una regla con categoría de suministro NO manda", c.get("categoria") == "Otros" and c.get("origen_categoria") == "llm", str(c.get("categoria")))
c = correr("Potencia contratada: cinco", "Comercializadora X", "gas", "Gas")
check("incoherencia (detector débil dice luz, Gemini gas) -> revisar con motivo", c.get("estado") == "revisar" and "no coincide con el contenido" in (" ".join(c.get("errores", []))), f"{c.get('estado')} {c.get('errores')}")
c = correr("Suscripción mensual de streaming de series y películas", "Netflix", "ninguno", "Streaming y música")
check("no suministro intacto (Streaming y música)", c.get("categoria") == "Streaming y música" and c.get("estado") == "ok", f"{c.get('categoria')} {c.get('estado')}")
c = correr("", "Endesa", "ninguno", "Luz", archivo="GAS 12-25 256,85.pdf", modo="vision")
check("visión: el nombre del archivo solo es pista débil (3 pts) y no fija el tipo", c.get("categoria") == "Luz", str(c.get("categoria")))
c = correr("", "Endesa", "gas", "Luz", modo="vision")
check("visión: tipo_suministro de Gemini decide (gas) aunque la categoría diga Luz", c.get("categoria") == "Gas", str(c.get("categoria")))
resumen_final()
