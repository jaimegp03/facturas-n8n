"""Prueba FASE 4b (etapa 1) de «FACT — Mi dinero»: GET /renta contra un cálculo INDEPENDIENTE en Python (céntimos enteros, sin reutilizar el JS).
Crea el cliente «TEST·Renta», facturas TEST_RENTA_* (MCP) e ingresos; al terminar borra ingresos por la API y facturas+cliente con «FACT — TEMP auditoría: borrar TEST».
Escribe tests/salida/caso_renta.json (lo usa tests/e2e/renta.spec.js para la paridad web = n8n).
Uso: .venv\\Scripts\\python tests\\probar_renta.py  (sin Gemini; N8N_MCP_TOKEN en el entorno)"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
sys.path.insert(0, str(AQUI / "auditoria"))
from probar_api import Api, check, leer_env, resumen_final  # noqa: E402
from probar_mi_dinero import hoy_madrid  # noqa: E402
from mcp_cliente import MCP, PROYECTO  # noqa: E402

TEMP_BORRAR = "MSwqgl62QaYcNj61"
T_FACT = "7PLB3ZEQRDVYx6iD"


def cent(x) -> int:
    return int(round(float(x) * 100))


def coma(c: int) -> str:
    return f"{'-' if c < 0 else ''}{abs(c) // 100},{abs(c) % 100:02d}"


def dma(iso: str) -> str:
    return f"{iso[8:]}/{iso[5:7]}/{iso[:4]}"


def main() -> int:
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    base = env["N8N_BASE_URL"] + "/webhook"
    m = MCP()
    hoy = hoy_madrid()
    ids_ing: list[int] = []
    cid = None
    print("== preparar ==")
    try:
        r = requests.post(base + "/clientes", headers=api.h, json={"nombre": "TEST·Renta", "nif": "", "regimen_iva": "particular"}, timeout=60)
        cid = r.json()["cliente"]["id"] if r.status_code == 201 else None
        check("cliente TEST creado", cid is not None, f"HTTP {r.status_code}")
        if cid is None:
            return resumen_final()
        ok_ = "TEST/x.pdf"
        # (categoría, proveedor, importe, fecha, estado, extra)
        F_ = [
            ("Hogar", "TEST·Ferretería", 100, "2025-03-10", "ok", {}),
            ("Hogar", "TEST·Ferretería", 200, "2025-06-10", "ok", {}),
            ("Salud y farmacia", "TEST·Farmacia", 50, "2025-02-02", "ok", {}),
            ("Seguros", "TEST·Aseguradora", 120, "2025-05-01", "revisar", {}),
            ("Formación", "TEST·Academia", 300, "2025-09-01", "ok", {"archivo_ruta": None}),
            ("Alquileres", "TEST·Casero, S.L.", 600, "2025-01-05", "ok", {"irpf_cuota": 90, "nif": "B12345674"}),
            ("Otros", "TEST·Fundación Esperanza", 40, "2025-12-20", "ok", {}),
            ("Hogar", "TEST·Bricolaje", 25, "2025-04-04", "ok", {"nif_valido": False}),
            ("Otros", "TEST·USA Inc", 30, "2025-08-08", "ok", {"moneda": "USD", "total_eur": None}),
            ("Hogar", "TEST·Borrada", 999, "2025-08-09", "borrada", {}),
            ("Hogar", "TEST·Antigua", 77, "2024-12-31", "ok", {}),
            ("Hogar", "TEST·Reciente", 61.5, "2026-02-03", "ok", {}),
            ("Hogar", "TEST·Duplicada", 15, "2025-10-10", "posible_duplicada", {}),
        ]
        filas, facts = [], []
        for i, (cat, prov, imp, fe, est, ex) in enumerate(F_):
            row = {"usuario_id": "default", "cliente_id": cid, "archivo_nombre": f"TEST_RENTA_{i:02d}", "archivo_ruta": ok_, "proveedor": prov,
                   "proveedor_norm": prov.lower().replace("·", "").replace(",", "").replace(".", ""), "categoria": cat, "total": imp, "total_eur": imp, "moneda": "EUR",
                   "fecha_emision": fe, "tipo_gasto": "puntual", "estado": est, "numero": f"R{i:03d}", "nif": "", "irpf_cuota": 0, "nif_valido": True}
            row.update(ex)
            filas.append(row)
            facts.append(row)
        m.call("add_data_table_rows", {"dataTableId": T_FACT, "projectId": PROYECTO, "rows": filas})
        for ing in (dict(tipo="nomina", concepto="TEST·Nómina", importe=2000, periodicidad="mensual", fecha_inicio="2025-03-01"),
                    dict(tipo="extra", concepto="TEST·Extra", importe=1200, periodicidad="anual", fecha_inicio="2025-07-01", fecha_fin="2025-12-31"),
                    dict(tipo="otros", concepto="TEST·Premio", importe=500, periodicidad="puntual", fecha_inicio="2025-05-10")):
            r = requests.post(base + "/ingresos", headers=api.h, json=dict(ing, cliente_id=cid), timeout=60)
            check(f"ingreso {ing['concepto']}", r.status_code == 201, f"HTTP {r.status_code}")
            if r.status_code == 201:
                ids_ing.append(r.json()["ingreso"]["id"])
        r = requests.put(base + "/presupuestos", headers=api.h, json={"cliente_id": cid, "presupuestos": [{"categoria": "Hogar", "limite_mensual": 300}]}, timeout=60)
        check("presupuesto TEST", r.status_code == 200, f"HTTP {r.status_code}")

        # ---------------- esperado independiente (2025)
        validas = [f for f in facts if f["estado"] in ("ok", "revisar", "posible_duplicada") and f["fecha_emision"][:4] == "2025" and f["moneda"] == "EUR"]
        gasto = sum(cent(f["total"]) for f in validas)
        porcat: dict[str, int] = {}
        for f in validas:
            porcat[f["categoria"]] = porcat.get(f["categoria"], 0) + cent(f["total"])
        ing_nomina = 2000 * 10 * 100  # marzo..diciembre
        ing_extra = 100 * 100 * 6  # 1200/12 en jul..dic
        ing_otros = 500 * 100
        ing_total = ing_nomina + ing_extra + ing_otros
        ret = sum(cent(f["irpf_cuota"]) for f in validas)

        print("== GET /renta 2025 ==")
        r = api.get("/renta", cliente_id=cid, anio=2025)
        check("200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:150] if r.status_code != 200 else ''}")
        d = r.json()
        check("ingresos totales", cent(d["ingresos"]["total"]) == ing_total, f"{d['ingresos']['total']} vs {ing_total / 100}")
        pt = {x["tipo"]: cent(x["total"]) for x in d["ingresos"]["por_tipo"]}
        check("ingresos por tipo", pt == {"nomina": ing_nomina, "extra": ing_extra, "otros": ing_otros}, str(pt))
        nom = next((x for x in d["ingresos"]["detalle"] if x["tipo"] == "nomina"), {})
        check("nómina: 10 meses activos y anualizada", nom.get("meses_activos") == 10 and cent(nom.get("importe_anual", 0)) == ing_nomina)
        check("gasto total (sin borrada, sin otros años, USD sin cambio fuera)", cent(d["gasto"]["total"]) == gasto, f"{d['gasto']['total']} vs {gasto / 100}")
        check("nº de facturas", d["gasto"]["num_facturas"] == len(validas))
        check("gasto por categoría", {x["categoria"]: cent(x["total"]) for x in d["gasto"]["por_categoria"]} == porcat)
        suma_pct = sum(x["pct"] for x in d["gasto"]["por_categoria"])
        check("porcentajes ≈ 100", abs(suma_pct - 100) < 0.2, str(suma_pct))
        check("retenciones soportadas", cent(d["retenciones"]["irpf_soportado"]) == ret and d["retenciones"]["num_facturas"] == 1)
        ded = {x["id"]: cent(x["total"]) for x in d["posibles_deducciones"]}
        esperado_ded = {"alquiler": porcat["Alquileres"], "formacion": porcat["Formación"], "salud": porcat["Salud y farmacia"] + porcat["Seguros"], "donativos": 4000}
        check("posibles deducciones", ded == esperado_ded, str(ded))
        check("todas «a revisar con tu gestor»", all(x["a_revisar"] and "gestor" in x["etiqueta"] for x in d["posibles_deducciones"]))
        rev = {x["id"]: x["motivos"] for x in d["conviene_revisar"]}
        motivos = sorted(mm for ms in rev.values() for mm in ms)
        check("conviene revisar: 4 facturas con su motivo", len(rev) == 4 and any("sin archivo" in x for x in motivos) and any("NIF" in x for x in motivos) and any("revisar" in x for x in motivos), str(motivos))
        check("excluida USD sin cambio", len(d["excluidas_sin_cambio"]) == 1 and any("otra moneda" in a for a in d["avisos"]))
        check("aviso de retenciones de nómina", any("nómina" in a for a in d["avisos"]))
        hogar = next(x for x in d["presupuesto_anual"] if x["categoria"] == "Hogar")
        check("presupuesto anual Hogar", cent(hogar["limite_anual"]) == 360000 and cent(hogar["gastado"]) == porcat["Hogar"])
        check("aviso legal y texto", "orientativo" in d["aviso_legal"].lower() and "no presenta" in d["aviso_legal"].lower() and "orientativo" in d["texto"].lower() and "tu gestor" in d["texto"])
        check("texto con cifras", "21.100,00 €" in d["texto"] and f"{gasto // 100:,}".replace(",", ".") in d["texto"])
        # CSV
        csv = d["csv"]
        check("CSV con BOM", csv.startswith("﻿"))
        lin = csv[1:].split("\r\n")
        check("CSV cabecera", lin[0] == "Categoría;Fecha;Proveedor;NIF;Número;Total (EUR);Retención IRPF (EUR)", lin[0])
        check("CSV TOTAL", any(x == f"TOTAL;;;;;{coma(gasto)};{coma(ret)}" for x in lin), str(lin[-3:]))
        casero = next((x for x in lin if x.startswith("Alquileres;") and "Casero" in x), "")
        check("CSV fecha dd/mm/aaaa, coma decimal y NIF", dma("2025-01-05") in casero and ";600,00;90,00" in casero and "B12345674" in casero, casero)
        check("CSV una fila por factura + subtotales", sum(1 for x in lin if x and not x.startswith(("Subtotal", "TOTAL", "Categoría"))) == len(validas))
        check("nombre de CSV", d["csv_nombre"] == "Renta_2025_gastos.csv")

        print("== año por defecto, otros años y errores ==")
        esperado_def = hoy.year - 1 if hoy.month < 7 else hoy.year
        r = api.get("/renta", cliente_id=cid)
        check("año por defecto (antes de julio: el anterior)", r.status_code == 200 and r.json()["anio"] == esperado_def, str(r.json().get("anio")))
        r26 = api.get("/renta", cliente_id=cid, anio=2026).json()
        check("2026: solo la factura de 2026", cent(r26["gasto"]["total"]) == 6150 and cent(r26["ingresos"]["total"]) == 2000 * 12 * 100, f"{r26['gasto']['total']} {r26['ingresos']['total']}")
        r24 = api.get("/renta", cliente_id=cid, anio=2024).json()
        check("2024: 77 € y sin ingresos (aviso)", cent(r24["gasto"]["total"]) == 7700 and r24["ingresos"]["total"] == 0 and any("No hay ingresos" in a for a in r24["avisos"]))
        r23 = api.get("/renta", cliente_id=cid, anio=2023).json()
        check("año vacío: todo 0 y CSV solo cabecera+total", r23["gasto"]["total"] == 0 and r23["posibles_deducciones"] == [] and r23["conviene_revisar"] == [])
        check("400 sin cliente_id", api.get("/renta").status_code == 400)
        check("400 cliente_id no entero", api.get("/renta", cliente_id="x").status_code == 400)
        check("400 anio inválido", api.get("/renta", cliente_id=cid, anio="25").status_code == 400)
        check("400 parámetro desconocido", api.get("/renta", cliente_id=cid, foo=1).status_code == 400)
        check("404 cliente inexistente", api.get("/renta", cliente_id=99999).status_code == 404)
        check("403 sin clave", requests.get(base + "/renta", params={"cliente_id": cid}, timeout=30).status_code == 403)
        o = requests.options(base + "/renta", headers={"Origin": "null", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-api-key"}, timeout=30)
        check("CORS preflight Origin null", o.headers.get("Access-Control-Allow-Origin") == "null", str(o.headers.get("Access-Control-Allow-Origin")))

        categorias = api.get("/categorias").json()["items"]
        caso = dict(hoy=hoy.isoformat(), anio=2025, cliente={"id": cid, "nombre": "TEST·Renta", "regimen_iva": "particular"},
                    ingresos=api.get("/ingresos", cliente_id=cid).json()["items"],
                    presupuestos=[dict(p, cliente_id=cid, activo=True) for p in api.get("/presupuestos", cliente_id=cid).json()["items"]],
                    categorias=[dict(nombre=x["nombre"], orden=x["orden"], activa=True) for x in categorias],
                    facturas=api.get("/facturas", cliente_id=cid, por_pagina=200).json()["items"], esperado=d)
        (AQUI / "salida").mkdir(exist_ok=True)
        (AQUI / "salida" / "caso_renta.json").write_text(json.dumps(caso, ensure_ascii=False), encoding="utf-8")
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
    return resumen_final()


if __name__ == "__main__":
    sys.exit(main())
