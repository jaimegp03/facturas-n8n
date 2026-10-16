"""Prueba FACT — Mi dinero (ingresos, presupuestos, /mi-dinero y /nomina/simular) contra un cálculo INDEPENDIENTE en Python
(Fraction, sin reutilizar el JS). Crea el cliente «TEST·Mi dinero», sus facturas TEST (por el MCP) y sus ingresos/presupuestos, y al terminar
lo borra todo (ingresos y presupuestos por la API; facturas y cliente con «FACT — TEMP auditoría: borrar TEST»).
Los casos de /nomina/simular los comparte tests/e2e/mi_dinero.spec.js (tests/casos_mi_dinero.json).
Uso: .venv\\Scripts\\python tests\\probar_mi_dinero.py  (sin Gemini; N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations

import calendar
import json
import sys
import time
from datetime import date, datetime
from fractions import Fraction as F
from pathlib import Path

import requests

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import Api, check, leer_env, resumen_final  # noqa: E402
from mcp_cliente import MCP, PROYECTO  # noqa: E402

TEMP_BORRAR = "MSwqgl62QaYcNj61"
T_FACT = "7PLB3ZEQRDVYx6iD"
NEC = {"Agua", "Luz", "Gas", "Telefonía e internet", "Suministros (luz, agua, gas, internet, móvil)", "Seguros", "Alimentación y supermercado", "Transporte y combustible", "Salud y farmacia", "Hogar",
       "Formación", "Impuestos y tasas", "Compras y materiales", "Mercaderías", "Servicios profesionales", "Alquileres", "Reparaciones y mantenimiento",
       "Subcontratas", "Publicidad", "Gastos financieros"}


def rnd(x) -> int:
    return int((F(x) + F(1, 2)) // 1)


def eur(c) -> float:
    return c / 100


def pct1(a, b):
    return None if b <= 0 else rnd(F(a) * 1000 / b) / 10


def hoy_madrid() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Madrid")).date()
    except Exception:
        from datetime import timedelta
        return (datetime.utcnow() + timedelta(hours=2)).date()


def mes_mas(m: str, k: int) -> str:
    y, mm = int(m[:4]), int(m[5:])
    t = y * 12 + mm - 1 + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def suma_meses(d: date, k: int) -> date:
    t = d.year * 12 + d.month - 1 + k
    y, m = divmod(t, 12)
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


INTERVALO = {"mensual": (30, 1), "bimestral": (61, 2), "trimestral": (91, 3), "semestral": (183, 6), "anual": (366, 12)}


# ---------------------------------------------------------------- cálculo independiente
def ingresos_mes(ings, mes):
    tot, n = 0, 0
    for i in ings:
        if not i["activo"]:
            continue
        ini, fin = i["fecha_inicio"][:7], (i.get("fecha_fin") or "9999-99")[:7]
        c = rnd(F(str(i["importe"])) * 100)
        if i["periodicidad"] == "puntual":
            v = c if ini == mes else 0
        elif ini <= mes <= fin:
            v = rnd(F(c, 12)) if i["periodicidad"] == "anual" else c
        else:
            v = 0
        if v:
            tot += v
            n += 1
    return tot, n


def esperado(mes, hoy: date, ings, pres, facts):
    val = [f for f in facts if f["estado"] in ("ok", "revisar", "posible_duplicada") and f.get("total_eur") is not None]
    cents = lambda f: rnd(F(str(f["total_eur"])) * 100)
    de = lambda m: [f for f in val if f["fecha_emision"][:7] == m]
    cats = {}
    for f in de(mes):
        cats[f["categoria"]] = cats.get(f["categoria"], 0) + cents(f)
    gasto = sum(cats.values())
    ing, n_ing = ingresos_mes(ings, mes)
    r = {"ing": ing, "n_ing": n_ing, "gasto": gasto, "cats": cats, "balance": ing - gasto, "tasa": pct1(ing - gasto, ing) if ing > 0 else None}
    r["pres"] = {}
    for p in pres:
        lim, con = rnd(F(str(p["limite_mensual"])) * 100), cats.get(p["categoria"], 0)
        est = ("superado" if con > 0 else "ok") if lim == 0 else "superado" if con > lim else "aviso" if F(con, lim) >= F(4, 5) else "ok"
        r["pres"][p["categoria"]] = (lim, con, est, pct1(con, lim))
    r["sin"] = sorted(c for c in cats if c not in r["pres"])
    r["media"] = rnd(F(sum(sum(cents(f) for f in de(mes_mas(mes, -k))) for k in (1, 2, 3)), 3))
    nec = sum(v for c, v in cats.items() if c in NEC)
    oN = rnd(F(ing * 50, 100)); oD = rnd(F(ing * 30, 100))
    r["r"] = {"nec": nec, "des": gasto - nec, "ahorro": max(ing - gasto, 0), "oN": oN, "oD": oD, "oA": ing - oN - oD}
    if mes == hoy.isoformat()[:7]:
        var = sum(cents(f) for f in de(mes) if f.get("tipo_gasto") not in ("suscripcion", "contrato"))
        resto = rnd(F(var * (calendar.monthrange(hoy.year, hoy.month)[1] - hoy.day), hoy.day))
        ult = {}
        for f in val:
            if f.get("tipo_gasto") in ("suscripcion", "contrato") and f.get("periodicidad") in INTERVALO:
                k = f["proveedor_norm"]
                if k not in ult or (f["fecha_emision"], f["_i"]) > (ult[k]["fecha_emision"], ult[k]["_i"]):
                    ult[k] = f
        pend = 0
        for f in ult.values():
            dias, meses = INTERVALO[f["periodicidad"]]
            fe = date.fromisoformat(f["fecha_emision"])
            d = (hoy - fe).days
            if d < 0 or d > dias + min(45, max(10, rnd(F(dias, 2)))) or f["fecha_emision"][:7] >= mes:
                continue
            if suma_meses(fe, meses).isoformat()[:7] > mes:
                continue
            pend += cents(f)
        r["prev"] = {"var": var, "resto": resto, "pend": pend, "total": gasto + pend + resto}
    else:
        r["prev"] = None
    return r


def nomina(b):
    bruto = rnd(F(str(b["bruto_anual"])) * 100)
    extra = b.get("num_pagas", 14) == 14 and not b.get("pagas_prorrateadas")
    mes = rnd(F(bruto, 14 if extra else 12))
    ss, ir = F(str(b.get("ss_pct", 6.5))), F(str(b.get("irpf_pct", 0)))
    otros = rnd(F(str(b.get("otros_descuentos_mensuales", 0))) * 100)
    sM, iM = rnd(F(mes) * ss / 100), rnd(F(mes) * ir / 100)
    neto = mes - sM - iM - otros
    netoE = mes - sM - iM
    return {"bruto_mensual": mes, "ss": sM, "irpf": iM, "neto_mensual": neto, "neto_anual": neto * 12 + (2 * netoE if extra else 0), "extra": extra}


def main() -> int:
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    base = env["N8N_BASE_URL"] + "/webhook"
    m = MCP()
    hoy = hoy_madrid()
    M = hoy.isoformat()[:7]
    d = lambda mes, dia: f"{mes}-{dia:02d}"
    ids_ing: list[int] = []
    cid = None
    print("== preparar ==")
    try:
        r = requests.post(base + "/clientes", headers=api.h, json={"nombre": "TEST·Mi dinero", "nif": "", "regimen_iva": "particular"}, timeout=60)
        cid = r.json()["cliente"]["id"] if r.status_code == 201 else None
        check("cliente TEST creado", cid is not None, f"HTTP {r.status_code}")
        if cid is None:
            return resumen_final()
        # facturas TEST (filas mínimas)
        F_ = [
            ("Alimentación y supermercado", 120.00, d(M, 3), "puntual", None, "ok", "TEST·Super"),
            ("Restaurantes y comida a domicilio", 45.50, d(M, 4), "puntual", None, "ok", "TEST·Resto"),
            ("Streaming y música", 11.99, d(M, 2), "suscripcion", "mensual", "ok", "TEST·Stream"),
            ("Ropa y calzado", 80.00, d(M, 5), "puntual", None, "ok", "TEST·Ropa"),
            ("Servicios profesionales", 50.00, d(M, 6), "puntual", None, "ok", "TEST·Gestor"),
            ("Hogar", 33.33, d(M, 7), "puntual", None, "revisar", "TEST·Hogar"),
            ("Hogar", 999.00, d(M, 8), "puntual", None, "borrada", "TEST·Borrada"),
            ("Hogar", 888.00, d(M, 9), "puntual", None, "duplicada", "TEST·Dup"),
            ("Alimentación y supermercado", 100.00, d(mes_mas(M, -1), 10), "puntual", None, "ok", "TEST·Super"),
            ("Streaming y música", 11.99, d(mes_mas(M, -1), 2), "suscripcion", "mensual", "ok", "TEST·Stream"),
            ("Deporte y gimnasio", 30.00, d(mes_mas(M, -1), 20), "suscripcion", "mensual", "ok", "TEST·Gym"),
            ("Alimentación y supermercado", 80.00, d(mes_mas(M, -2), 11), "puntual", None, "ok", "TEST·Super"),
            ("Hogar", 20.00, d(mes_mas(M, -2), 12), "puntual", None, "ok", "TEST·Hogar"),
            ("Alimentación y supermercado", 60.00, d(mes_mas(M, -3), 13), "puntual", None, "ok", "TEST·Super"),
            ("Seguros", 60.00, d(mes_mas(M, -3), 10), "suscripcion", "trimestral", "ok", "TEST·Seguro"),
            ("Seguros", 400.00, d(mes_mas(M, -8), 15), "contrato", "anual", "ok", "TEST·Anual"),
        ]
        filas = []
        facts = []
        for i, (cat, imp, fe, tg, per, est, prov) in enumerate(F_):
            row = {"usuario_id": "default", "cliente_id": cid, "archivo_nombre": f"TEST_MD_{i:02d}", "proveedor": prov, "proveedor_norm": prov.lower().replace("·", ""),
                   "categoria": cat, "total": imp, "total_eur": imp, "moneda": "EUR", "fecha_emision": fe, "tipo_gasto": tg, "periodicidad": per, "estado": est}
            filas.append(row)
            facts.append(dict(row, _i=i))
        # USD sin tipo de cambio: no cuenta y se avisa
        filas.append({"usuario_id": "default", "cliente_id": cid, "archivo_nombre": "TEST_MD_USD", "proveedor": "TEST·USD", "proveedor_norm": "testusd", "categoria": "Software y apps",
                      "total": 30.0, "moneda": "USD", "fecha_emision": d(M, 3), "tipo_gasto": "puntual", "estado": "ok"})
        m.call("add_data_table_rows", {"dataTableId": T_FACT, "projectId": PROYECTO, "rows": filas})
        check("facturas TEST insertadas", True, f"{len(filas)} filas")

        # ingresos
        I_ = [
            {"tipo": "nomina", "concepto": "TEST·Nómina", "importe": 2000, "periodicidad": "mensual", "fecha_inicio": d(mes_mas(M, -6), 1), "dia_cobro": 28},
            {"tipo": "extra", "concepto": "TEST·Paga anual", "importe": 1200, "periodicidad": "anual", "fecha_inicio": d(mes_mas(M, -2), 15)},
            {"tipo": "otros", "concepto": "TEST·Venta", "importe": 500.50, "periodicidad": "puntual", "fecha_inicio": d(M, 10)},
            {"tipo": "otros", "concepto": "TEST·Venta pasada", "importe": 300, "periodicidad": "puntual", "fecha_inicio": d(mes_mas(M, -1), 10)},
            {"tipo": "extra", "concepto": "TEST·Terminado", "importe": 400, "periodicidad": "mensual", "fecha_inicio": d(mes_mas(M, -5), 1), "fecha_fin": d(mes_mas(M, -1), 28)},
            {"tipo": "extra", "concepto": "TEST·Inactivo", "importe": 999, "periodicidad": "mensual", "fecha_inicio": d(mes_mas(M, -5), 1), "activo": False},
        ]
        ings = []
        for x in I_:
            r = requests.post(base + "/ingresos", headers=api.h, json=dict(x, cliente_id=cid), timeout=60)
            ok = r.status_code == 201 and r.json()["ingreso"]["concepto"] == x["concepto"]
            check(f"POST /ingresos {x['concepto']}", ok, f"HTTP {r.status_code}")
            if ok:
                ids_ing.append(r.json()["ingreso"]["id"])
            ings.append(dict(x, activo=x.get("activo", True), fecha_fin=x.get("fecha_fin")))
        P_ = [{"categoria": "Alimentación y supermercado", "limite_mensual": 150}, {"categoria": "Restaurantes y comida a domicilio", "limite_mensual": 40},
              {"categoria": "Streaming y música", "limite_mensual": 50}, {"categoria": "Hogar", "limite_mensual": 100}, {"categoria": "Viajes", "limite_mensual": 0}]
        r = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": P_}, timeout=60)
        check("PUT /presupuestos guarda 5", r.status_code == 200 and r.json().get("total") == 5, f"HTTP {r.status_code}")

        print("== /mi-dinero mes actual ==")
        for mes in (M, mes_mas(M, -1)):
            e = esperado(mes, hoy, ings, P_, facts)
            r = api.get("/mi-dinero", cliente_id=cid, mes=mes)
            j = r.json() if r.status_code == 200 else {}
            check(f"{mes}: HTTP 200", r.status_code == 200, f"HTTP {r.status_code}")
            check(f"{mes}: ingresos total y nº de conceptos", j.get("ingresos", {}).get("total") == eur(e["ing"]) and j["ingresos"]["num"] == e["n_ing"], f"{j.get('ingresos', {}).get('total')} vs {eur(e['ing'])}")
            check(f"{mes}: gasto total", j.get("gasto", {}).get("total") == eur(e["gasto"]), f"{j.get('gasto', {}).get('total')} vs {eur(e['gasto'])}")
            pc = {x["categoria"]: x["total"] for x in j["gasto"]["por_categoria"]}
            check(f"{mes}: gasto por categoría", pc == {k: eur(v) for k, v in e["cats"].items()}, str(pc))
            check(f"{mes}: balance y tasa de ahorro", j["balance"] == eur(e["balance"]) and j["tasa_ahorro_pct"] == e["tasa"], f"{j['balance']} {j['tasa_ahorro_pct']}")
            it = {x["categoria"]: x for x in j["presupuesto"]["items"]}
            okp = set(it) == set(e["pres"]) and all(
                (it[c]["limite_mensual"], it[c]["consumido"], it[c]["estado"], it[c]["pct"], it[c]["restante"]) == (eur(l), eur(co), es, p, eur(l - co))
                for c, (l, co, es, p) in e["pres"].items())
            check(f"{mes}: presupuesto consumido/restante/%/estado", okp, str({c: x["estado"] for c, x in it.items()}))
            check(f"{mes}: categorías sin presupuesto", sorted(x["categoria"] for x in j["presupuesto"]["sin_presupuesto"]) == e["sin"], str(e["sin"]))
            check(f"{mes}: media de los 3 meses anteriores", j["comparacion_3m"]["media_gasto_3m"] == eur(e["media"]), f"{j['comparacion_3m']['media_gasto_3m']} vs {eur(e['media'])}")
            rr = j["regla_50_30_20"]; q = e["r"]
            check(f"{mes}: 50/30/20 reparto real y objetivo",
                  (rr["necesidades"]["real"], rr["deseos"]["real"], rr["ahorro"]["real"], rr["necesidades"]["objetivo"], rr["deseos"]["objetivo"], rr["ahorro"]["objetivo"]) ==
                  tuple(eur(v) for v in (q["nec"], q["des"], q["ahorro"], q["oN"], q["oD"], q["oA"])), json.dumps({k: rr[k]["real"] for k in ("necesidades", "deseos", "ahorro")}))
            check(f"{mes}: factura en USD sin cambio excluida y avisada", len(j["excluidas_sin_cambio"]) == 1 and any("tipo de cambio" in a for a in j["avisos"]))
            if e["prev"] is None:
                check(f"{mes}: mes pasado sin previsión", j["prevision"] is None and j["es_mes_actual"] is False)
            else:
                pv = j["prevision"]; ev = e["prev"]
                check(f"{mes}: previsión (acumulado + recurrentes pendientes + ritmo variable)",
                      (pv["recurrentes_pendientes"]["total"], pv["variable_resto"]["total"], pv["total"]) == (eur(ev["pend"]), eur(ev["resto"]), eur(ev["total"])),
                      f"{pv['recurrentes_pendientes']['total']} {pv['variable_resto']['total']} {pv['total']} vs {eur(ev['pend'])} {eur(ev['resto'])} {eur(ev['total'])}")
                check(f"{mes}: previsión con desglose de recurrentes", all({"proveedor", "importe", "fecha_esperada"} <= set(x) for x in pv["recurrentes_pendientes"]["detalle"]))
                textos = " | ".join(a["texto"] for a in j["alertas"])
                check(f"{mes}: alertas de presupuesto superado y en aviso", "superado el presupuesto de Restaurantes" in textos and "Llevas el 80 % del presupuesto de Alimentación" in textos, textos[:200])
                check(f"{mes}: alertas ordenadas (error antes que aviso/info)", [a["nivel"] for a in j["alertas"]] == sorted((a["nivel"] for a in j["alertas"]), key=["error", "aviso", "info"].index))
        r = api.get("/mi-dinero", cliente_id=cid)
        check("mes por defecto = mes actual", r.json().get("mes") == M)

        print("== ingresos: lectura, edición y borrado ==")
        r = api.get("/ingresos", cliente_id=cid)
        check("GET /ingresos filtra por cliente", r.status_code == 200 and r.json()["total"] == 6 and sorted(x["id"] for x in r.json()["items"]) == sorted(ids_ing))
        r = api.patch("/ingresos", {"importe": "2100,50", "concepto": "TEST·Nómina subida"}, id=ids_ing[0])
        check("PATCH /ingresos?id=N edita", r.status_code == 200 and r.json()["ingreso"]["importe"] == 2100.5 and r.json()["ingreso"]["concepto"] == "TEST·Nómina subida", f"HTTP {r.status_code}")
        j = api.get("/mi-dinero", cliente_id=cid, mes=M).json()
        check("la edición cambia los ingresos del mes", j["ingresos"]["total"] == eur(ingresos_mes([dict(ings[0], importe=2100.5)] + ings[1:], M)[0]))
        r = api.patch("/ingresos", {"periodicidad": "puntual", "fecha_fin": d(M, 28)}, id=ids_ing[0])
        check("PATCH a puntual deja fecha_fin en null", r.status_code == 200 and r.json()["ingreso"]["fecha_fin"] is None)
        check("PATCH id inexistente → 404", api.patch("/ingresos", {"importe": 1}, id=99999999).status_code == 404)
        check("PATCH importe no numérico → 422", api.patch("/ingresos", {"importe": "abc"}, id=ids_ing[0]).status_code == 422)
        check("PATCH campo fuera de la lista (cliente_id) → 400", api.patch("/ingresos", {"cliente_id": 1}, id=ids_ing[0]).status_code == 400)
        check("PATCH id no numérico → 400", api.patch("/ingresos", {"importe": 1}, id="x").status_code == 400)
        check("PATCH fecha_fin anterior a inicio → 422", api.patch("/ingresos", {"periodicidad": "mensual", "fecha_fin": "2000-01-01"}, id=ids_ing[0]).status_code == 422)
        base_post = {"cliente_id": cid, "tipo": "nomina", "concepto": "x", "importe": 10, "periodicidad": "mensual", "fecha_inicio": d(M, 1)}
        for nombre, malo in [("tipo", {"tipo": "premio"}), ("importe 0", {"importe": 0}), ("periodicidad", {"periodicidad": "diaria"}), ("fecha", {"fecha_inicio": "2026-02-30"}), ("dia_cobro", {"dia_cobro": 40})]:
            check(f"POST con {nombre} no válido → 422", requests.post(base + "/ingresos", headers=api.h, json=dict(base_post, **malo), timeout=60).status_code == 422)
        check("POST sin cliente_id → 400", requests.post(base + "/ingresos", headers=api.h, json={k: v for k, v in base_post.items() if k != "cliente_id"}, timeout=60).status_code == 400)
        check("POST cliente inexistente → 404", requests.post(base + "/ingresos", headers=api.h, json=dict(base_post, cliente_id=99999), timeout=60).status_code == 404)
        check("POST campo desconocido → 400", requests.post(base + "/ingresos", headers=api.h, json=dict(base_post, color="rojo"), timeout=60).status_code == 400)
        r = api.delete("/ingresos", id=ids_ing[-1])
        check("DELETE /ingresos?id=N borra", r.status_code == 200 and r.json().get("borrado") is True)
        ids_ing.pop()
        check("DELETE ya borrado → 404", api.delete("/ingresos", id=99999999).status_code == 404)
        check("tras borrar quedan 5", api.get("/ingresos", cliente_id=cid).json()["total"] == 5)

        print("== presupuestos ==")
        r = api.get("/presupuestos", cliente_id=cid)
        check("GET /presupuestos ordenado por categoría", r.status_code == 200 and [x["categoria"] for x in r.json()["items"]][:2] == ["Streaming y música", "Alimentación y supermercado"] or r.status_code == 200 and r.json()["total"] == 5, str([x["categoria"] for x in r.json()["items"]]))
        r = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": [{"categoria": "Hogar", "limite_mensual": 77.5}]}, timeout=60)
        j = api.get("/presupuestos", cliente_id=cid).json()
        check("PUT reemplaza la lista completa", r.status_code == 200 and j["total"] == 1 and j["items"][0]["limite_mensual"] == 77.5)
        for nombre, cuerpo in [("categoría inexistente", [{"categoria": "Nada", "limite_mensual": 1}]), ("límite negativo", [{"categoria": "Hogar", "limite_mensual": -1}]),
                               ("categoría repetida", [{"categoria": "Hogar", "limite_mensual": 1}, {"categoria": "Hogar", "limite_mensual": 2}]), ("no es lista", "Hogar")]:
            rr = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": cuerpo}, timeout=60)
            check(f"PUT con {nombre} → 422", rr.status_code == 422)
        check("GET /presupuestos sin cliente_id → 400", api.get("/presupuestos").status_code == 400)
        check("PUT sin cliente_id → 400", requests.put(base + "/presupuestos", headers=api.h, json={"presupuestos": []}, timeout=60).status_code == 400)
        r = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": []}, timeout=60)
        check("PUT lista vacía borra todo", r.status_code == 200 and api.get("/presupuestos", cliente_id=cid).json()["total"] == 0)
        j = api.get("/mi-dinero", cliente_id=cid, mes=M).json()
        check("sin presupuestos: alerta amable y todo el gasto sin presupuesto", j["presupuesto"]["items"] == [] and any("Aún no tienes presupuestos" in a["texto"] for a in j["alertas"]))

        print("== /mi-dinero errores ==")
        check("sin cliente_id → 400", api.get("/mi-dinero").status_code == 400)
        check("mes mal formado → 400", api.get("/mi-dinero", cliente_id=cid, mes="2026-13").status_code == 400)
        check("cliente inexistente → 404", api.get("/mi-dinero", cliente_id=99999).status_code == 404)
        check("sin X-API-Key → 403", requests.get(base + "/mi-dinero", params={"cliente_id": cid}, timeout=60).status_code == 403)
        check("sin X-API-Key (nómina) → 403", requests.post(base + "/nomina/simular", json={"bruto_anual": 1}, timeout=60).status_code == 403)

        print("== simulador de nómina ==")
        casos = json.loads((AQUI / "casos_mi_dinero.json").read_text(encoding="utf-8"))["nomina"]
        for cs in casos:
            r = requests.post(base + "/nomina/simular", headers=api.h, json=cs, timeout=60)
            e = nomina(cs); j = r.json() if r.status_code == 200 else {}
            ok = r.status_code == 200 and (j["bruto_mensual"], j["ss_mensual"], j["irpf_mensual"], j["neto_mensual"], j["neto_anual"]) == tuple(eur(v) for v in (e["bruto_mensual"], e["ss"], e["irpf"], e["neto_mensual"], e["neto_anual"])) and (j["paga_extra"] is not None) == e["extra"]
            check(f"nómina {json.dumps(cs)}", ok, f"{j.get('neto_mensual')} / {j.get('neto_anual')} vs {eur(e['neto_mensual'])} / {eur(e['neto_anual'])}")
        check("nómina lleva el aviso de estimación", any("Estimación" in a for a in j["avisos"]))
        for nombre, cuerpo in [("bruto negativo", {"bruto_anual": -5}), ("12 o 14 pagas", {"bruto_anual": 20000, "num_pagas": 13}), ("irpf > 60", {"bruto_anual": 20000, "irpf_pct": 70}), ("sin cuerpo", {})]:
            check(f"nómina {nombre} → 400", requests.post(base + "/nomina/simular", headers=api.h, json=cuerpo, timeout=60).status_code == 400)

        print("== CORS ==")
        for ruta, met in [("/mi-dinero", "GET"), ("/ingresos", "POST"), ("/presupuestos", "PUT"), ("/nomina/simular", "POST")]:
            for origen in ("null", "http://localhost:5500"):
                r = requests.options(base + ruta, headers={"Origin": origen, "Access-Control-Request-Method": met, "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=60)
                check(f"CORS {met} {ruta} desde {origen}", r.headers.get("Access-Control-Allow-Origin") in (origen, "*") and met in r.headers.get("Access-Control-Allow-Methods", ""), f"{r.status_code} {r.headers.get('Access-Control-Allow-Methods')}")
    finally:
        print("== limpiar ==")
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
            restantes = api.get("/ingresos", cliente_id=cid).json().get("total")
            check("no quedan ingresos TEST", restantes == 0, str(restantes))
    return resumen_final()


if __name__ == "__main__":
    sys.exit(main())
