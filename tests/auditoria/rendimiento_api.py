r"""Prueba de rendimiento de la API (auditoría). Fases: antes | insertar | despues.
antes/despues miden 5 repeticiones por endpoint; insertar añade 520 filas sintéticas TEST·Perf.
Salida: tests/salida/auditoria-contable/rendimiento_api.json. No imprime tokens.
Uso: .venv\Scripts\python tests\auditoria\rendimiento_api.py <fase>"""
import json, random, statistics, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import requests
sys.path.insert(0, str(Path(__file__).parent))
from mcp_cliente import MCP, PROYECTO

RAIZ = Path(__file__).resolve().parents[2]
OUT = RAIZ / "tests" / "salida" / "auditoria-contable" / "rendimiento_api.json"
env = dict(l.split("=", 1) for l in (RAIZ / ".env").read_text(encoding="utf-8").splitlines() if "=" in l)
BASE = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
H = {"X-API-Key": env["FACT_API_KEY"]}
FACT = "7PLB3ZEQRDVYx6iD"
REP = 5

ENDP = {
    "GET /facturas p1 x30": ("/facturas", {"pagina": 1, "por_pagina": 30}),
    "GET /facturas proveedor=materiales": ("/facturas", {"proveedor": "materiales"}),
    "GET /resumen 2026": ("/resumen", {"desde": "2026-01-01", "hasta": "2026-12-31"}),
    "GET /exportar 2026": ("/exportar", {"desde": "2026-01-01", "hasta": "2026-12-31"}),
}


def medir(extra=False):
    eps = dict(ENDP)
    if extra:
        eps["GET /facturas p18 x30"] = ("/facturas", {"pagina": 18, "por_pagina": 30})
    res = {}
    for nombre, (ruta, q) in eps.items():
        ms, tam, errores, info = [], [], [], None
        for _ in range(REP):
            t = time.perf_counter()
            try:
                r = requests.get(BASE + ruta, params=q, headers=H, timeout=120)
                dt = (time.perf_counter() - t) * 1000
                ms.append(round(dt, 1)); tam.append(len(r.content))
                if r.status_code != 200:
                    errores.append(f"HTTP {r.status_code}")
                elif ruta == "/facturas":
                    j = r.json(); info = {k: j.get(k) for k in ("total", "pagina", "por_pagina", "paginas") if k in j}
                    info["items"] = len(j.get("facturas", j.get("items", j.get("data", []))) or [])
                elif ruta == "/resumen":
                    j = r.json(); info = {"total": j.get("total"), "num_facturas": j.get("num_facturas", j.get("n"))}
            except requests.Timeout:
                errores.append("timeout 120 s")
            except Exception as e:
                errores.append(type(e).__name__)
        res[nombre] = {"ms": ms, "mediana_ms": round(statistics.median(ms), 1) if ms else None,
                       "max_ms": max(ms) if ms else None, "bytes": tam[-1] if tam else None,
                       "errores": errores, "info": info}
        print(nombre, res[nombre]["mediana_ms"], res[nombre]["max_ms"], res[nombre]["bytes"], errores)
    return res


def cargar():
    return json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}


def guardar(d):
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def contar(m):
    return m.call("get_data_table_rows", {"dataTableId": FACT, "projectId": PROYECTO, "limit": 1}).get("count")


def filas_sinteticas():
    rnd = random.Random(20261015)
    m = MCP()
    cats = [x["nombre"] for x in m.call("get_data_table_rows", {"dataTableId": "wUG04k8qKHE1fL8A",
            "projectId": PROYECTO, "limit": 100}).get("rows") or []]
    ahora = datetime.now(timezone(timedelta(hours=2))).isoformat(timespec="milliseconds")
    ini, fin = date(2026, 1, 1), date(2026, 10, 14)
    span = (fin - ini).days
    assert len(cats) == 17, cats
    prov_cat = {p: cats[p % len(cats)] for p in range(1, 61)}
    filas = []
    for n in range(1, 521):
        p = (n - 1) % 60 + 1
        susc = rnd.random() < 0.10
        iva = rnd.choice([21, 21, 21, 10, 4])
        base = round(rnd.uniform(3, 900), 2) if not susc else round(rnd.uniform(5, 60), 2)
        cuota = round(base * iva / 100, 2)
        total = round(base + cuota, 2)
        f = ini + timedelta(days=rnd.randint(0, span))
        venc = min(f + timedelta(days=30), date(2026, 12, 31))
        filas.append({
            "usuario_id": "default", "hash_sha256": f"test-perf-{n:04d}", "archivo_ruta": None,
            "archivo_nombre": f"TEST_perf_{n:04d}.pdf", "mime": "application/pdf",
            "proveedor": f"TEST·Perf proveedor {p:03d}", "proveedor_norm": f"test perf proveedor {p:03d}",
            "nif": f"B{90000000 + p:08d}", "numero": f"PERF-{n:04d}",
            "fecha_emision": f.isoformat(), "fecha_vencimiento": venc.isoformat(),
            "lineas_json": json.dumps([{"descripcion": "Concepto sintético", "cantidad": 1,
                                        "precio_unitario": base, "importe": base}]),
            "base": base, "iva_tipo": iva, "iva_cuota": cuota, "total": total, "moneda": "EUR",
            "metodo_pago": "Tarjeta", "categoria": prov_cat[p], "subcategoria": None,
            "tipo_gasto": "suscripcion" if susc else "puntual", "periodicidad": "mensual" if susc else None,
            "confianza": 1, "motivo": "Fila sintética de rendimiento",
            "estado": "revisar" if rnd.random() < 0.05 else "ok",
            "errores_validacion": None, "origen_categoria": "manual", "creado": ahora, "actualizado": ahora})
    return m, filas


fase = sys.argv[1]
d = cargar()
if fase == "antes":
    d["antes"] = {"fecha": datetime.now().isoformat(timespec="seconds"), "filas": contar(MCP()), "medidas": medir()}
elif fase == "insertar":
    m, filas = filas_sinteticas()
    previo = contar(m)
    for i in range(0, len(filas), 100):
        m.call("add_data_table_rows", {"dataTableId": FACT, "projectId": PROYECTO, "rows": filas[i:i + 100]})
        print("lote", i // 100 + 1, "ok")
    final = contar(m)
    d["insercion"] = {"filas_previas": previo, "insertadas": len(filas), "filas_finales": final,
                      "suscripciones": sum(f["tipo_gasto"] == "suscripcion" for f in filas),
                      "revisar": sum(f["estado"] == "revisar" for f in filas),
                      "rango_fechas": [min(f["fecha_emision"] for f in filas), max(f["fecha_emision"] for f in filas)],
                      "nota": "Filas TEST·Perf: se borran con FACT — TEMP auditoría: borrar TEST"}
    print(d["insercion"])
elif fase == "despues":
    d["despues"] = {"fecha": datetime.now().isoformat(timespec="seconds"), "filas": contar(MCP()),
                    "medidas": medir(extra=True)}
guardar(d)
