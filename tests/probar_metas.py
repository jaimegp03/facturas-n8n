"""Prueba FASE 4a de «FACT — Mi dinero»: metas de ahorro (GET/POST/PATCH/DELETE /metas, POST /metas/aportar) y GET /resumen-mensual
contra un cálculo INDEPENDIENTE en Python (enteros en céntimos, sin reutilizar el JS). Crea el cliente «TEST·Metas», sus facturas TEST (MCP),
ingresos, presupuestos y metas, y al terminar lo borra (metas, ingresos y presupuestos por la API; facturas y cliente con «FACT — TEMP auditoría: borrar TEST»).
Los casos de la paridad web = n8n los comparte tests/e2e/metas.spec.js (tests/casos_metas.json, que escribe este script).
Uso: .venv\\Scripts\\python tests\\probar_metas.py  (sin Gemini; N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations

import calendar
import json
import math
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import Api, check, leer_env, resumen_final  # noqa: E402
from probar_mi_dinero import hoy_madrid, mes_mas, suma_meses  # noqa: E402
from mcp_cliente import MCP, PROYECTO  # noqa: E402

TEMP_BORRAR = "MSwqgl62QaYcNj61"
T_FACT = "7PLB3ZEQRDVYx6iD"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def rnd(x) -> int:
    return math.floor(x + 0.5)


def cent(x) -> int:
    return int(round(float(x) * 100))


def pct1(a, b):
    return None if b <= 0 else math.floor(a * 1000 / b + 0.5) / 10


def fmt(c: int) -> str:
    s = f"{abs(c) / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−" if c < 0 else "") + s + " €"


def meses_entre(hoy: date, f: str) -> int:
    return int(f[:4]) * 12 + int(f[5:7]) - (hoy.year * 12 + hoy.month)


# ---------------------------------------------------------------- cálculo independiente
def metas_esperadas(metas, ritmo, hoy: date):
    """metas: dicts con id, importe_objetivo, importe_ahorrado, fecha_objetivo, prev (o None), activa. ritmo en céntimos o None."""
    hoy_s = hoy.isoformat()
    base = {}
    for m in metas:
        obj, ah = cent(m["importe_objetivo"]), cent(m["importe_ahorrado"])
        rest = max(obj - ah, 0)
        conseg = ah >= obj
        venc = m["fecha_objetivo"] < hoy_s
        meses = 0 if venc else max(meses_entre(hoy, m["fecha_objetivo"]), 0)
        nec = 0 if conseg else rest if venc else -(-rest // max(meses, 1))
        prev = None if m.get("prev") is None else cent(m["prev"])
        base[m["id"]] = dict(m=m, obj=obj, ah=ah, rest=rest, conseg=conseg, venc=venc, meses=meses, nec=nec, prev=prev, asig=None)
    libre = None if ritmo is None else max(ritmo, 0)
    act = sorted([b for b in base.values() if b["m"]["activa"] and not b["conseg"]], key=lambda b: (b["m"]["fecha_objetivo"], b["m"]["id"]))
    for b in act:
        if b["prev"] is not None:
            b["asig"] = b["prev"]
            if libre is not None:
                libre = max(libre - b["prev"], 0)
        elif libre is not None:
            b["asig"] = min(b["nec"], libre)
            libre -= b["asig"]
    out = {}
    for i, b in base.items():
        if b["conseg"]:
            est = "conseguida"
        elif not b["m"]["activa"]:
            est = "pausada"
        elif b["venc"]:
            est = "atrasada"
        elif b["asig"] is None:
            est = "justa"
        else:
            est = "en_camino" if b["asig"] >= b["nec"] else "justa" if b["asig"] * 100 >= b["nec"] * 80 else "atrasada"
        fe = None
        if not b["conseg"] and b["m"]["activa"] and b["asig"]:
            fe = suma_meses(hoy, -(-b["rest"] // b["asig"])).isoformat()
        pct = pct1(min(b["ah"], b["obj"]), b["obj"])
        out[i] = dict(restante=b["rest"] / 100, pct=pct, meses=b["meses"], nec=b["nec"] / 100, asig=None if b["asig"] is None else b["asig"] / 100, estado=est, fecha_estimada=fe)
    suma_nec = sum(b["nec"] for b in act)
    return out, suma_nec


def main() -> int:
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    base = env["N8N_BASE_URL"] + "/webhook"
    m = MCP()
    hoy = hoy_madrid()
    M = hoy.isoformat()[:7]
    d = lambda mes, dia: f"{mes}-{dia:02d}"
    ids_meta: list[int] = []
    ids_ing: list[int] = []
    cid = None
    print("== preparar ==")
    try:
        r = requests.post(base + "/clientes", headers=api.h, json={"nombre": "TEST·Metas", "nif": "", "regimen_iva": "particular"}, timeout=60)
        cid = r.json()["cliente"]["id"] if r.status_code == 201 else None
        check("cliente TEST creado", cid is not None, f"HTTP {r.status_code}")
        if cid is None:
            return resumen_final()
        # (categoría, importe, fecha, tipo_gasto, periodicidad, estado, proveedor, extra)
        F_ = [
            ("Hogar", 1000, d(mes_mas(M, -3), 5), "puntual", None, "ok", "TEST·Hogar", {}),
            ("Hogar", 1400, d(mes_mas(M, -2), 5), "puntual", None, "ok", "TEST·Hogar", {}),
            ("Hogar", 1200, d(mes_mas(M, -1), 5), "puntual", None, "ok", "TEST·Hogar", {}),
            ("Streaming y música", 10, d(mes_mas(M, -1), 2), "suscripcion", "mensual", "ok", "TEST·Stream", {}),
            ("Hogar", 300, d(M, 3), "puntual", None, "ok", "TEST·Hogar", {}),
            ("Alimentación y supermercado", 150, d(M, 4), "puntual", None, "ok", "TEST·Super", {}),
            ("Streaming y música", 12, d(M, 2), "suscripcion", "mensual", "ok", "TEST·Stream", {}),
            ("Ropa y calzado", 40, d(M, 6), "puntual", None, "ok", "TEST·Ropa", {}),
            ("Hogar", 25, d(M, 7), "puntual", None, "revisar", "TEST·Hogar", {}),
            ("Seguros", 90, d(M, 1), "puntual", None, "ok", "TEST·Seguro", {"fecha_vencimiento": (hoy + timedelta(days=5)).isoformat(), "estado_pago": "pendiente"}),
            ("Seguros", 70, d(M, 1), "puntual", None, "ok", "TEST·Pagada", {"fecha_vencimiento": (hoy + timedelta(days=3)).isoformat(), "estado_pago": "pagada"}),
            ("Seguros", 60, d(M, 1), "puntual", None, "ok", "TEST·Lejana", {"fecha_vencimiento": (hoy + timedelta(days=20)).isoformat(), "estado_pago": "pendiente"}),
            ("Hogar", 999, d(M, 8), "puntual", None, "borrada", "TEST·Borrada", {}),
        ]
        filas, facts = [], []
        for i, (cat, imp, fe, tg, per, est, prov, ex) in enumerate(F_):
            row = {"usuario_id": "default", "cliente_id": cid, "archivo_nombre": f"TEST_META_{i:02d}", "proveedor": prov, "proveedor_norm": prov.lower().replace("·", ""),
                   "categoria": cat, "total": imp, "total_eur": imp, "moneda": "EUR", "fecha_emision": fe, "tipo_gasto": tg, "periodicidad": per, "estado": est}
            row.update(ex)
            filas.append(row)
            facts.append(dict(row, _i=i))
        m.call("add_data_table_rows", {"dataTableId": T_FACT, "projectId": PROYECTO, "rows": filas})
        r = requests.post(base + "/ingresos", headers=api.h, json={"cliente_id": cid, "tipo": "nomina", "concepto": "TEST·Nómina", "importe": 2000, "periodicidad": "mensual",
                                                                    "fecha_inicio": d(mes_mas(M, -6), 1)}, timeout=60)
        if r.status_code == 201:
            ids_ing.append(r.json()["ingreso"]["id"])
        check("ingreso TEST creado", r.status_code == 201, f"HTTP {r.status_code}")
        pres = [{"categoria": "Hogar", "limite_mensual": 300}, {"categoria": "Alimentación y supermercado", "limite_mensual": 190}, {"categoria": "Streaming y música", "limite_mensual": 15}]
        r = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": pres}, timeout=60)
        check("presupuestos TEST", r.status_code == 200, f"HTTP {r.status_code}")

        validas = [f for f in facts if f["estado"] in ("ok", "revisar", "posible_duplicada")]
        gasto = lambda mes: sum(cent(f["total"]) for f in validas if f["fecha_emision"][:7] == mes)
        ingreso = lambda mes: 200000 if mes >= mes_mas(M, -6) else 0
        ahorros = [ingreso(mes_mas(M, -k)) - gasto(mes_mas(M, -k)) for k in (1, 2, 3)]
        ritmo = rnd(sum(ahorros) / 3)

        print("== metas: alta, errores y cálculo ==")
        fut = lambda k: suma_meses(hoy, k).isoformat()
        defs = {
            "A": dict(nombre="TEST·Conseguida", importe_objetivo=500, importe_ahorrado=500, fecha_objetivo=fut(6)),
            "B": dict(nombre="TEST·En camino", importe_objetivo=2400, fecha_objetivo=fut(12)),
            "C": dict(nombre="TEST·Justa", importe_objetivo=1200, fecha_objetivo=fut(6), aportacion_mensual_prevista=170),
            "D": dict(nombre="TEST·Atrasada", importe_objetivo=1000, importe_ahorrado=100, fecha_objetivo=fut(3), aportacion_mensual_prevista=50),
            "E": dict(nombre="TEST·Grande", importe_objetivo=12000, fecha_objetivo=fut(24)),
            "F": dict(nombre="TEST·Pausada", importe_objetivo=300, fecha_objetivo=fut(5), activa=False),
        }
        ids = {}
        for k, x in defs.items():
            r = requests.post(base + "/metas", headers=api.h, json=dict(x, cliente_id=cid), timeout=60)
            ok = r.status_code == 201 and r.json()["meta"]["nombre"] == x["nombre"] and isinstance(r.json()["meta"]["id"], int)
            check(f"POST /metas {x['nombre']}", ok, f"HTTP {r.status_code} {r.text[:120] if not ok else ''}")
            if ok:
                ids[k] = r.json()["meta"]["id"]
                ids_meta.append(ids[k])
        if len(ids) != 6:
            return resumen_final()
        r = requests.patch(base + "/metas", headers=api.h, params={"id": ids["D"]}, json={"fecha_objetivo": (hoy - timedelta(days=10)).isoformat()}, timeout=60)
        check("PATCH fecha pasada (meta vencida)", r.status_code == 200 and r.json()["meta"]["estado"] == "atrasada", f"HTTP {r.status_code}")
        r = requests.post(base + "/metas/aportar", headers=api.h, params={"id": ids["B"]}, json={"importe": 100}, timeout=60)
        check("aportar 100", r.status_code == 200 and r.json()["meta"]["importe_ahorrado"] == 100 and r.json()["aportado"] == 100, f"HTTP {r.status_code}")
        r = requests.post(base + "/metas/aportar", headers=api.h, params={"id": ids["B"]}, json={"importe": -30.5}, timeout=60)
        check("retirar 30,50", r.status_code == 200 and r.json()["meta"]["importe_ahorrado"] == 69.5, f"HTTP {r.status_code} {r.text[:100]}")
        for nombre, imp in [("retirar más de lo ahorrado", -1000), ("importe 0", 0), ("importe no numérico", "abc"), ("importe null", None)]:
            rr = requests.post(base + "/metas/aportar", headers=api.h, params={"id": ids["B"]}, json={"importe": imp}, timeout=60)
            check(f"aportar {nombre} → 422", rr.status_code == 422, f"HTTP {rr.status_code}")
        check("aportar a meta inexistente → 404", requests.post(base + "/metas/aportar", headers=api.h, params={"id": 999999}, json={"importe": 5}, timeout=60).status_code == 404)

        j = api.get("/metas", cliente_id=cid).json()
        metas = [dict(id=ids["A"], importe_objetivo=500, importe_ahorrado=500, fecha_objetivo=defs["A"]["fecha_objetivo"], prev=None, activa=True),
                 dict(id=ids["B"], importe_objetivo=2400, importe_ahorrado=69.5, fecha_objetivo=defs["B"]["fecha_objetivo"], prev=None, activa=True),
                 dict(id=ids["C"], importe_objetivo=1200, importe_ahorrado=0, fecha_objetivo=defs["C"]["fecha_objetivo"], prev=170, activa=True),
                 dict(id=ids["D"], importe_objetivo=1000, importe_ahorrado=100, fecha_objetivo=(hoy - timedelta(days=10)).isoformat(), prev=50, activa=True),
                 dict(id=ids["E"], importe_objetivo=12000, importe_ahorrado=0, fecha_objetivo=defs["E"]["fecha_objetivo"], prev=None, activa=True),
                 dict(id=ids["F"], importe_objetivo=300, importe_ahorrado=0, fecha_objetivo=defs["F"]["fecha_objetivo"], prev=None, activa=False)]
        esp, suma_nec = metas_esperadas(metas, ritmo, hoy)
        check("GET /metas: 6 metas", j["total"] == 6 and len(j["items"]) == 6)
        check("ahorro mensual libre = media de 3 meses", j["resumen"]["ahorro_mensual_libre"] == ritmo / 100, f"{j['resumen']['ahorro_mensual_libre']} vs {ritmo / 100}")
        por_id = {x["id"]: x for x in j["items"]}
        for k in "ABCDEF":
            x, e = por_id[ids[k]], esp[ids[k]]
            ok = (x["restante"], x["pct_conseguido"], x["meses_restantes"], x["aportacion_necesaria"], x["aportacion_asignada"], x["estado"], x["fecha_estimada"]) == \
                 (e["restante"], e["pct"], e["meses"], e["nec"], e["asig"], e["estado"], e["fecha_estimada"])
            check(f"meta {k} ({e['estado']}) = cálculo independiente", ok, f"{x['estado']} {x['restante']} {x['pct_conseguido']} {x['aportacion_necesaria']} {x['aportacion_asignada']} {x['fecha_estimada']} vs {e}")
        check("estados: conseguida, en_camino, justa, atrasada, pausada", {esp[ids[k]]["estado"] for k in "ABCDF"} == {"conseguida", "en_camino", "justa", "atrasada", "pausada"})
        asignado = sum((x["aportacion_asignada"] or 0) for x in j["items"] if x["activa"])
        check("sin doble contabilidad: asignado ≤ ahorro libre + previstas", asignado <= ritmo / 100 + 220 + 0.01, f"{asignado}")
        check("suma de necesarias = cálculo independiente", j["resumen"]["suma_aportaciones_necesarias"] == suma_nec / 100 and j["resumen"]["cubre"] is False, f"{j['resumen']['suma_aportaciones_necesarias']} vs {suma_nec / 100}")
        check("avisa si no alcanza", any("no alcanza" in a for a in j["resumen"]["avisos"]))

        print("== metas: validaciones ==")
        P = lambda cuerpo, **kw: requests.post(base + "/metas", headers=api.h, json=cuerpo, timeout=60, **kw)
        ok_ = dict(nombre="TEST·X", importe_objetivo=100, fecha_objetivo=fut(2), cliente_id=cid)
        check("objetivo 0 → 422", P(dict(ok_, importe_objetivo=0)).status_code == 422)
        check("objetivo texto → 422", P(dict(ok_, importe_objetivo="mucho")).status_code == 422)
        check("fecha pasada al crear → 422", P(dict(ok_, fecha_objetivo=(hoy - timedelta(days=1)).isoformat())).status_code == 422)
        check("fecha hoy al crear → 422", P(dict(ok_, fecha_objetivo=hoy.isoformat())).status_code == 422)
        check("fecha mal formada → 422", P(dict(ok_, fecha_objetivo="2030-02-30")).status_code == 422)
        check("nombre vacío → 422", P(dict(ok_, nombre="  ")).status_code == 422)
        check("activa no booleana → 422", P(dict(ok_, activa="si")).status_code == 422)
        check("ahorrado negativo → 422", P(dict(ok_, importe_ahorrado=-1)).status_code == 422)
        check("campo desconocido → 400", P(dict(ok_, color="rojo")).status_code == 400)
        check("cuerpo vacío → 400", P({}).status_code == 400)
        check("sin cliente_id → 400", P({k: v for k, v in ok_.items() if k != "cliente_id"}).status_code == 400)
        check("cliente inexistente → 404", P(dict(ok_, cliente_id=99999)).status_code == 404)
        check("PATCH objetivo negativo → 422", requests.patch(base + "/metas", headers=api.h, params={"id": ids["B"]}, json={"importe_objetivo": -5}, timeout=60).status_code == 422)
        check("PATCH sin id → 400", requests.patch(base + "/metas", headers=api.h, json={"nombre": "x"}, timeout=60).status_code == 400)
        check("PATCH id inexistente → 404", requests.patch(base + "/metas", headers=api.h, params={"id": 999999}, json={"nombre": "x"}, timeout=60).status_code == 404)
        check("PATCH id no numérico → 400", requests.patch(base + "/metas", headers=api.h, params={"id": "abc"}, json={"nombre": "x"}, timeout=60).status_code == 400)
        check("DELETE id inexistente → 404", api.delete("/metas", id=999999).status_code == 404)
        check("GET /metas sin cliente_id → 400", api.get("/metas").status_code == 400)
        check("GET /metas cliente inexistente → 404", api.get("/metas", cliente_id=99999).status_code == 404)
        check("sin X-API-Key → 403", requests.get(base + "/metas", params={"cliente_id": cid}, timeout=60).status_code == 403)
        check("sin X-API-Key (resumen) → 403", requests.get(base + "/resumen-mensual", params={"cliente_id": cid}, timeout=60).status_code == 403)
        r = requests.patch(base + "/metas", headers=api.h, params={"id": ids["F"]}, json={"activa": True, "nombre": "TEST·Reactivada"}, timeout=60)
        check("PATCH reactiva y renombra", r.status_code == 200 and r.json()["meta"]["activa"] is True and r.json()["meta"]["nombre"] == "TEST·Reactivada", f"HTTP {r.status_code}")
        r = requests.patch(base + "/metas", headers=api.h, params={"id": ids["F"]}, json={"activa": False}, timeout=60)
        check("PATCH pausa de nuevo", r.status_code == 200 and r.json()["meta"]["estado"] == "pausada")

        print("== /resumen-mensual ==")
        mi, ma, mm3 = M, mes_mas(M, -1), [mes_mas(M, -k) for k in (1, 2, 3)]
        res = api.get("/resumen-mensual", cliente_id=cid, mes=M)
        check("resumen 200", res.status_code == 200, f"HTTP {res.status_code}")
        j = res.json()
        ing, gas, aho = 200000, gasto(M), 200000 - gasto(M)
        media = lambda f: rnd(sum(f(x) for x in mm3) / 3)
        check("ingresos del mes y anterior", j["ingresos"]["actual"] == ing / 100 and j["ingresos"]["mes_anterior"] == 2000 and j["ingresos"]["media_3m"] == media(ingreso) / 100)
        check("gasto del mes, anterior y media 3m", (j["gasto"]["actual"], j["gasto"]["mes_anterior"], j["gasto"]["media_3m"]) == (gas / 100, gasto(ma) / 100, media(gasto) / 100),
              f"{j['gasto']}")
        check("ahorro y tasa", j["ahorro"]["actual"] == aho / 100 and j["ahorro"]["tasa_ahorro_pct"] == pct1(aho, ing) and j["ahorro"]["media_3m"] == media(lambda x: ingreso(x) - gasto(x)) / 100,
              f"{j['ahorro']}")
        cats: dict[str, int] = {}
        for f in validas:
            if f["fecha_emision"][:7] == M:
                cats[f["categoria"]] = cats.get(f["categoria"], 0) + cent(f["total"])
        top = sorted(cats.items(), key=lambda kv: -kv[1])[:3]
        mediacat = lambda c: rnd(sum(cent(f["total"]) for f in validas if f["categoria"] == c and f["fecha_emision"][:7] in mm3) / 3)
        check("top 3 categorías y variación", [(t["categoria"], t["total"], t["media_3m"], t["variacion_pct"]) for t in j["top_categorias"]] ==
              [(c, v / 100, mediacat(c) / 100, pct1(v - mediacat(c), mediacat(c))) for c, v in top], str(j["top_categorias"]))
        check("presupuestos en riesgo: Hogar superado, Streaming aviso",
              sorted((p["categoria"], p["estado"]) for p in j["presupuestos_en_riesgo"]) == [("Hogar", "superado"), ("Streaming y música", "aviso")], str(j["presupuestos_en_riesgo"]))
        check("facturas por revisar = 1", j["facturas_por_revisar"]["num"] == 1)
        check("vencimientos: solo la impagada de los próximos 15 días", len(j["vencimientos_15_dias"]) == 1 and j["vencimientos_15_dias"][0]["importe"] == 90 and j["vencimientos_15_dias"][0]["proveedor"] == "TEST·Seguro",
              str(j["vencimientos_15_dias"]))
        check("suscripción que sube (10 → 12)", [(s["proveedor"], s["anterior"], s["actual"], s["diferencia"]) for s in j["suscripciones_subida"]] == [("TEST·Stream", 10, 12, 2)], str(j["suscripciones_subida"]))
        check("5 metas activas con estado", len(j["metas"]) == 5 and {x["estado"] for x in j["metas"]} >= {"conseguida", "en_camino", "justa", "atrasada"})
        lineas = j["texto"].split("\n")
        check("texto de 6 a 10 líneas", 6 <= len(lineas) <= 10 and j["lineas"] == len(lineas), str(len(lineas)))
        check("texto con cifras formateadas y sin undefined/NaN", fmt(ing) in j["texto"] and fmt(gas) in j["texto"] and "undefined" not in j["texto"] and "NaN" not in j["texto"])
        check("texto cabecera con mes y cliente", lineas[0] == f"Resumen de {MESES[int(M[5:]) - 1]} {M[:4]} · TEST·Metas", lineas[0])
        r0 = api.get("/resumen-mensual", cliente_id=cid, mes="2020-01")
        j0 = r0.json()
        check("mes sin datos: 200, sin_datos, texto amable", r0.status_code == 200 and j0["sin_datos"] is True and 6 <= j0["lineas"] <= 10 and j0["gasto"]["actual"] == 0 and j0["top_categorias"] == [])
        check("resumen sin mes = mes actual", api.get("/resumen-mensual", cliente_id=cid).json()["mes"] == M)
        check("resumen mes mal formado → 400", api.get("/resumen-mensual", cliente_id=cid, mes="2026-13").status_code == 400)
        check("resumen sin cliente_id → 400", api.get("/resumen-mensual").status_code == 400)
        check("resumen cliente inexistente → 404", api.get("/resumen-mensual", cliente_id=99999).status_code == 404)
        check("resumen parámetro desconocido → 400", api.get("/resumen-mensual", cliente_id=cid, x=1).status_code == 400)

        print("== CORS ==")
        for ruta, met in [("/metas", "GET"), ("/metas", "POST"), ("/metas", "PATCH"), ("/metas", "DELETE"), ("/metas/aportar", "POST"), ("/resumen-mensual", "GET")]:
            for origen in ("null", "http://localhost:5500"):
                r = requests.options(base + ruta, headers={"Origin": origen, "Access-Control-Request-Method": met, "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=60)
                check(f"CORS {met} {ruta} desde {origen}", r.headers.get("Access-Control-Allow-Origin") in (origen, "*") and met in r.headers.get("Access-Control-Allow-Methods", ""), f"{r.status_code}")

        print("== borrar ==")
        r = api.delete("/metas", id=ids["A"])
        check("DELETE /metas físico", r.status_code == 200 and r.json().get("borrado") is True)
        ids_meta.remove(ids["A"])
        check("la meta borrada ya no está", all(x["id"] != ids["A"] for x in api.get("/metas", cliente_id=cid).json()["items"]))
        # casos compartidos con la prueba de la web (paridad JS)
        caso = dict(hoy=hoy.isoformat(), mes=M, cliente={"id": cid, "nombre": "TEST·Metas"},
                    metas=[dict(id=x["id"], cliente_id=cid, nombre=x["nombre"], importe_objetivo=x["importe_objetivo"], importe_ahorrado=x["importe_ahorrado"], fecha_objetivo=x["fecha_objetivo"],
                                aportacion_mensual_prevista=x["aportacion_mensual_prevista"], activa=x["activa"], creada=x["creada"]) for x in api.get("/metas", cliente_id=cid).json()["items"]],
                    ingresos=api.get("/ingresos", cliente_id=cid).json()["items"],
                    presupuestos=[dict(p, cliente_id=cid, activo=True) for p in api.get("/presupuestos", cliente_id=cid).json()["items"]],
                    categorias=[dict(nombre=x["nombre"], orden=x["orden"], activa=True) for x in api.get("/categorias").json()["items"]],
                    facturas=api.get("/facturas", cliente_id=cid, por_pagina=200).json()["items"],
                    esperado_metas=api.get("/metas", cliente_id=cid).json(), esperado_resumen=api.get("/resumen-mensual", cliente_id=cid, mes=M).json())
        (AQUI / "salida").mkdir(exist_ok=True)
        (AQUI / "salida" / "caso_metas.json").write_text(json.dumps(caso, ensure_ascii=False), encoding="utf-8")
    finally:
        print("== limpiar ==")
        for i in ids_meta:
            api.delete("/metas", id=i)
        for i in ids_ing:
            api.delete("/ingresos", id=i)
        if cid is not None:
            requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": []}, timeout=60)
            r = m.call("execute_workflow", {"workflowId": TEMP_BORRAR, "executionMode": "manual"})
            ex = str(r.get("executionId"))
            estado = None
            for _ in range(60):
                e = m.call("get_workflow_execution", {"workflowId": TEMP_BORRAR, "executionId": ex})
                estado = (e.get("execution") or e).get("status")
                if estado in ("success", "error", "crashed", "canceled"):
                    break
                time.sleep(1)
            check("borrado TEST (facturas y cliente)", estado == "success", str(estado))
            restantes = api.get("/metas", cliente_id=cid)
            check("no quedan metas TEST (cliente borrado → 404 o 0)", restantes.status_code == 404)
    return resumen_final()


if __name__ == "__main__":
    sys.exit(main())
