"""Prueba FASE 4b (etapa 2) de «FACT — Mi dinero»: deudas y préstamos (GET/POST/PATCH/DELETE /deudas, POST /deudas/simular, GET /deudas/resumen)
contra un cálculo INDEPENDIENTE en Python (Fraction y céntimos enteros, sin reutilizar el JS). Crea el cliente «TEST·Deudas» y sus deudas/ingresos;
al terminar borra deudas e ingresos por la API y el cliente con «FACT — TEMP auditoría: borrar TEST». Deja tests/salida/caso_deudas.json (paridad web = n8n).
Uso: .venv\\Scripts\\python tests\\probar_deudas.py  (sin Gemini; N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations

import calendar
import json
import sys
import time
from datetime import date, timedelta
from fractions import Fraction
from pathlib import Path

import requests

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import Api, check, leer_env, resumen_final  # noqa: E402
from probar_mi_dinero import hoy_madrid  # noqa: E402
from mcp_cliente import MCP  # noqa: E402

TEMP_BORRAR = "MSwqgl62QaYcNj61"


def rnd(x: Fraction) -> int:
    return int((x + Fraction(1, 2)).__floor__())


def cent(x) -> int:
    return rnd(Fraction(str(x)) * 100)


def mas_meses(d: date, k: int, dia: int = 1) -> date:
    t = d.year * 12 + d.month - 1 + k
    y, m = t // 12, t % 12 + 1
    return date(y, m, min(dia, calendar.monthrange(y, m)[1]))


def cuota_francesa(cap: int, tae: str, n: int) -> int:
    r = Fraction(str(tae)) / 1200
    if r == 0:
        return rnd(Fraction(cap, n))
    return rnd(cap * r / (1 - (1 + r) ** (-n)))


def proyectar(saldo: int, tae: str, cuota: int):
    r = Fraction(str(tae)) / 1200
    meses = intereses = pagado = 0
    while saldo > 0 and meses < 1200:
        i = rnd(saldo * r)
        if r > 0 and cuota <= i:
            return dict(meses=meses, intereses=intereses, pagado=pagado, no_cubre=True)
        meses += 1
        intereses += i
        a = cuota - i
        if a >= saldo:
            pagado += saldo + i
            saldo = 0
        else:
            saldo -= a
            pagado += cuota
    return dict(meses=meses, intereses=intereses, pagado=pagado, no_cubre=False)


def esperado(d: dict, pagadas: int, hoy: date):
    cap, tae, n = cent(d["capital_inicial"]), str(d["tipo_interes_anual"]), d["plazo_meses"]
    teorica = cuota_francesa(cap, tae, n)
    cuota = cent(d["cuota_mensual"]) if d.get("cuota_mensual") else teorica
    r = Fraction(tae) / 1200
    saldo, int_pag = cap, 0
    for _ in range(pagadas):
        if saldo <= 0:
            break
        i = rnd(saldo * r)
        saldo -= max(min(cuota - i, saldo), 0)
        int_pag += i
    saldo_hoy = max(saldo - cent(d.get("amortizado_extra", 0)), 0)
    return dict(cap=cap, teorica=teorica, cuota=cuota, saldo=saldo_hoy, int_pag=int_pag, proy=proyectar(saldo_hoy, tae, cuota), tae=tae)


def main() -> int:
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    base = env["N8N_BASE_URL"] + "/webhook"
    m = MCP()
    hoy = hoy_madrid()
    primero = hoy.replace(day=1)
    ids_d: list[int] = []
    ids_ing: list[int] = []
    cid = None
    print("== preparar ==")
    try:
        r = requests.post(base + "/clientes", headers=api.h, json={"nombre": "TEST·Deudas", "nif": "", "regimen_iva": "particular"}, timeout=60)
        cid = r.json()["cliente"]["id"] if r.status_code == 201 else None
        check("cliente TEST creado", cid is not None, f"HTTP {r.status_code}")
        if cid is None:
            return resumen_final()
        ini = lambda k: mas_meses(primero, -k).isoformat()  # k cuotas pagadas (día de pago 1)
        defs = {
            "A": dict(nombre="TEST·Hipoteca", tipo="hipoteca", capital_inicial=100000, tipo_interes_anual=3, plazo_meses=360, fecha_inicio=ini(24), dia_pago=1, pagadas=24),
            "B": dict(nombre="TEST·Préstamo 0 %", tipo="prestamo", capital_inicial=1200, tipo_interes_anual=0, plazo_meses=12, fecha_inicio=ini(5), dia_pago=1, pagadas=5),
            "C": dict(nombre="TEST·Coche", tipo="coche", capital_inicial=15000, tipo_interes_anual=6.5, plazo_meses=60, cuota_mensual=300, amortizado_extra=1000, fecha_inicio=ini(10), dia_pago=1, pagadas=10),
            "D": dict(nombre="TEST·Tarjeta", tipo="tarjeta", capital_inicial=2000, tipo_interes_anual=20, plazo_meses=24, fecha_inicio=ini(3), dia_pago=1, pagadas=3),
            "E": dict(nombre="TEST·Cuota corta", tipo="otro", capital_inicial=10000, tipo_interes_anual=12, plazo_meses=60, cuota_mensual=50, fecha_inicio=ini(2), dia_pago=1, pagadas=2),
        }
        ids, calc = {}, {}
        print("== alta y cálculo contra Fraction ==")
        for k, x in defs.items():
            cuerpo = {a: b for a, b in x.items() if a != "pagadas"}
            r = requests.post(base + "/deudas", headers=api.h, json=dict(cuerpo, cliente_id=cid), timeout=60)
            ok = r.status_code == 201 and isinstance(r.json()["deuda"]["id"], int)
            check(f"POST /deudas {x['nombre']}", ok, f"HTTP {r.status_code} {r.text[:150] if not ok else ''}")
            if not ok:
                return resumen_final()
            ids[k] = r.json()["deuda"]["id"]
            ids_d.append(ids[k])
        lista = api.get("/deudas", cliente_id=cid).json()
        check("GET /deudas devuelve las 5", lista["total"] == 5 and [i["id"] for i in lista["items"]] == [ids[k] for k in "ABCDE"])
        res = {i["id"]: i for i in lista["items"]}
        for k, x in defs.items():
            e = esperado(x, x["pagadas"], hoy)
            got = res[ids[k]]
            ok = (cent(got["cuota_mensual"]) == e["cuota"] and cent(got["capital_pendiente"]) == e["saldo"] and cent(got["intereses_pagados"]) == e["int_pag"]
                  and got["cuotas_pagadas"] == x["pagadas"] and cent(got["intereses_por_pagar"]) == e["proy"]["intereses"])
            check(f"{x['nombre']}: cuota, pendiente, intereses pagados y por pagar", ok,
                  f"cuota {got['cuota_mensual']} vs {e['cuota'] / 100}, pend {got['capital_pendiente']} vs {e['saldo'] / 100}, int {got['intereses_por_pagar']} vs {e['proy']['intereses'] / 100}")
            if not e["proy"]["no_cubre"]:
                fin = mas_meses(primero, e["proy"]["meses"]).isoformat()
                check(f"{x['nombre']}: meses restantes y fecha de fin", got["meses_restantes"] == e["proy"]["meses"] and got["fecha_fin"] == fin, f"{got['meses_restantes']} {got['fecha_fin']} vs {e['proy']['meses']} {fin}")
        a = res[ids["A"]]
        check("cuota francesa conocida: 100.000 € al 3 % a 360 meses = 421,60 €", a["cuota_mensual"] == 421.60 and a["cuota_calculada"] == 421.60)
        b = res[ids["B"]]
        check("interés 0: cuota 100 €, pendiente 700 €, 0 intereses + aviso", b["cuota_mensual"] == 100 and b["capital_pendiente"] == 700 and b["intereses_por_pagar"] == 0 and any("sin intereses" in v for v in b["avisos"]))
        check("el último pago de B cierra en el mes 12", b["meses_restantes"] == 7 and b["pct_amortizado"] == 41.7)
        c = res[ids["C"]]
        check("cuota indicada distinta ⇒ aviso, y amortizado_extra resta del pendiente", c["cuota_indicada"] is True and any("difiere" in v for v in c["avisos"]) and c["amortizado_extra"] == 1000)
        check("tarjeta: aviso de modelo simplificado", any("Tarjeta" in v for v in res[ids["D"]]["avisos"]))
        e_ = res[ids["E"]]
        check("cuota que no cubre intereses: aviso y sin plazo", e_["meses_restantes"] is None and e_["fecha_fin"] is None and any("no cubre los intereses" in v for v in e_["avisos"]))
        check("próximo vencimiento = día 1 del mes siguiente", a["proximo_vencimiento"]["fecha"] == mas_meses(primero, 1).isoformat())

        print("== simulación de amortización extra ==")
        ea = esperado(defs["A"], 24, hoy)
        for tipo in ("reducir_plazo", "reducir_cuota"):
            r = requests.post(base + "/deudas/simular", headers=api.h, params={"id": ids["A"]}, json={"amortizacion_extra": 10000, "tipo": tipo}, timeout=60)
            ok = r.status_code == 200
            check(f"simular {tipo} 200", ok, f"HTTP {r.status_code} {r.text[:150] if not ok else ''}")
            if not ok:
                continue
            s = r.json()
            nuevo = ea["saldo"] - 1000000
            n_rest = ea["proy"]["meses"]
            cuota_n = cuota_francesa(nuevo, "3", n_rest) if tipo == "reducir_cuota" else ea["cuota"]
            p = proyectar(nuevo, "3", cuota_n)
            check(f"{tipo}: ahorro de intereses", cent(s["ahorro_intereses"]) == ea["proy"]["intereses"] - p["intereses"], f"{s['ahorro_intereses']} vs {(ea['proy']['intereses'] - p['intereses']) / 100}")
            check(f"{tipo}: nuevo plazo y cuota", s["despues"]["meses_restantes"] == p["meses"] and cent(s["despues"]["cuota_mensual"]) == cuota_n and s["meses_ahorrados"] == n_rest - p["meses"])
            check(f"{tipo}: antes = estado actual", s["antes"]["meses_restantes"] == n_rest and cent(s["antes"]["capital_pendiente"]) == ea["saldo"])
        for nombre, cuerpo in (("importe 0", {"amortizacion_extra": 0}), ("importe texto", {"amortizacion_extra": "abc"}), ("tipo inválido", {"amortizacion_extra": 10, "tipo": "x"}), ("supera el pendiente", {"amortizacion_extra": 999999})):
            check(f"simular 422 {nombre}", requests.post(base + "/deudas/simular", headers=api.h, params={"id": ids["A"]}, json=cuerpo, timeout=60).status_code == 422)
        check("simular 422 con cuota que no amortiza", requests.post(base + "/deudas/simular", headers=api.h, params={"id": ids["E"]}, json={"amortizacion_extra": 100}, timeout=60).status_code == 422)
        check("simular 404 deuda inexistente", requests.post(base + "/deudas/simular", headers=api.h, params={"id": 999999}, json={"amortizacion_extra": 100}, timeout=60).status_code == 404)

        print("== resumen: carga mensual y vencimientos ==")
        r = requests.post(base + "/ingresos", headers=api.h, json={"cliente_id": cid, "tipo": "nomina", "concepto": "TEST·Nómina", "importe": 2000, "periodicidad": "mensual", "fecha_inicio": ini(12)}, timeout=60)
        if r.status_code == 201:
            ids_ing.append(r.json()["ingreso"]["id"])
        # E no cubre intereses pero sigue vigente (cuota 50)
        vig = ["A", "B", "C", "D", "E"]
        carga = sum(esperado(defs[k], defs[k]["pagadas"], hoy)["cuota"] for k in vig)
        rs = api.get("/deudas/resumen", cliente_id=cid).json()
        check("carga mensual = Σ cuotas vigentes", cent(rs["carga_mensual"]) == carga, f"{rs['carga_mensual']} vs {carga / 100}")
        pct = Fraction(carga * 1000, 200000)
        check("% sobre ingresos del mes y aviso > 35 %", rs["pct_ingresos"] == rnd(pct) / 10 and rs["supera_limite"] is True and any("35" in v for v in rs["avisos"]), str(rs["pct_ingresos"]))
        cap_tot = sum(esperado(defs[k], defs[k]["pagadas"], hoy)["saldo"] for k in vig)
        check("capital pendiente total", cent(rs["capital_pendiente"]) == cap_tot)
        lim = (hoy + timedelta(days=30)).isoformat()
        prox_f = mas_meses(primero, 1).isoformat()
        check("próximos vencimientos a 30 días (E, sin plazo calculable, no aparece)", (len(rs["proximos_vencimientos"]) == 4) == (prox_f <= lim) and all(v["fecha"] == prox_f for v in rs["proximos_vencimientos"]))
        for k in ("A", "C", "E"):
            requests.patch(base + "/deudas", headers=api.h, params={"id": ids[k]}, json={"activa": False}, timeout=60)
        rs2 = api.get("/deudas/resumen", cliente_id=cid).json()
        carga2 = sum(esperado(defs[k], defs[k]["pagadas"], hoy)["cuota"] for k in ("B", "D"))
        check("deudas inactivas no cuentan; sin aviso por debajo del 35 %", cent(rs2["carga_mensual"]) == carga2 and rs2["supera_limite"] is False and rs2["avisos"] == [], f"{rs2['carga_mensual']} {rs2['avisos']}")

        print("== PATCH, DELETE y errores ==")
        r = requests.patch(base + "/deudas", headers=api.h, params={"id": ids["B"]}, json={"amortizado_extra": 300}, timeout=60)
        check("PATCH amortizado_extra recalcula el pendiente", r.status_code == 200 and r.json()["deuda"]["capital_pendiente"] == 400, r.text[:150])
        for nombre, cuerpo, cod in (("tipo inválido", {"tipo": "x"}, 422), ("capital 0", {"capital_inicial": 0}, 422), ("interés 101", {"tipo_interes_anual": 101}, 422), ("plazo 0", {"plazo_meses": 0}, 422),
                                    ("fecha mala", {"fecha_inicio": "2025-13-01"}, 422), ("campo desconocido", {"foo": 1}, 400), ("cuerpo vacío", {}, 400), ("extra > capital", {"amortizado_extra": 5000}, 422)):
            check(f"PATCH {nombre} ⇒ {cod}", requests.patch(base + "/deudas", headers=api.h, params={"id": ids["B"]}, json=cuerpo, timeout=60).status_code == cod)
        check("POST sin nombre ⇒ 422", requests.post(base + "/deudas", headers=api.h, json={"cliente_id": cid, "tipo": "otro"}, timeout=60).status_code == 422)
        check("POST cliente inexistente ⇒ 404", requests.post(base + "/deudas", headers=api.h, json=dict(cuerpo, cliente_id=99999), timeout=60).status_code == 404)
        check("GET sin cliente_id ⇒ 400", api.get("/deudas").status_code == 400)
        check("GET cliente inexistente ⇒ 404", api.get("/deudas", cliente_id=99999).status_code == 404)
        check("PATCH id inexistente ⇒ 404", requests.patch(base + "/deudas", headers=api.h, params={"id": 999999}, json={"activa": True}, timeout=60).status_code == 404)
        check("DELETE sin id ⇒ 400", requests.delete(base + "/deudas", headers=api.h, timeout=60).status_code == 400)
        check("403 sin clave", requests.get(base + "/deudas", params={"cliente_id": cid}, timeout=30).status_code == 403)
        o = requests.options(base + "/deudas", headers={"Origin": "null", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-api-key"}, timeout=30)
        check("CORS preflight Origin null", o.headers.get("Access-Control-Allow-Origin") == "null")
        caso_items = api.get("/deudas", cliente_id=cid).json()
        caso = dict(hoy=hoy.isoformat(), cliente={"id": cid, "nombre": "TEST·Deudas", "regimen_iva": "particular"},
                    deudas=[{k: v for k, v in x.items() if k not in ("calculo",)} for x in []],
                    ingresos=api.get("/ingresos", cliente_id=cid).json()["items"], esperado_lista=caso_items, esperado_resumen=api.get("/deudas/resumen", cliente_id=cid).json(), ids=ids,
                    sim=requests.post(base + "/deudas/simular", headers=api.h, params={"id": ids["A"]}, json={"amortizacion_extra": 10000, "tipo": "reducir_cuota"}, timeout=60).json())
        caso["deudas"] = [{"id": x["id"], "cliente_id": cid, "nombre": x["nombre"], "tipo": x["tipo"], "capital_inicial": x["capital_inicial"], "tipo_interes_anual": x["tipo_interes_anual"], "plazo_meses": x["plazo_meses"],
                           "fecha_inicio": x["fecha_inicio"], "cuota_mensual": x["cuota_mensual"] if x["cuota_indicada"] else None, "dia_pago": x["dia_pago"], "amortizado_extra": x["amortizado_extra"], "activa": x["activa"]} for x in caso_items["items"]]
        (AQUI / "salida").mkdir(exist_ok=True)
        (AQUI / "salida" / "caso_deudas.json").write_text(json.dumps(caso, ensure_ascii=False), encoding="utf-8")
        d = requests.delete(base + "/deudas", headers=api.h, params={"id": ids["D"]}, timeout=60)
        check("DELETE borra", d.status_code == 200 and d.json()["borrado"] is True and all(i["id"] != ids["D"] for i in api.get("/deudas", cliente_id=cid).json()["items"]))
        ids_d.remove(ids["D"])
    finally:
        print("== limpiar ==")
        for i in ids_d:
            api.delete("/deudas", id=i)
        for i in ids_ing:
            api.delete("/ingresos", id=i)
        if cid is not None:
            r = m.call("execute_workflow", {"workflowId": TEMP_BORRAR, "executionMode": "manual"})
            ex = str(r.get("executionId"))
            estado = None
            for _ in range(60):
                e = m.call("get_workflow_execution", {"workflowId": TEMP_BORRAR, "executionId": ex})
                estado = (e.get("execution") or e).get("status")
                if estado in ("success", "error", "crashed", "canceled"):
                    break
                time.sleep(1)
            check("borrado TEST (cliente)", estado == "success", str(estado))
    return resumen_final()


if __name__ == "__main__":
    sys.exit(main())
