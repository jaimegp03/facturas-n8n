"""Pruebas de la tanda A del modo gestoría (docs/diseno-gestoria.md): clientes, desglose fiscal,
retenciones, recargo, tickets con IVA incluido, rectificativas, intracomunitarias, moneda (BCE),
NIF, búsqueda, PATCH en lote y /resumen sin mezclar monedas.

Fases (se pueden combinar; sin argumentos = --comprobar):
  --preparar    crea (o reutiliza) los clientes TEST·… por POST /clientes y prueba sus 422.
  --ingestar    ingesta REAL con Gemini de TEST_01, 02, 05, 06, 09 y 11 (6 llamadas como mucho;
                05 sin cliente_id para que se asigne por el NIF del destinatario). Guarda la respuesta
                en tests/salida/gestoria_a/ingesta.json. No repite archivos ya ingeridos (hash).
  --sinteticas  inserta TEST_08 (rectificativa), TEST_12 (NIF inválido) y TEST_99 (GBP sin tipo de cambio)
                como filas mínimas por el MCP y las completa con PATCH (la API recalcula todo).
  --pin         prueba la Ingesta sin Gemini (test_workflow + pin data) con TEST_08 y TEST_12.
  --comprobar   comprueba todo lo anterior contra tests/facturas-contables/esperado_contable.json.
  --bloques     comprueba que las copias de los bloques COMÚN (Ingesta/API, Recurrentes y Fiscal) son idénticas
                (JSON exportados; no toca n8n).

Todas las filas de prueba llevan archivo_nombre TEST_… y proveedor TEST·…; los clientes, nombre TEST·….
Bórralas al terminar con «FACT — TEMP auditoría: borrar TEST» y borra sus originales (ver CLAUDE.md).
Lee N8N_BASE_URL y FACT_API_KEY de .env y N8N_MCP_TOKEN del entorno. Nunca imprime tokens.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests" / "auditoria"))
CARPETA = RAIZ / "tests" / "facturas-contables"
SALIDA = RAIZ / "tests" / "salida" / "gestoria_a"
ESPERADO = {e["id"]: e for e in json.loads((CARPETA / "esperado_contable.json").read_text(encoding="utf-8"))}
REAL = ["01", "02", "06", "09", "11"]          # con cliente_id = TEST·Reformas
REAL_SIN_CLIENTE = ["05"]                      # cliente por NIF del destinatario
TABLA_FACTURAS = "7PLB3ZEQRDVYx6iD"
PROYECTO = "bZtIqKac0YRZrt14"
INGESTA = "XsVbiul39k797Ury"
TIMEOUT = 300
MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png"}

resultados: list[tuple[str, bool, str]] = []


def check(nombre: str, ok: bool, detalle: str = "") -> bool:
    resultados.append((nombre, bool(ok), detalle))
    print(f"  [{'OK' if ok else 'FALLO'}] {nombre}" + (f" — {detalle}" if detalle else ""))
    return bool(ok)


def c(x) -> int | None:
    return None if x is None else round(float(x) * 100)


def leer_env() -> dict:
    env = {}
    for linea in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("FACT_API_KEY"):
        sys.exit("FACT_API_KEY vacío en .env.")
    env.setdefault("N8N_BASE_URL", "http://localhost:5678")
    return env


class Api:
    def __init__(self, base: str, clave: str):
        self.base = base.rstrip("/") + "/webhook"
        self.h = {"X-API-Key": clave}

    def get(self, ruta, **params):
        return requests.get(self.base + ruta, headers=self.h, params=params, timeout=TIMEOUT)

    def post(self, ruta, cuerpo):
        return requests.post(self.base + ruta, headers=self.h, json=cuerpo, timeout=TIMEOUT)

    def patch(self, ruta, cuerpo, **params):
        return requests.patch(self.base + ruta, headers=self.h, params=params, json=cuerpo, timeout=TIMEOUT)

    def subir(self, archivos: list[Path], cliente_id: int | None):
        abiertos = [f.open("rb") for f in archivos]
        try:
            partes = [("archivo", (f.name, h, MIME[f.suffix.lower()])) for f, h in zip(archivos, abiertos)]
            datos = {"cliente_id": str(cliente_id)} if cliente_id else None
            return requests.post(self.base + "/facturas", files=partes, data=datos, headers=self.h, timeout=TIMEOUT)
        finally:
            for h in abiertos:
                h.close()


def todas_test(api: Api) -> list[dict]:
    """Filas TEST (todas, también borradas) vía GET /facturas paginado."""
    filas, pagina = [], 1
    for estado in (None, "borrada"):
        pagina = 1
        while True:
            params = {"por_pagina": 200, "pagina": pagina}  # Gemini no siempre copia el prefijo «TEST·»: se filtra por archivo
            if estado:
                params["estado"] = estado
            j = api.get("/facturas", **params).json()
            filas += [f for f in j["items"] if str(f.get("archivo_nombre") or "").startswith("TEST_") or str(f.get("proveedor") or "").startswith("TEST·")]
            if pagina >= (j["paginas"] or 1):
                break
            pagina += 1
    return filas


def por_archivo(filas: list[dict]) -> dict:
    """TEST_xx -> fila más reciente cuyo archivo empieza por TEST_xx."""
    res = {}
    for f in sorted(filas, key=lambda x: x["id"]):
        n = str(f.get("archivo_nombre") or "")
        if n.startswith("TEST_"):
            res[n[5:7]] = f
    return res


def clientes_test(api: Api) -> dict:
    items = api.get("/clientes").json()["items"]
    return {"reformas": next((x for x in items if x["nif"] == ESPERADO["01"]["cliente_nif"]), None),
            "panaderia": next((x for x in items if x["nif"] == ESPERADO["05"]["cliente_nif"]), None),
            "personal": next((x for x in items if x["nombre"] == "Personal"), None), "todos": items}


# ---------------------------------------------------------------- fases
def preparar(api: Api) -> None:
    print("\n/clientes")
    r = api.get("/clientes")
    j = r.json()
    check("GET /clientes -> 200 con «Personal» (particular)", r.status_code == 200 and any(x["nombre"] == "Personal" and x["regimen_iva"] == "particular" for x in j["items"]))
    for clave, eid, regimen, nombre in (("reformas", "01", "general", "TEST·Reformas García e Hijos, S.L."),
                                        ("panaderia", "05", "recargo_equivalencia", "TEST·Panadería Lucía Martín")):
        cl = clientes_test(api)[clave]
        if cl is None:
            r = api.post("/clientes", {"nombre": nombre, "nif": "ES-" + ESPERADO[eid]["cliente_nif"], "regimen_iva": regimen, "prorrata_pct": 100})
            cl = r.json().get("cliente", {})
            check(f"POST /clientes {nombre} -> 201, NIF normalizado sin «ES»", r.status_code == 201 and cl.get("nif") == ESPERADO[eid]["cliente_nif"] and cl.get("regimen_iva") == regimen,
                  f"HTTP {r.status_code}")
    r = api.post("/clientes", {"nombre": "TEST·NIF malo", "nif": "B66209810", "regimen_iva": "general"})
    check("POST /clientes NIF con control erróneo -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    r = api.post("/clientes", {"nombre": "TEST·Duplicado", "nif": ESPERADO["01"]["cliente_nif"], "regimen_iva": "general"})
    check("POST /clientes NIF duplicado -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    r = api.post("/clientes", {"nombre": "TEST·Sin régimen válido", "nif": "B12876546", "regimen_iva": "otro"})
    check("POST /clientes régimen no válido -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    r = api.post("/clientes", {"nombre": "TEST·x", "nif": "B12876546", "regimen_iva": "general", "color": "rojo"})
    check("POST /clientes campo desconocido -> 400", r.status_code == 400, f"HTTP {r.status_code}")
    ref = clientes_test(api)["reformas"]
    r = api.patch("/clientes", {"prorrata_pct": 90}, id=ref["id"])
    ok1 = r.status_code == 200 and r.json()["cliente"]["prorrata_pct"] == 90
    r = api.patch("/clientes", {"prorrata_pct": 100}, id=ref["id"])
    check("PATCH /clientes?id= prorrata 90 y vuelta a 100", ok1 and r.status_code == 200 and r.json()["cliente"]["prorrata_pct"] == 100)
    check("PATCH /clientes?id=999999 -> 404", api.patch("/clientes", {"prorrata_pct": 50}, id=999999).status_code == 404)
    check("POST /clientes sin X-API-Key -> 403", requests.post(api.base + "/clientes", json={}, timeout=TIMEOUT).status_code == 403)
    r = requests.options(api.base + "/clientes", headers={"Origin": "null", "Access-Control-Request-Method": "PATCH",
                                                         "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=TIMEOUT)
    check("preflight Origin null PATCH /clientes", r.headers.get("Access-Control-Allow-Origin") == "null" and "PATCH" in (r.headers.get("Access-Control-Allow-Methods") or ""),
          r.headers.get("Access-Control-Allow-Methods") or "")


def ingestar(api: Api) -> None:
    print("\nIngesta real (Gemini)")
    SALIDA.mkdir(parents=True, exist_ok=True)
    ya = por_archivo(todas_test(api))
    cl = clientes_test(api)
    r = api.subir([CARPETA / ESPERADO["02"]["archivo"]], 999999)
    check("POST /facturas con cliente_id inexistente -> 400 sin llamar a Gemini", r.status_code == 400, f"HTTP {r.status_code}")
    registro = json.loads((SALIDA / "ingesta.json").read_text(encoding="utf-8")) if (SALIDA / "ingesta.json").exists() else []
    for ids, cliente in ((REAL, cl["reformas"]["id"]), (REAL_SIN_CLIENTE, None)):
        pendientes = [i for i in ids if i not in ya]
        if not pendientes:
            continue
        t0 = time.time()
        r = api.subir([CARPETA / ESPERADO[i]["archivo"] for i in pendientes], cliente)
        dur = time.time() - t0
        j = r.json()
        registro += [{"archivo": x["archivo"], "estado": x["estado"], "error": x.get("error"), "extraccion": x.get("extraccion"),
                      "factura_id": (x.get("factura") or {}).get("id"), "segundos_peticion": round(dur, 1)} for x in j.get("resultados", [])]
        print(f"  {len(pendientes)} archivo(s) en {dur:.1f} s -> " + ", ".join(f"{x['archivo'][:7]} {x['estado']}" for x in j.get("resultados", [])))
    (SALIDA / "ingesta.json").write_text(json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8")


def sinteticas(api: Api) -> None:
    """Filas mínimas (como las dejaría una ingesta antigua) que la API completa por PATCH."""
    from mcp_cliente import MCP
    print("\nFilas sintéticas TEST_08, TEST_12 y TEST_99 (MCP + PATCH)")
    ya = por_archivo(todas_test(api))
    cl = clientes_test(api)["reformas"]
    ahora = "2026-10-15T00:00:00+02:00"

    def fila(eid, archivo, prov, nif, numero, fecha, base, tipo, cuota, total, moneda="EUR"):
        return {"usuario_id": "default", "hash_sha256": f"test{eid}".ljust(64, "0"), "archivo_ruta": None, "archivo_nombre": archivo, "mime": "application/pdf",
                "proveedor": prov, "proveedor_norm": prov.lower().replace("·", " "), "nif": nif, "numero": numero, "fecha_emision": fecha, "fecha_vencimiento": None,
                "lineas_json": "[]", "base": base, "iva_tipo": tipo, "iva_cuota": cuota, "total": total, "moneda": moneda, "metodo_pago": None,
                "categoria": "Servicios profesionales", "subcategoria": None, "tipo_gasto": "puntual", "periodicidad": None, "confianza": 1, "motivo": "Fila sintética de prueba.",
                "estado": "revisar", "errores_validacion": None, "origen_categoria": "manual", "creado": ahora, "actualizado": ahora, "cliente_id": cl["id"],
                "desglose_iva_json": None, "tipo_cambio": None, "total_eur": None, "estado_pago": "pendiente"}
    e8, e12 = ESPERADO["08"], ESPERADO["12"]
    nuevas = []
    if "08" not in ya:
        nuevas.append(fila("08", e8["archivo"], e8["proveedor"], e8["proveedor_nif"], e8["numero"], e8["fecha_expedicion"], -100, 21, -21, -121))
    if "12" not in ya:
        nuevas.append(fila("12", e12["archivo"], e12["proveedor"], e12["proveedor_nif"], e12["numero"], e12["fecha_expedicion"], 180, 21, 37.8, 217.8))
    if "99" not in ya:
        nuevas.append(fila("99", "TEST_99_libras_sin_cambio.pdf", "TEST·London Supplies Ltd", "GB123456789", "LS-1", "2026-07-15", 50, 0, 0, 50, "GBP"))
    if nuevas:
        MCP().call("add_data_table_rows", {"dataTableId": TABLA_FACTURAS, "projectId": PROYECTO, "rows": nuevas})
    m = por_archivo(todas_test(api))
    r = api.patch("/facturas", {"tipo_factura": "rectificativa", "rectifica_numero": e8["rectifica"], "irpf_tipo": 15, "irpf_cuota": 15, "categoria": "Servicios profesionales"}, id=m["08"]["id"])
    check("PATCH TEST_08 (rectificativa, total −121, IRPF 15 %) -> 200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:200] if r.status_code != 200 else ''}")
    r = api.patch("/facturas", {"nif": e12["proveedor_nif"], "categoria": "Reparaciones y mantenimiento"}, id=m["12"]["id"])
    check("PATCH TEST_12 (NIF) -> 200", r.status_code == 200, f"HTTP {r.status_code}")


def pin(api: Api) -> None:
    """Ingesta sin Gemini: test_workflow con pin data (nada se escribe en disco ni en la tabla)."""
    from mcp_cliente import MCP
    print("\nIngesta con pin data (sin Gemini): TEST_08 y TEST_12")
    m = MCP()
    cl = clientes_test(api)["reformas"]
    casos = {
        "08": {"proveedor": ESPERADO["08"]["proveedor"], "nif": "29384756W", "numero": "R-2026-0003", "tipo_factura": "rectificativa", "rectifica_numero": "2026-0087",
               "fecha_emision": "2026-07-25", "desglose_iva": [{"base": -100, "tipo_iva": 21, "cuota_iva": -21, "tipo_re": None, "cuota_re": None, "importe_con_iva": None}],
               "irpf_tipo": 15, "irpf_cuota": -15, "total": -121, "total_a_pagar": -106},
        "12": {"proveedor": ESPERADO["12"]["proveedor"], "nif": "B66209810", "numero": "LB-2026-0412", "tipo_factura": "completa", "rectifica_numero": None,
               "fecha_emision": "2026-07-22", "desglose_iva": [{"base": 180, "tipo_iva": 21, "cuota_iva": 37.8, "tipo_re": None, "cuota_re": None, "importe_con_iva": None}],
               "irpf_tipo": None, "irpf_cuota": None, "total": 217.8, "total_a_pagar": 217.8},
        "13": {"proveedor": "TEST·Supermercado Pin", "nif": "B66209810", "numero": "SP-2026-0001", "tipo_factura": "completa", "rectifica_numero": None,
               "fecha_emision": "2026-07-22", "desglose_iva": [{"base": 10, "tipo_iva": 10, "cuota_iva": 1, "tipo_re": None, "cuota_re": None, "importe_con_iva": None}],
               "irpf_tipo": None, "irpf_cuota": None, "total": 11, "total_a_pagar": 11, "categoria": "Alimentación y supermercado"},
    }
    comunes = {"fecha_operacion": None, "fecha_vencimiento": None, "destinatario_nombre": "TEST·Reformas", "destinatario_nif": "B44173029", "lineas": [],
               "base_exenta": None, "suplidos": None, "mencion_operacion": "ninguna", "tipo_iva_autorrepercusion": None, "moneda": "EUR", "metodo_pago": "transferencia",
               "pagada": None, "categoria": "Servicios profesionales", "subcategoria": None, "tipo_gasto": "puntual", "periodicidad": None, "confianza": 0.95, "motivo": "Prueba."}
    for eid, d in casos.items():
        gem = {"candidates": [{"content": {"parts": [{"text": json.dumps({**comunes, **d}, ensure_ascii=False)}]}, "finishReason": "STOP"}], "modelVersion": "pin"}
        pin_data = {
            "Recibir facturas": [{"json": {"headers": {}, "params": {}, "query": {}, "body": {}}}],
            "Preparar archivos": [{"json": {"orden": 0, "archivo": f"TEST_{eid}_pin.pdf", "cliente_id": cl["id"], "tamano": 1000, "mime": "application/pdf", "ext": "pdf",
                                            "hash": ("f" * 62) + eid, "valido": True}}],
            "Extraer texto PDF": [{"json": {"text": "Documento de prueba sin datos reales. " * 5}}],
            "Gemini extraer": [{"json": gem}], "Gemini respaldo": [{"json": gem}], "BCE tipo de cambio": [{"json": {"data": ""}}],
            "Guardar original": [{"json": {"ok": True}}], "Insertar factura": [{"json": {"id": 0, "pin": True}}],
        }
        r = m.call("test_workflow", {"workflowId": INGESTA, "pinData": pin_data, "timeout": 120})
        ex = m.call("get_workflow_execution", {"workflowId": INGESTA, "executionId": str(r["executionId"]), "includeData": True, "nodeNames": ["Decidir estado final"]})
        txt = json.dumps(ex, ensure_ascii=False)
        i = txt.find('"fila"')
        f = json.JSONDecoder().raw_decode(txt[i + 7:].lstrip())[0] if i >= 0 else {}
        if eid == "08":
            # Si ya existe la fila sintética TEST_08 del mismo cliente, lo correcto es «posible_duplicada» (único aviso).
            solo_dup = f.get("estado") == "posible_duplicada" and all(x.startswith("Posible duplicada") for x in str(f.get("errores_validacion") or "").split(" | "))
            check("pin TEST_08: rectificativa negativa -> ok (o solo posible duplicada), a pagar −106, IRPF −15", r.get("status") == "success"
                  and (f.get("estado") == "ok" or solo_dup) and c(f.get("total")) == -12100
                  and c(f.get("total_a_pagar")) == -10600 and c(f.get("irpf_cuota")) == -1500 and f.get("rectifica_numero") == "2026-0087",
                  f"estado={f.get('estado')} total={f.get('total')} a_pagar={f.get('total_a_pagar')} irpf={f.get('irpf_cuota')}")
        elif eid == "13":
            check("pin TEST_13: Alimentación sin regla -> cuenta_gasto 600 y cuenta_proveedor 400 (por defecto de la categoría)",
                  r.get("status") == "success" and f.get("cuenta_gasto") == "600" and f.get("cuenta_proveedor") == "400",
                  f"gasto={f.get('cuenta_gasto')} proveedor={f.get('cuenta_proveedor')}")
        else:
            check("pin TEST_12: NIF inválido -> nif_valido false, deducible no", r.get("status") == "success" and f.get("nif_valido") is False and f.get("deducible") == "no"
                  and f.get("cuota_deducible") == 0, f"nif_valido={f.get('nif_valido')} deducible={f.get('deducible')}")


def tipo_bce(moneda: str, fecha: str) -> float | None:
    d = date.fromisoformat(fecha)
    url = f"https://data-api.ecb.europa.eu/service/data/EXR/D.{moneda}.EUR.SP00.A"
    r = requests.get(url, params={"startPeriod": (d - timedelta(days=7)).isoformat(), "endPeriod": fecha, "format": "csvdata"}, timeout=30)
    filas = [x for x in csv.DictReader(io.StringIO(r.text)) if x.get("TIME_PERIOD", "") <= fecha]
    return float(filas[-1]["OBS_VALUE"]) if filas else None


def comprobar(api: Api) -> None:
    print("\nComprobación contra esperado_contable.json")
    m = por_archivo(todas_test(api))
    cl = clientes_test(api)
    ref, pan = cl["reformas"], cl["panaderia"]
    if not ref or not pan:
        check("clientes TEST creados (ejecuta --preparar)", False)
        return

    def desglose(f):
        return sorted(((c(x["base"]), x["tipo_iva"], c(x["cuota_iva"]), x.get("tipo_re") or 0, c(x.get("cuota_re") or 0)) for x in json.loads(f.get("desglose_iva_json") or "[]")), key=lambda t: -t[1])

    def esperado_desglose(e):
        return sorted(((c(b["base"]), b["tipo_iva"], c(b["cuota_iva"]), b["tipo_re"], c(b["cuota_re"])) for b in e["bases"]), key=lambda t: -t[1])

    f = m.get("02")
    if check("TEST_02 ingerida", f is not None):
        check("TEST_02: total 605 / a pagar 530 / IRPF 75 (15 %) / estado ok", c(f["total"]) == 60500 and c(f["total_a_pagar"]) == 53000 and c(f["irpf_cuota"]) == 7500
              and f["irpf_tipo"] == 15 and f["estado"] == "ok", f"total={f['total']} a_pagar={f['total_a_pagar']} irpf={f['irpf_cuota']} estado={f['estado']} {f.get('errores_validacion') or ''}")
        check("TEST_02: cliente Reformas (parámetro), deducible si 105, cuenta 623/410", f["cliente_id"] == ref["id"] and f["deducible"] == "si" and c(f["cuota_deducible"]) == 10500
              and f["cuenta_gasto"] == "623" and f["cuenta_proveedor"] == "410", f"deducible={f['deducible']} cuenta={f['cuenta_gasto']}/{f['cuenta_proveedor']} categoria={f['categoria']}")
    f = m.get("01")
    if check("TEST_01 ingerida", f is not None):
        check("TEST_01: tres líneas de IVA (21/10/4) y totales", desglose(f) == esperado_desglose(ESPERADO["01"]) and c(f["total"]) == 24120 and c(f["iva_cuota"]) == 3120 and c(f["base"]) == 21000,
              f"desglose={desglose(f)} estado={f['estado']}")
    f = m.get("05")
    if check("TEST_05 ingerida", f is not None):
        check("TEST_05: recargo 14,60 (5,2 % y 1,4 %), cuadra, estado ok", desglose(f) == esperado_desglose(ESPERADO["05"]) and c(f["cuota_re"]) == 1460 and f["estado"] == "ok",
              f"desglose={desglose(f)} cuota_re={f['cuota_re']} estado={f['estado']} {f.get('errores_validacion') or ''}")
        check("TEST_05: cliente Panadería asignado por NIF del destinatario y deducible no (RE)", f["cliente_id"] == pan["id"] and f["destinatario_nif"] == pan["nif"] and f["deducible"] == "no",
              f"cliente_id={f['cliente_id']} destinatario={f['destinatario_nif']} deducible={f['deducible']}")
    f = m.get("06")
    if check("TEST_06 ingerida", f is not None):
        check("TEST_06: ticket simplificada, base 49,59 y cuota 10,41 calculadas en Code", f["tipo_factura"] == "simplificada" and c(f["base"]) == 4959 and c(f["iva_cuota"]) == 1041 and c(f["total"]) == 6000,
              f"tipo={f['tipo_factura']} base={f['base']} cuota={f['iva_cuota']} estado={f['estado']}")
        check("TEST_06: sin NIF del destinatario -> deducible no", f["deducible"] == "no" and not f["destinatario_nif"], f"deducible={f['deducible']} motivo={f['motivo_deducible']}")
    f = m.get("09")
    if check("TEST_09 ingerida", f is not None):
        check("TEST_09: intracomunitaria, base exenta 120, autorrepercutida 25,20, NIF extranjero (null)", f["operacion"] == "intracomunitaria" and c(f["base_exenta"]) == 12000
              and c(f["cuota_autorrepercutida"]) == 2520 and f["nif_valido"] is None and c(f["total"]) == 12000,
              f"op={f['operacion']} exenta={f['base_exenta']} auto={f['cuota_autorrepercutida']} nif_valido={f['nif_valido']}")
        check("TEST_09: deducible si (autorrepercutida 25,20 deducible)", f["deducible"] == "si" and c(f["cuota_deducible"]) == 2520, f"deducible={f['deducible']} cuota_deducible={f['cuota_deducible']}")
    f = m.get("11")
    if check("TEST_11 ingerida", f is not None):
        tasa = tipo_bce("USD", ESPERADO["11"]["fecha_expedicion"])
        esperado_eur = round(99 / tasa, 2) if tasa else None
        check("TEST_11: USD con tipo de cambio del BCE y total_eur", f["moneda"] == "USD" and f["tipo_cambio"] and tasa and abs(f["tipo_cambio"] - 1 / tasa) < 1e-6
              and abs(c(f["total_eur"]) - c(esperado_eur)) <= 1 and c(f["total"]) == 9900,
              f"tipo_cambio={f['tipo_cambio']} total_eur={f['total_eur']} (BCE {tasa} -> {esperado_eur})")
        check("TEST_11: extracomunitaria, autorrepercutida 20,79", f["operacion"] == "extracomunitaria" and c(f["cuota_autorrepercutida"]) == 2079, f"op={f['operacion']} auto={f['cuota_autorrepercutida']}")
    f = m.get("08")
    if check("TEST_08 (sintética) presente", f is not None):
        check("TEST_08: rectificativa negativa -> ok, a pagar −106, IRPF −15", f["estado"] == "ok" and f["tipo_factura"] == "rectificativa" and c(f["total"]) == -12100
              and c(f["total_a_pagar"]) == -10600 and c(f["irpf_cuota"]) == -1500 and f["rectifica_numero"] == "2026-0087",
              f"estado={f['estado']} total={f['total']} a_pagar={f['total_a_pagar']} {f.get('errores_validacion') or ''}")
    f = m.get("12")
    if check("TEST_12 (sintética) presente", f is not None):
        check("TEST_12: nif_valido false -> deducible no (subsanable), cuenta 622/410", f["nif_valido"] is False and f["deducible"] == "no" and "NIF" in (f["motivo_deducible"] or "")
              and f["cuenta_gasto"] == "622", f"nif_valido={f['nif_valido']} deducible={f['deducible']} cuenta={f['cuenta_gasto']}")

    print("\nBúsqueda q (proveedor, NIF, número, importe)")
    for q, eid in (("B44582096", None), ("29384756W", "02"), ("29384756-w", "02"), ("MT-2026/004518", "01"), ("241,20", "01"), ("241.20", "01"), ("530,00", "02"), ("1.161,60", None)):
        r = api.get("/facturas", q=q, cliente_id=ref["id"])
        ids = {x["id"] for x in r.json()["items"]}
        if eid is None:
            check(f"q={q!r} sin coincidencias -> 0", r.status_code == 200 and not ids, f"{len(ids)}")
        elif eid in m:
            check(f"q={q!r} encuentra TEST_{eid}", r.status_code == 200 and m[eid]["id"] in ids, f"{len(ids)} resultado(s)")
    r = api.get("/facturas", q="repsol")
    check("q='repsol' (proveedor real, sin cliente) -> 1", r.json()["total"] == 1)
    r = api.get("/facturas", cliente_id=ref["id"], deducible="no")
    check("filtro deducible=no del cliente incluye TEST_06 y TEST_12", all(m[e]["id"] in {x["id"] for x in r.json()["items"]} for e in ("06", "12") if e in m))
    r = api.get("/facturas", cliente_id=ref["id"], tipo_factura="rectificativa")
    check("filtro tipo_factura=rectificativa -> TEST_08", "08" in m and [x["id"] for x in r.json()["items"]] == [m["08"]["id"]])
    r = api.get("/facturas", cliente_id=ref["id"], orden="total")
    tot = [x["total_eur"] if x["total_eur"] is not None else float("inf") for x in r.json()["items"]]  # sin importe en euros: al final
    check("orden=total ascendente (por total en euros)", tot == sorted(tot), str(tot[:5]))
    r = api.get("/facturas", cliente_id=ref["id"], vencidas="1")
    hoy = date.today().isoformat()
    check("vencidas=1: pendientes con vencimiento pasado", all(x["estado_pago"] != "pagada" and x["fecha_vencimiento"] and x["fecha_vencimiento"] < hoy for x in r.json()["items"]),
          f"{r.json()['total']} vencida(s)")
    check("parámetros nuevos no válidos -> 400", all(api.get("/facturas", **{k: v}).status_code == 400 for k, v in
                                                       (("deducible", "x"), ("orden", "precio"), ("vencidas", "2"), ("cliente_id", "abc"), ("tipo_factura", "otra"))))

    print("\nPATCH /facturas/lote")
    ids = [m[e]["id"] for e in ("02", "12") if e in m]
    antes = {i: next(x for x in todas_test(api) if x["id"] == i) for i in ids}
    r = api.patch("/facturas/lote", {"ids": ids + [999999], "cambios": {"estado_pago": "pagada", "fecha_pago": "2026-09-30"}})
    j = r.json()
    check("lote: marcar pagadas -> actualizadas 2, error del id inexistente", r.status_code == 200 and j.get("actualizadas") == len(ids) and [e["id"] for e in j.get("errores", [])] == [999999], str(j)[:200])
    ahora_ = {i: next(x for x in todas_test(api) if x["id"] == i) for i in ids}
    check("lote: estado_pago y fecha_pago guardados, importes intactos", all(ahora_[i]["estado_pago"] == "pagada" and ahora_[i]["fecha_pago"] == "2026-09-30"
                                                                          and ahora_[i]["total"] == antes[i]["total"] for i in ids))
    r = api.patch("/facturas/lote", {"ids": ids, "cambios": {"cuenta_gasto": "629"}})
    ok_cuenta = r.status_code == 200 and all(x["cuenta_gasto"] == "629" for x in todas_test(api) if x["id"] in ids)
    r = api.patch("/facturas/lote", {"ids": ids, "cambios": {"estado_pago": "pendiente"}})
    for i in ids:
        api.patch("/facturas", {"cuenta_gasto": antes[i]["cuenta_gasto"]}, id=i)
    despues = {i: next(x for x in todas_test(api) if x["id"] == i) for i in ids}
    check("lote: cambiar cuenta y deshacer (pendiente, sin fecha_pago, cuenta original)", ok_cuenta and all(despues[i]["estado_pago"] == "pendiente" and despues[i]["fecha_pago"] is None
                                                                                                          and despues[i]["cuenta_gasto"] == antes[i]["cuenta_gasto"] for i in ids))
    check("lote: cambios no permitidos -> 400", api.patch("/facturas/lote", {"ids": ids, "cambios": {"total": 1}}).status_code == 400)
    check("lote: más de 500 ids -> 400", api.patch("/facturas/lote", {"ids": list(range(1, 502)), "cambios": {"estado_pago": "pagada"}}).status_code == 400)
    r = api.patch("/facturas/lote", {"ids": ids, "cambios": {"categoria": "Inventada"}})
    check("lote: categoría inexistente -> 0 actualizadas y error por id", r.status_code == 200 and r.json().get("actualizadas") == 0 and len(r.json().get("errores", [])) == len(ids))
    r = requests.options(api.base + "/facturas/lote", headers={"Origin": "null", "Access-Control-Request-Method": "PATCH",
                                                               "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=TIMEOUT)
    check("preflight Origin null PATCH /facturas/lote", r.headers.get("Access-Control-Allow-Origin") == "null" and "PATCH" in (r.headers.get("Access-Control-Allow-Methods") or ""))

    print("\nPATCH con campos nuevos (B1 en servidor)")
    if "02" in m:
        i = m["02"]["id"]
        check("PATCH irpf_cuota no numérico -> 422", api.patch("/facturas", {"irpf_cuota": "abc"}, id=i).status_code == 422)
        check("PATCH desglose_iva_json con importe no numérico -> 422", api.patch("/facturas", {"desglose_iva_json": [{"base": "x", "tipo_iva": 21, "cuota_iva": 1}]}, id=i).status_code == 422)
        check("PATCH deducible fuera de lista -> 422", api.patch("/facturas", {"deducible": "quizá"}, id=i).status_code == 422)

    print("\n/resumen por cliente, en euros y sin mezclar monedas")
    desde, hasta = "2026-07-01", "2026-09-30"
    r = api.get("/resumen", desde=desde, hasta=hasta, cliente_id=ref["id"])
    j = r.json()
    filas = [x for x in todas_test(api) if x["cliente_id"] == ref["id"] and desde <= (x["fecha_emision"] or "") <= hasta and x["estado"] not in ("borrada", "duplicada")]
    con_eur = [x for x in filas if x["total_eur"] is not None]
    sin = sorted(x["id"] for x in filas if x["total_eur"] is None)
    check("/resumen?cliente_id: total = Σ total_eur (nunca 99 USD como 99 €)", r.status_code == 200 and c(j["total"]) == sum(c(x["total_eur"]) for x in con_eur) and j["num_facturas"] == len(con_eur),
          f"API {j.get('total')} / Python {sum(c(x['total_eur']) for x in con_eur) / 100:.2f} ({len(con_eur)} facturas)")
    check("/resumen: excluidas_sin_cambio = facturas en otra moneda sin tipo de cambio (TEST_99 GBP)", j.get("excluidas_sin_cambio") == sin and "99" in m and m["99"]["id"] in sin, str(j.get("excluidas_sin_cambio")))
    r = api.get("/resumen", desde="2026-01-01", hasta="2026-10-14", cliente_id=cl["personal"]["id"])
    check("/resumen?cliente_id=Personal = 1.029,58 (datos reales intactos)", c(r.json()["total"]) == 102958, f"{r.json()['total']}")
    check("/resumen cliente_id no numérico -> 400", api.get("/resumen", cliente_id="x").status_code == 400)
    r = api.get("/exportar", desde=desde, hasta=hasta, cliente_id=ref["id"])
    check("/exportar?cliente_id -> XLSX", r.status_code == 200 and r.content[:2] == b"PK", f"HTTP {r.status_code}, {len(r.content)} bytes")
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / "test_filas.json").write_text(json.dumps([{"id": x["id"], "archivo_nombre": x["archivo_nombre"], "archivo_ruta": x["archivo_ruta"], "hash_sha256": x["hash_sha256"]}
                                                       for x in todas_test(api)], ensure_ascii=False, indent=2), encoding="utf-8")


def bloques(api: Api) -> None:
    """Los bloques duplicados a propósito deben ser idénticos (sobre los JSON exportados en n8n/workflows)."""
    print("\nBloques COMÚN idénticos (n8n/workflows/*.json)")
    def codigo(archivo, nodo):
        w = json.loads((RAIZ / "n8n" / "workflows" / archivo).read_text(encoding="utf-8"))
        w = w[0] if isinstance(w, list) else w
        return next(n["parameters"]["jsCode"] for n in w["nodes"] if n["name"] == nodo)
    def bloque(txt, marca):
        i, j = txt.find(f"// === {marca}: inicio ==="), txt.find(f"// === {marca}: fin ===")
        return txt[i:j] if 0 <= i < j else None
    for marca, sitios in (("COMÚN Ingesta/API", [("ingesta.json", "Interpretar y validar"), ("api.json", "PATCH: revalidar y fusionar"),
                                                 ("api.json", "Clientes: procesar"), ("utilidad-migrar-gestoria.json", "Calcular facturas")]),
                          ("COMÚN Recurrentes", [("api.json", "Resumen: calcular"), ("asesor.json", "Analizar y proponer"), ("exportar-excel.json", "Generar Excel")]),
                          ("COMÚN Fiscal", [("fiscal.json", "Fiscal: calcular"), ("exportar-excel.json", "Generar Excel")])):
        bs = [bloque(codigo(a, n), marca) for a, n in sitios]
        check(f"{marca}: {len(sitios)} copias idénticas", all(bs) and len(set(bs)) == 1, ", ".join(f"{n}" for _, n in sitios))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    fases = [a for a in sys.argv[1:] if a.startswith("--")] or ["--comprobar"]
    for fase, fn in (("--preparar", preparar), ("--ingestar", ingestar), ("--sinteticas", sinteticas), ("--pin", pin), ("--comprobar", comprobar), ("--bloques", bloques)):
        if fase in fases:
            fn(api)
    fallos = [n for n, ok, _ in resultados if not ok]
    print(f"\n{len(resultados) - len(fallos)}/{len(resultados)} comprobaciones OK")
    for n in fallos:
        print(f"  FALLO: {n}")
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
