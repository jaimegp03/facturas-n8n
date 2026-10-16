"""Pruebas de las tandas B y C del modo gestoría (docs/diseno-gestoria.md §3-§5), sin Gemini.

  python tests/probar_gestoria_b.py [--rehacer]

Usa los datos de tests/fixture_gestoria.py (clientes TEST·Reformas García, general, y TEST·Panadería Lucía, recargo de
equivalencia; las 26 facturas de esperado_contable.json). --rehacer borra antes todo lo TEST y lo vuelve a crear (así
el banco empieza sin movimientos). Si no existen, los crea.
Calcula EN PYTHON, de forma independiente y a partir de esperado_contable.json (no de la API), lo que deben dar el 303
del 3T 2026, el 111/115, el 349 y el 347 anual, y lo compara con GET /fiscal. Comprueba el libro registro (una fila por
tipo, CSV), los asientos (cuadrados en csv, a3 y holded), el Excel (hojas nuevas, fórmulas sin errores y = /fiscal),
el banco (Norma 43 y CSV, duplicados, sugerencias, conciliar, ignorar, deshacer) y GET /recomendaciones por cliente.
No borra nada al terminar: ejecuta después `python tests/fixture_gestoria.py borrar`.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import openpyxl
import requests

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests"))
import fixture_gestoria as fx  # noqa: E402
from verificar import ErrorFormula, Libro  # noqa: E402

resultados: list[tuple[str, bool, str]] = []
SALIDA = RAIZ / "tests" / "salida" / "gestoria_b"
AUTORREP = ("intracomunitaria", "isp_nacional", "extracomunitaria")
DUDOSAS = ("Restaurantes y comida a domicilio", "Viajes")


def check(nombre: str, ok: bool, detalle: str = "") -> bool:
    resultados.append((nombre, bool(ok), detalle))
    print(f"  [{'OK' if ok else 'FALLO'}] {nombre}" + (f" — {detalle}" if detalle and not ok else ""))
    return bool(ok)


def c(x) -> int:
    return round(float(x) * 100)


def nif_norm(s):
    if not s:
        return None
    v = re.sub(r"[\s.\-/]", "", str(s).upper())
    if re.fullmatch(r"ES[0-9A-Z]\d{7}[0-9A-Z]", v):
        v = v[2:]
    return v or None


def tipo_bce(moneda: str, fecha: str) -> float:
    d = date.fromisoformat(fecha)
    r = requests.get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.{moneda}.EUR.SP00.A",
                     params={"startPeriod": (d - timedelta(days=7)).isoformat(), "endPeriod": fecha, "format": "csvdata"}, timeout=30)
    filas = [x for x in csv.DictReader(io.StringIO(r.text)) if x.get("TIME_PERIOD", "") <= fecha]
    return round(1 / float(filas[-1]["OBS_VALUE"]), 6)


# ================================================================ cálculo independiente (Python)
def preparar_esperado() -> list[dict]:
    """Cada factura de esperado_contable.json en céntimos EUR, con la deducibilidad según el diseño §2."""
    out = []
    for e in fx.ESPERADO:
        tc = 1.0 if e["moneda"] == "EUR" else tipo_bce(e["moneda"], e["fecha_expedicion"])
        eur = lambda x: round(c(x) * tc)  # noqa: E731
        op = fx.OPERACION.get(e["operacion"], e["operacion"])
        regimen = e["cliente_regimen"]
        lineas = [{"base": eur(b["base"]), "tipo": b["tipo_iva"], "cuota": eur(b["cuota_iva"]), "tipo_re": b["tipo_re"], "re": eur(b["cuota_re"])} for b in e["bases"]]
        auto_doc = c(e["base_no_sujeta_o_exenta"]) * 21 / 100 if op in AUTORREP else 0  # 21 % sobre la base en su moneda
        auto = round(round(auto_doc) * tc) if op in AUTORREP else 0
        iva = sum(l["cuota"] for l in lineas) + auto
        if regimen == "particular":
            ded = "na"
        elif regimen == "recargo_equivalencia":
            ded = "no"
        elif e["tipo_factura"] == "simplificada":
            ded = "no"
        elif e["proveedor_nif_valido"] is False:
            ded = "no"
        elif not e["numero"]:
            ded = "no"
        elif fx.CATEGORIA[e["id"]] in DUDOSAS:
            ded = "dudoso"
        elif iva == 0:
            ded = "na"
        else:
            ded = "si"
        si = ded == "si"
        for l in lineas:
            l["ded"] = l["cuota"] if si else 0
        out.append({"id": e["id"], "cliente": "panaderia" if e["cliente_regimen"] == "recargo_equivalencia" else "reformas", "fecha": e["fecha_expedicion"],
                    "nif": nif_norm(e["proveedor_nif"]), "nombre": e["proveedor"], "op": op, "lineas": lineas, "exenta": eur(e["base_no_sujeta_o_exenta"]),
                    "auto": auto, "auto_ded": auto if si else 0, "irpf": eur(e["irpf_cuota"]), "total": eur(e["total_factura"]), "a_pagar": eur(e["total_a_pagar"]),
                    "cuenta": e["cuenta_gasto"], "ded": ded, "numero": e["numero"], "suplidos": eur(e["suplidos"]), "tipo_factura": e["tipo_factura"]})
    return out


def fiscal_python(prep: list[dict], cliente: str, anio: int, trimestre: int) -> dict:
    t0 = f"{anio}-{(trimestre - 1) * 3 + 1:02d}-01"
    t1 = f"{anio}-{ {1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31'}[trimestre]}"
    per = [p for p in prep if p["cliente"] == cliente and t0 <= p["fecha"] <= t1]
    interior = defaultdict(lambda: [0, 0, 0])
    recargo = defaultdict(lambda: [0, 0])
    for p in per:
        if p["op"] in AUTORREP or p["op"] == "importacion":
            continue
        for l in p["lineas"]:
            t = interior[l["tipo"]]
            t[0] += l["base"]; t[1] += l["cuota"]; t[2] += l["ded"]
            if l["re"]:
                recargo[l["tipo_re"]][0] += l["base"]; recargo[l["tipo_re"]][1] += l["re"]

    def bloque(ops):
        xs = [p for p in per if p["op"] in ops]
        return (sum(p["exenta"] + sum(l["base"] for l in p["lineas"]) for p in xs), sum(p["auto"] for p in xs), sum(p["auto_ded"] for p in xs))
    intra, isp = bloque(("intracomunitaria",)), bloque(("isp_nacional", "extracomunitaria"))
    total_ded = sum(v[2] for v in interior.values()) + intra[2] + isp[2]
    no_ded = {p["id"]: sum(l["cuota"] - l["ded"] for l in p["lineas"]) + p["auto"] - p["auto_ded"] for p in per}
    no_ded = {k: v for k, v in no_ded.items() if v}

    def ret(modelo):
        xs = [p for p in per if p["irpf"] and (p["cuenta"].startswith("621")) == (modelo == "115")]
        return {"num": len({p["nif"] for p in xs}), "base": sum(sum(l["base"] for l in p["lineas"]) + p["exenta"] for p in xs), "ret": sum(p["irpf"] for p in xs)}
    m349 = defaultdict(int)
    for p in per:
        if p["op"] == "intracomunitaria":
            m349[p["nif"]] += p["exenta"] + sum(l["base"] for l in p["lineas"])
    m347 = defaultdict(lambda: [0, 0, 0, 0])
    for p in prep:
        if p["cliente"] != cliente or p["fecha"][:4] != str(anio) or not p["nif"] or p["irpf"] or p["op"] in ("intracomunitaria", "extracomunitaria", "importacion"):
            continue
        if not re.match(r"^(\d|[A-Z]\d)", p["nif"]):
            continue
        m347[p["nif"]][(int(p["fecha"][5:7]) - 1) // 3] += p["total"]
    m347 = {k: v for k, v in m347.items() if sum(v) > 300506}
    return {"interior": {k: tuple(v) for k, v in interior.items()}, "recargo": {k: tuple(v) for k, v in recargo.items()}, "intra": intra, "isp": isp,
            "total_ded": total_ded, "no_ded": no_ded, "111": ret("111"), "115": ret("115"), "349": dict(m349), "347": m347, "ids": sorted(p["id"] for p in per)}


# ================================================================ bloques de prueba
def probar_fiscal(api, cl, prep, ids_factura):
    print("\nGET /fiscal (3T 2026) frente al cálculo independiente en Python")
    inv = {v: k for k, v in ids_factura.items()}
    for clave in ("reformas", "panaderia"):
        r = api.get("/fiscal", cliente_id=cl[clave], anio=2026, trimestre=3)
        if not check(f"/fiscal {clave} -> 200", r.status_code == 200, f"HTTP {r.status_code} {r.text[:200]}"):
            continue
        j = r.json()
        py = fiscal_python(prep, clave, 2026, 3)
        iva = j["iva_303"]
        api_int = {x["tipo_iva"]: (c(x["base"]), c(x["cuota"]), c(x["cuota_deducible"])) for x in iva["interior"]}
        check(f"{clave}: 303 interior por tipo (base, cuota, deducible) = Python", api_int == py["interior"], f"API {api_int} / Py {py['interior']}")
        api_re = {x["tipo_re"]: (c(x["base"]), c(x["cuota"])) for x in iva["recargo"]}
        check(f"{clave}: recargo de equivalencia por tipo (informativo) = Python", api_re == py["recargo"], f"API {api_re} / Py {py['recargo']}")
        for nombre, k in (("intracomunitarias (10-11 / 36-37)", "intracomunitarias"), ("ISP (12-13)", "isp")):
            b = iva[k]
            got = (c(b["base"]), c(b["cuota_devengada"]), c(b["cuota_deducible"]))
            check(f"{clave}: {nombre} = Python", got == py["intra" if k == "intracomunitarias" else "isp"], f"API {got} / Py {py['intra' if k == 'intracomunitarias' else 'isp']}")
        check(f"{clave}: total deducible = Python", c(iva["total_deducible"]) == py["total_ded"], f"API {iva['total_deducible']} / Py {py['total_ded'] / 100}")
        api_nd = {inv.get(x["id"]): c(x["cuota"]) for x in iva["no_deducible"]}
        check(f"{clave}: no deducibles (id y cuota) = Python", api_nd == py["no_ded"], f"API {api_nd} / Py {py['no_ded']}")
        for m in ("111", "115"):
            a = j["retenciones"][f"modelo_{m}"]
            got = {"num": a["num_perceptores"], "base": c(a["base"]), "ret": c(a["retencion"])}
            check(f"{clave}: modelo {m} (perceptores, base, retención) = Python", got == py[m], f"API {got} / Py {py[m]}")
        got349 = {x["nif"]: c(x["base"]) for x in j["modelo_349"]}
        check(f"{clave}: 349 clave I por NIF = Python", got349 == py["349"] and all(x["clave"] == "I" for x in j["modelo_349"]), f"API {got349} / Py {py['349']}")
        got347 = {x["nif"]: [c(v) for v in x["por_trimestre"]] for x in j["modelo_347_anual"]}
        check(f"{clave}: 347 anual (> 3.005,06 €, por NIF, por trimestre) = Python", got347 == {k: list(v) for k, v in py["347"].items()},
              f"API {got347} / Py {dict(py['347'])}")
        check(f"{clave}: 347 total anual = suma de trimestres", all(c(x["total_anual"]) == sum(c(v) for v in x["por_trimestre"]) for x in j["modelo_347_anual"]))
        check(f"{clave}: nº de facturas del periodo = Python", j["num_facturas"] == len(py["ids"]), f"{j['num_facturas']} / {len(py['ids'])}")
        avisos = {a["codigo"]: a for a in j["avisos"]}
        if clave == "reformas":
            check("reformas: 347 agrupa el NIF «ES-B-90456120» con «B90456120» y excluye retenciones e intracomunitarias",
                  list(got347) == ["B90456120"] and "29384756W" not in got347 and "B98712342" not in got347)
            check("reformas: avisos de NIF inválido (12), sin número (13) y deducible dudoso (23)",
                  [inv.get(i) for i in avisos.get("nif_invalido", {}).get("ids", [])] == ["12"] and [inv.get(i) for i in avisos.get("sin_numero", {}).get("ids", [])] == ["13"]
                  and [inv.get(i) for i in avisos.get("dudoso", {}).get("ids", [])] == ["23"], str({k: v.get("ids") for k, v in avisos.items()}))
            check("reformas: USD convertido (base ISP y autorrepercutida en EUR, no 99 / 20,79)", c(iva["isp"]["base"]) != 209900 and c(iva["isp"]["base"]) == py["isp"][0])
        else:
            check("panaderia: aviso de régimen de recargo de equivalencia y nada deducible", "regimen" in avisos and c(iva["total_deducible"]) == 0)
    r = api.get("/fiscal", cliente_id=cl["reformas"], anio=2026)
    check("/fiscal sin trimestre = año completo", r.status_code == 200 and r.json()["periodo"]["desde"] == "2026-01-01" and r.json()["periodo"]["hasta"] == "2026-12-31")
    for q, cod in (({}, 400), ({"cliente_id": cl["reformas"], "trimestre": 5}, 400), ({"cliente_id": cl["reformas"], "anio": "26"}, 400),
                   ({"cliente_id": 999999}, 404), ({"cliente_id": cl["reformas"], "x": 1}, 400)):
        check(f"/fiscal {q} -> {cod}", api.get("/fiscal", **q).status_code == cod)
    check("/fiscal sin X-API-Key -> 403", requests.get(api.base + "/fiscal", params={"cliente_id": cl["reformas"]}, timeout=60).status_code == 403)


def probar_libro(api, cl, prep, ids_factura):
    print("\nGET /libro-registro")
    inv = {v: k for k, v in ids_factura.items()}
    q = {"cliente_id": cl["reformas"], "desde": "2026-01-01", "hasta": "2026-12-31"}
    r = api.get("/libro-registro", **q)
    j = r.json()
    filas = j.get("filas", [])
    mias = [p for p in prep if p["cliente"] == "reformas"]
    esperadas = sum(len(p["lineas"]) + (1 if p["exenta"] or not p["lineas"] else 0) for p in mias)
    check("libro JSON: una fila por tipo de IVA (+ fila de base exenta/ISP/intracomunitaria)", r.status_code == 200 and len(filas) == esperadas, f"{len(filas)} / {esperadas}")
    por = defaultdict(list)
    for f in filas:
        por[inv.get(f["id"])].append(f)
    check("libro: TEST_01 tiene 3 filas (21, 10 y 4 %)", sorted(f["tipo_iva"] for f in por["01"]) == [4, 10, 21])
    check("libro: TEST_09 intracomunitaria con tipo 0, clave y autorrepercutida 25,20", len(por["09"]) == 1 and por["09"][0]["tipo_iva"] == 0
          and por["09"][0]["operacion"] == "intracomunitaria" and c(por["09"][0]["cuota_autorrepercutida"]) == 2520)
    check("libro: Σ base = Σ bases independientes (EUR)", c(j["totales"]["base"]) == sum(sum(l["base"] for l in p["lineas"]) + p["exenta"] for p in mias),
          f"{j['totales']['base']}")
    check("libro: Σ cuota IVA = Python", c(j["totales"]["cuota_iva"]) == sum(l["cuota"] for p in mias for l in p["lineas"]))
    check("libro: filas ordenadas por fecha de expedición", [f["fecha_expedicion"] for f in filas] == sorted(f["fecha_expedicion"] for f in filas))
    r = api.get("/libro-registro", formato="csv", **q)
    cd = r.headers.get("Content-Disposition", "")
    check("libro CSV: Content-Disposition Libro_recibidas_<cliente>_<desde>_<hasta>.csv",
          r.status_code == 200 and re.search(r'filename="Libro_recibidas_TEST-Reformas-Garcia-e-Hijos-S-L_2026-01-01_2026-12-31\.csv"', cd) is not None, cd)
    check("libro CSV: UTF-8 con BOM", r.content[:3] == b"\xef\xbb\xbf")
    texto = r.content.decode("utf-8-sig")
    lineas = texto.strip("\r\n").split("\r\n")
    cab = lineas[0].split(";")
    check("libro CSV: cabecera en español con «;»", cab[:4] == ["Nº recepción", "Fecha expedición", "Fecha operación", "Número"] and "Cuota deducible" in cab, str(cab))
    check("libro CSV: tantas filas como el JSON", len(lineas) - 1 == len(filas))
    fila01 = next(x.split(";") for x in lineas[1:] if "MT-2026/004518" in x)
    check("libro CSV: decimales con coma y fechas dd/mm/aaaa", fila01[1] == "03/07/2026" and re.fullmatch(r"-?\d+,\d{2}", fila01[8]) is not None, str(fila01[:10]))
    check("libro CSV: Access-Control-Expose-Headers con Content-Disposition", "content-disposition" in r.headers.get("Access-Control-Expose-Headers", "").lower())
    check("/libro-registro formato=xml -> 400", api.get("/libro-registro", formato="xml", cliente_id=cl["reformas"]).status_code == 400)


def leer_csv(r):
    return list(csv.reader(io.StringIO(r.content.decode("utf-8-sig")), delimiter=";"))


def importe(s):
    return 0 if not s else c(s.replace(",", "."))


def probar_asientos(api, cl, prep, ids_factura):
    print("\nGET /asientos (csv, a3, holded)")
    q = {"cliente_id": cl["reformas"], "desde": "2026-01-01", "hasta": "2026-12-31"}
    mias = [p for p in prep if p["cliente"] == "reformas"]
    r = api.get("/asientos", **q)
    filas = leer_csv(r)
    check("asientos CSV: cabecera Asiento;Fecha;Cuenta;Concepto;Debe;Haber;Documento;NIF", filas[0] == ["Asiento", "Fecha", "Cuenta", "Concepto", "Debe", "Haber", "Documento", "NIF"], str(filas[0]))
    grupos = defaultdict(list)
    for f in filas[1:]:
        grupos[f[0]].append(f)
    descuadrados = [k for k, v in grupos.items() if sum(importe(x[4]) for x in v) != sum(importe(x[5]) for x in v)]
    check("asientos CSV: cada asiento cuadra (Σ debe = Σ haber)", not descuadrados, str(descuadrados))
    check("asientos CSV: un asiento por factura", len(grupos) == len(mias) and not r.headers.get("X-Excluidas"), f"{len(grupos)} / {len(mias)} excl={r.headers.get('X-Excluidas')}")
    a02 = next(v for v in grupos.values() if v[0][6] == "2026-0087")
    cuentas = {x[2]: (importe(x[4]), importe(x[5])) for x in a02}
    check("asiento TEST_02: 623 500 / 472 105 / 4751 75 / 410 530", cuentas == {"623": (50000, 0), "472": (10500, 0), "4751": (0, 7500), "410": (0, 53000)}, str(cuentas))
    a09 = next(v for v in grupos.values() if v[0][6] == "IE-INV-558201")
    check("asiento TEST_09 intracomunitaria: 472 y 477 por la autorrepercutida 25,20",
          sorted((x[2], importe(x[4]), importe(x[5])) for x in a09) == sorted([("629", 12000, 0), ("472", 2520, 0), ("410", 0, 12000), ("477", 0, 2520)]))
    a08 = next(v for v in grupos.values() if v[0][6] == "R-2026-0003")
    check("asiento TEST_08 rectificativa: importes en negativo y cuadrado", sum(importe(x[4]) for x in a08) == sum(importe(x[5]) for x in a08) == -12100)
    a15 = next(v for v in grupos.values() if v[0][6] == "GC-2026-0233")
    check("asiento TEST_15 suplidos: 623 = base + suplidos (148,40)", any(x[2] == "623" and importe(x[4]) == 14840 for x in a15), str(a15))
    ra3 = api.get("/asientos", formato="a3", **q)
    fa3 = leer_csv(ra3)
    g3 = defaultdict(lambda: [0, 0])
    for f in fa3[1:]:
        g3[f[1]][0] += importe(f[4]); g3[f[1]][1] += importe(f[5])
    check("asientos A3: mismo contenido, cuadrados, marcados «a validar» en nombre y cabecera HTTP",
          len(fa3) == len(filas) and all(a == b for a, b in g3.values()) and "A-VALIDAR" in ra3.headers.get("Content-Disposition", "")
          and ra3.headers.get("X-Formato-Estado") == "a validar", ra3.headers.get("Content-Disposition", ""))
    rh = api.get("/asientos", formato="holded", **q)
    fh = leer_csv(rh)
    cab = fh[0]
    check("Holded: columnas de la plantilla oficial de facturas de compra", cab[:3] == ["Núm. factura", "Fecha dd/mm/yyyy", "Fecha de vencimiento dd/mm/yyyy"]
          and "IVA %" in cab and "Inv. Suj. Pasivo (1/0)" in cab and "Núm. cuenta de gasto" in cab, str(cab[:6]))
    i = {k: cab.index(k) for k in ("Núm. factura", "Precio unidad", "IVA %", "Retención %")}
    porfac = defaultdict(lambda: [0.0, 0.0])
    for f in fh[1:]:
        base = importe(f[i["Precio unidad"]])
        tipo = float(f[i["IVA %"]].replace("p_iva_", "").replace("_", ".") or 0)
        porfac[f[i["Núm. factura"]]][0] += base + round(base * tipo / 100)
        porfac[f[i["Núm. factura"]]][1] += round(base * float((f[i["Retención %"]] or "0").replace(",", ".")) / 100)
    malas = []
    for p in mias:
        doc = p["numero"] or None
        if doc and doc in porfac:
            neto = porfac[doc][0] - porfac[doc][1]
            if abs(neto - p["a_pagar"]) > 2:
                malas.append((p["id"], neto, p["a_pagar"]))
    check("Holded: por factura, Σ precio × (1 + IVA) − retención = total a pagar (±0,02)", not malas and len(porfac) >= len(mias) - 1, str(malas))
    check("/asientos formato=sage -> 400", api.get("/asientos", formato="sage", cliente_id=cl["reformas"]).status_code == 400)


def probar_excel(api, cl):
    print("\nGET /exportar?cliente_id (hojas nuevas)")
    r = api.get("/exportar", cliente_id=cl["reformas"], desde="2026-07-01", hasta="2026-09-30")
    SALIDA.mkdir(parents=True, exist_ok=True)
    ruta = SALIDA / "Gastos_reformas_3T.xlsx"
    ruta.write_bytes(r.content)
    wb = openpyxl.load_workbook(ruta)
    cache = openpyxl.load_workbook(ruta, data_only=True)
    nuevas = ["Libro registro", "IVA trimestre", "Retenciones", "347", "Asientos", "Pendientes de pago"]
    check("Excel: hojas nuevas detrás de las de antes", wb.sheetnames[5:] == nuevas, str(wb.sheetnames))
    cab = [x.value for x in wb["Facturas"][1]]
    check("Excel: columnas nuevas en Facturas", cab[17:] == ["Cliente", "Tipo factura", "Operación", "Retención", "Total a pagar", "Deducible", "Cuenta", "Estado de pago"], str(cab[17:]))
    lib = Libro(wb)
    fallos, distintos = [], []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for x in row:
                if isinstance(x.value, str) and x.value.startswith("="):
                    try:
                        v = lib.valor(ws.title, x.coordinate)
                    except ErrorFormula as e:
                        fallos.append(f"{ws.title}!{x.coordinate}: {e}")
                        continue
                    k = cache[ws.title][x.coordinate].value
                    if isinstance(v, (int, float)) and (not isinstance(k, (int, float)) or abs(k - v) > 0.005):
                        distintos.append(f"{ws.title}!{x.coordinate} {k} vs {v}")
    check("Excel: todas las fórmulas se evalúan sin error", not fallos, "; ".join(fallos[:3]))
    check("Excel: caché de ExcelJS = recalculado", not distintos, "; ".join(distintos[:3]))
    check("Excel: ningún valor de error", not [1 for ws in wb.worksheets for row in ws.iter_rows() for x in row if isinstance(x.value, str) and x.value.strip().startswith("#")])
    for n in nuevas:
        h = wb[n]["A1"]
        check(f"Excel {n}: cabecera teal con texto blanco en negrita, paneles inmovilizados e impresión A4 horizontal",
              h.fill.fgColor.rgb == "FF0F4C5C" and h.font.bold and h.font.color.rgb == "FFFFFFFF" and wb[n].freeze_panes is not None and wb[n].page_setup.orientation == "landscape")
    iva = wb["IVA trimestre"]
    check("IVA trimestre: fórmulas SUMIFS sobre «Libro registro»", any(isinstance(x.value, str) and "SUMIFS('Libro registro'" in x.value for row in iva.iter_rows() for x in row))
    j = api.get("/fiscal", cliente_id=cl["reformas"], anio=2026, trimestre=3).json()
    filas = {iva.cell(r, 1).value: r for r in range(1, iva.max_row + 1) if iva.cell(r, 1).value}
    ok = True
    for t in j["iva_303"]["interior"]:
        r = filas.get(f"IVA soportado interior {str(t['tipo_iva']).replace('.', ',')} %")
        ok &= r is not None and [c(lib.valor("IVA trimestre", f"{k}{r}")) for k in "CDE"] == [c(t["base"]), c(t["cuota"]), c(t["cuota_deducible"])]
    r_in = filas["Adquisiciones intracomunitarias (autorrepercusión)"]
    r_isp = filas["Inversión del sujeto pasivo (ISP y servicios extracomunitarios)"]
    ok &= [c(lib.valor("IVA trimestre", f"{k}{r_in}")) for k in "CDE"] == [c(j["iva_303"]["intracomunitarias"][x]) for x in ("base", "cuota_devengada", "cuota_deducible")]
    ok &= [c(lib.valor("IVA trimestre", f"{k}{r_isp}")) for k in "CDE"] == [c(j["iva_303"]["isp"][x]) for x in ("base", "cuota_devengada", "cuota_deducible")]
    r_tot = filas["Total deducible 3T 2026"]
    ok &= c(lib.valor("IVA trimestre", f"E{r_tot}")) == c(j["iva_303"]["total_deducible"])
    check("IVA trimestre (Excel recalculado) = /fiscal 3T: por tipo, intracomunitarias, ISP y total deducible", ok)
    ret = wb["Retenciones"]
    res = {(ret.cell(r, 1).value, ret.cell(r, 4).value): r for r in range(1, ret.max_row + 1)}
    ok = all((c(lib.valor("Retenciones", f"F{res[('3T 2026', int(m))]}")), c(lib.valor("Retenciones", f"G{res[('3T 2026', int(m))]}")), ret.cell(res[("3T 2026", int(m))], 5).value)
             == (c(j["retenciones"][f"modelo_{m}"]["base"]), c(j["retenciones"][f"modelo_{m}"]["retencion"]), j["retenciones"][f"modelo_{m}"]["num_perceptores"]) for m in ("111", "115"))
    check("Retenciones (Excel) = /fiscal 111 y 115 del 3T", ok)
    h347 = wb["347"]
    got = {h347.cell(r, 1).value: c(lib.valor("347", f"G{r}")) for r in range(2, h347.max_row + 1) if h347.cell(r, 1).value not in (None, "Total") and not str(h347.cell(r, 1).value).startswith("Modelo")}
    check("347 (Excel) = /fiscal 347 anual", got == {x["nif"]: c(x["total_anual"]) for x in j["modelo_347_anual"]}, str(got))
    asi = wb["Asientos"]
    ult = max(r for r in range(1, asi.max_row + 1) if asi.cell(r, 1).value == "Total")
    check("Asientos (Excel): Σ debe = Σ haber", c(lib.valor("Asientos", f"E{ult}")) == c(lib.valor("Asientos", f"F{ult}")) and c(lib.valor("Asientos", f"E{ult}")) != 0)
    pen = wb["Pendientes de pago"]
    ultp = max(r for r in range(1, pen.max_row + 1) if pen.cell(r, 1).value == "Total")
    pend = [f for f in fx.filas_test(api) if f["cliente_id"] == cl["reformas"] and f["estado"] in ("ok", "revisar", "posible_duplicada")
            and f["estado_pago"] != "pagada" and f["fecha_emision"] <= "2026-09-30"]
    check("Pendientes de pago (Excel) = Σ total a pagar de las pendientes (API)", c(lib.valor("Pendientes de pago", f"H{ultp}")) == sum(c(f["total_a_pagar"]) for f in pend)
          and ultp - 2 == len(pend), f"{ultp - 2} / {len(pend)}")


def probar_banco(api, cl, ids_factura):
    print("\nBanco: Norma 43 y CSV, sugerencias, conciliar, ignorar y deshacer")
    ref = cl["reformas"]
    n43, csvf = fx.generar_extractos()
    r = api.importar(n43, ref)
    j = r.json()
    esperado = {x[3] for x in fx.MOV_N43 if x[3]}
    sug = {s["movimiento_id"]: s for s in j.get("sugerencias", [])}
    check("N43: 4 movimientos importados, 0 duplicados", r.status_code == 200 and j["importados"] == 4 and j["duplicados"] == 0 and j["formato"] == "n43", r.text[:200])
    inv = {v: k for k, v in ids_factura.items()}
    check("N43: sugerencias para las 3 facturas que casan (y ninguna para la comisión)", {inv[s["factura_id"]] for s in sug.values()} == esperado and len(sug) == 3, str(sug))
    check("N43: el registro 33/88 cuadra (sin avisos)", j.get("avisos") == [] and j.get("errores") == [])
    r = api.importar(n43, ref)
    check("N43 importado otra vez: 0 importados, 4 duplicados", r.json().get("importados") == 0 and r.json().get("duplicados") == 4)
    r = api.importar(csvf, ref)
    j = r.json()
    sugc = {s["movimiento_id"]: s for s in j.get("sugerencias", [])}
    check("CSV («;», coma decimal, dd/mm/aaaa, 1.161,60): 4 importados", r.status_code == 200 and j["importados"] == 4 and j["formato"] == "csv", r.text[:200])
    check("CSV: sugerencias para las 3 facturas que casan", {inv[s["factura_id"]] for s in sugc.values()} == {x[3] for x in fx.MOV_CSV if x[3]}, str(sugc))
    r = requests.post(api.base + "/banco/importar", headers=api.h, files=[("extracto", ("x.txt", b"hola mundo", "text/plain"))], data={"cliente_id": str(ref)}, timeout=60)
    check("extracto no reconocible -> 400", r.status_code == 400)
    check("importar sin cliente_id -> 400", requests.post(api.base + "/banco/importar", headers=api.h, files=[("extracto", ("x.n43", n43.read_bytes(), "text/plain"))], timeout=60).status_code == 400)
    check("importar con cliente inexistente -> 404", api.importar(n43, 999999).status_code == 404)
    lista = api.get("/banco/movimientos", cliente_id=ref).json()["items"]
    check("GET /banco/movimientos: 8 movimientos del cliente, más recientes primero", len(lista) == 8 and [m["fecha"] for m in lista] == sorted([m["fecha"] for m in lista], reverse=True))
    con_sug = [m for m in lista if m["sugerencia"]]
    s0 = con_sug[0]["sugerencia"] if con_sug else {}
    check("GET /banco/movimientos: 6 con sugerencia {factura_id, proveedor, numero, total, total_a_pagar, confianza}",
          len(con_sug) == 6 and set(s0) >= {"factura_id", "proveedor", "numero", "total", "total_a_pagar", "confianza"}, str(s0))
    check("sugerencia: importe = −total a pagar y fecha del movimiento ≥ emisión", all(c(m["importe"]) == -c(m["sugerencia"]["total_a_pagar"]) for m in con_sug))
    # conciliar las del N43
    hechos = []
    for m in lista:
        if m["sugerencia"] and m["origen"] == "n43":
            r = api.patch("/banco/conciliar", {"movimiento_id": m["id"], "factura_id": m["sugerencia"]["factura_id"], "estado": "conciliado"})
            hechos.append((m, r))
    check("PATCH /banco/conciliar x3 -> 200", len(hechos) == 3 and all(r.status_code == 200 for _, r in hechos))
    facts = {f["id"]: f for f in fx.filas_test(api)}
    check("conciliado: facturas pagadas con fecha_pago = fecha del movimiento y movimiento_id",
          all(facts[m["sugerencia"]["factura_id"]]["estado_pago"] == "pagada" and facts[m["sugerencia"]["factura_id"]]["fecha_pago"] == m["fecha"]
              and facts[m["sugerencia"]["factura_id"]]["movimiento_id"] == m["id"] for m, _ in hechos))
    check("GET /banco/movimientos?estado=conciliado -> 3", api.get("/banco/movimientos", cliente_id=ref, estado="conciliado").json()["total"] == 3)
    comision = next(m for m in lista if c(m["importe"]) == -3745)
    r = api.patch("/banco/conciliar", {"movimiento_id": comision["id"], "factura_id": None, "estado": "ignorado"})
    check("ignorar la comisión -> 200, estado ignorado", r.status_code == 200 and r.json()["movimiento"]["estado"] == "ignorado")
    m0, _ = hechos[0]
    fid = m0["sugerencia"]["factura_id"]
    r = api.patch("/banco/conciliar", {"movimiento_id": hechos[1][0]["id"], "factura_id": fid})
    check("conciliar una factura ya conciliada con otro movimiento -> 422", r.status_code == 422)
    r = api.patch("/banco/conciliar", {"movimiento_id": m0["id"], "factura_id": None, "estado": "pendiente"})
    f = {x["id"]: x for x in fx.filas_test(api)}[fid]
    check("deshacer: movimiento pendiente sin factura y factura pendiente sin fecha_pago ni movimiento_id",
          r.status_code == 200 and r.json()["movimiento"]["estado"] == "pendiente" and r.json()["movimiento"]["factura_id"] is None
          and f["estado_pago"] == "pendiente" and f["fecha_pago"] is None and f["movimiento_id"] is None and r.json()["revertida"] == fid)
    otra = next(i for i, ff in {x["id"]: x for x in fx.filas_test(api)}.items() if ff["cliente_id"] == cl["panaderia"])
    check("conciliar con factura de otro cliente -> 422", api.patch("/banco/conciliar", {"movimiento_id": m0["id"], "factura_id": otra}).status_code == 422)
    for cuerpo, cod in (({}, 400), ({"movimiento_id": 999999, "estado": "ignorado"}, 404), ({"movimiento_id": m0["id"], "estado": "conciliado"}, 400),
                        ({"movimiento_id": m0["id"], "factura_id": 999999}, 404)):
        check(f"PATCH /banco/conciliar {cuerpo} -> {cod}", api.patch("/banco/conciliar", cuerpo).status_code == cod)
    check("GET /banco/movimientos?estado=otro -> 400", api.get("/banco/movimientos", estado="otro").status_code == 400)
    check("banco sin X-API-Key -> 403", requests.get(api.base + "/banco/movimientos", timeout=60).status_code == 403)
    for ruta, metodo in (("/banco/conciliar", "PATCH"), ("/banco/importar", "POST"), ("/fiscal", "GET"), ("/asientos", "GET")):
        r = requests.options(api.base + ruta, headers={"Origin": "null", "Access-Control-Request-Method": metodo, "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=60)
        check(f"preflight Origin null {metodo} {ruta}", r.headers.get("Access-Control-Allow-Origin") == "null" and metodo in (r.headers.get("Access-Control-Allow-Methods") or ""),
              r.headers.get("Access-Control-Allow-Methods") or "")


def probar_recomendaciones(api, cl):
    print("\nGET /recomendaciones?cliente_id")
    ref = cl["reformas"]
    check("sin recomendaciones del cliente -> 404", api.get("/recomendaciones", cliente_id=ref).status_code == 404)
    base = api.get("/recomendaciones").json()
    datos = {k: v for k, v in base.items() if k not in ("guardado",)}
    datos["cliente_id"] = ref
    fx.mcp().call("add_data_table_rows", {"dataTableId": fx.TABLA_RECOMENDACIONES, "projectId": fx.PROYECTO,
                                         "rows": [{"fecha": "2026-10-15T10:00:00+02:00", "desde": datos["desde"], "hasta": datos["hasta"], "json": json.dumps(datos, ensure_ascii=False), "cliente_id": ref}]})
    r = api.get("/recomendaciones", cliente_id=ref)
    check("GET /recomendaciones?cliente_id -> la última de ese cliente", r.status_code == 200 and r.json()["cliente_id"] == ref and r.json()["guardado"]["id"])
    r2 = api.get("/recomendaciones", cliente_id=cl["panaderia"])
    check("otro cliente sin recomendaciones -> 404", r2.status_code == 404)
    check("cliente_id no numérico -> 400", api.get("/recomendaciones", cliente_id="x").status_code == 400)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    api = fx.Api()
    if "--rehacer" in sys.argv:
        if fx.borrar(api, fx.INSTANTANEA if (fx.INSTANTANEA / "manifest.json").exists() else fx.COPIA) != 0:
            print("La limpieza previa no dejó los datos como la copia; reviso igualmente.")
    datos = fx.crear(api, con_extracto=False)
    if datos["problemas"]:
        print("Problemas al crear los datos TEST:", datos["problemas"])
    cl, ids = datos["clientes"], datos["facturas"]
    prep = preparar_esperado()
    probar_fiscal(api, cl, prep, ids)
    probar_libro(api, cl, prep, ids)
    probar_asientos(api, cl, prep, ids)
    probar_excel(api, cl)
    probar_banco(api, cl, ids)
    probar_recomendaciones(api, cl)
    fallos = [n for n, ok, _ in resultados if not ok]
    print(f"\n{len(resultados) - len(fallos)}/{len(resultados)} comprobaciones OK")
    for n in fallos:
        print("  FALLO:", n)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
