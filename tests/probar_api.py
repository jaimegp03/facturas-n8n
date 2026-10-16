"""Prueba FACT — API (GET /facturas, GET /resumen, GET /categorias, PATCH y DELETE).

Uso:
    .venv\\Scripts\\python tests\\probar_api.py
    .venv\\Scripts\\python tests\\probar_api.py --solo-archivo   (solo GET /archivo; no modifica datos)

Requisitos: fact_facturas con el dataset de 14 facturas de tests/facturas-ejemplo
(ver CLAUDE.md). No llama a Gemini.

- Las comparaciones de /resumen se hacen contra un cálculo independiente en
  Python a partir de esperado.json (no a partir de la propia API).
- PATCH: corrige la Repsol y la Glovo y después las deja como estaban (salvo
  origen_categoria de la Glovo, que queda "manual", y la regla de glovoapp23 en
  fact_reglas, que queda apuntando a su categoría original).
- DELETE: solo sobre una fila de prueba con proveedor "PRUEBA API BORRADO"
  (insértala antes en fact_facturas; ver CLAUDE.md). Si no existe, se omite.
  Nunca borra facturas del dataset.

Lee N8N_BASE_URL y FACT_API_KEY de .env. Nunca imprime el token.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
ESPERADO = RAIZ / "tests" / "facturas-ejemplo" / "esperado.json"
MARCA_BORRADO = "PRUEBA API BORRADO"
TIMEOUT = 60
POR_ANIO = {"semanal": 52, "mensual": 12, "bimestral": 6, "trimestral": 4, "semestral": 2, "anual": 1}

resultados: list[tuple[str, bool, str]] = []


def leer_env() -> dict:
    env = {}
    ruta = RAIZ / ".env"
    if not ruta.exists():
        sys.exit("Falta .env (copia .env.example y rellena FACT_API_KEY).")
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("FACT_API_KEY"):
        sys.exit("FACT_API_KEY vacío en .env.")
    env.setdefault("N8N_BASE_URL", "http://localhost:5678")
    return env


def check(nombre: str, ok: bool, detalle: str = "") -> bool:
    resultados.append((nombre, ok, detalle))
    print(f"  [{'OK' if ok else 'FALLO'}] {nombre}" + (f" — {detalle}" if detalle else ""))
    return ok


def c(x) -> int:
    """Euros -> céntimos enteros."""
    return round(float(x) * 100)


class Api:
    def __init__(self, base: str, clave: str):
        self.base = base.rstrip("/") + "/webhook"
        self.h = {"X-API-Key": clave}

    def get(self, ruta, **params):
        return requests.get(self.base + ruta, headers=self.h, params=params, timeout=TIMEOUT)

    def patch(self, ruta, cuerpo, **params):
        return requests.patch(self.base + ruta, headers=self.h, params=params, json=cuerpo, timeout=TIMEOUT)

    def delete(self, ruta, **params):
        return requests.delete(self.base + ruta, headers=self.h, params=params, timeout=TIMEOUT)


# ---------------------------------------------------------------- esperado
def cargar_esperado() -> list[dict]:
    datos = json.loads(ESPERADO.read_text(encoding="utf-8"))
    return [e for e in datos if e.get("estado") != "duplicada"]


def resumen_independiente(esp: list[dict], desde: str, hasta: str) -> dict:
    filas = [e for e in esp if desde <= e["fecha_emision"] <= hasta]
    total = sum(c(e["total"]) for e in filas)
    por_cat = defaultdict(int)
    for e in filas:
        por_cat[e["categoria"]] += c(e["total"])
    por_mes = {}
    d = date.fromisoformat(desde).replace(day=1)
    fin = date.fromisoformat(hasta).replace(day=1)
    while d <= fin:
        por_mes[d.strftime("%Y-%m")] = 0
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    for e in filas:
        por_mes[e["fecha_emision"][:7]] += c(e["total"])
    ultimos = {}
    for e in sorted(filas, key=lambda x: x["fecha_emision"]):
        if e["tipo_gasto"] in ("suscripcion", "contrato"):
            ultimos[e["proveedor"]] = e
    anual = mensual = 0
    detalle = {}
    for prov, e in ultimos.items():
        a = c(e["total"]) * POR_ANIO[e["periodicidad"]]
        m = round(a / 12)
        anual += a
        mensual += m
        detalle[prov] = (m, a)
    dias = (date.fromisoformat(hasta) - date.fromisoformat(desde)).days + 1
    ant_hasta = date.fromisoformat(desde) - timedelta(days=1)
    ant_desde = ant_hasta - timedelta(days=dias - 1)
    ant = sum(c(e["total"]) for e in esp if ant_desde.isoformat() <= e["fecha_emision"] <= ant_hasta.isoformat())
    return {"total": total, "num": len(filas), "por_cat": dict(por_cat), "por_mes": por_mes,
            "mensual": mensual, "anual": anual, "detalle": detalle,
            "ant_desde": ant_desde.isoformat(), "ant_hasta": ant_hasta.isoformat(), "ant_total": ant}


# ---------------------------------------------------------------- bloques
def probar_borrado(api: Api, esp: list[dict]) -> None:
    print("\nDELETE (fila de prueba)")
    r = api.get("/facturas", proveedor=MARCA_BORRADO)
    filas = r.json().get("items", []) if r.status_code == 200 else []
    if not filas:
        print(f"  [OMITIDO] no hay fila activa con proveedor '{MARCA_BORRADO}'.")
        return
    f = filas[0]
    fid = f["id"]
    base_n = len(esp)
    r = api.get("/facturas")
    check("la fila de prueba aparece en /facturas antes de borrar", r.json()["total"] == base_n + 1, f"total={r.json()['total']}")
    desde, hasta = "2026-01-01", "2026-10-14"
    ref = resumen_independiente(esp, desde, hasta)
    r = api.get("/resumen", desde=desde, hasta=hasta)
    en_rango = desde <= (f.get("fecha_emision") or "") <= hasta
    esperado_antes = ref["total"] + (c(f["total"]) if en_rango else 0)
    check("la fila de prueba cuenta en /resumen antes de borrar", c(r.json()["total"]) == esperado_antes,
          f"{r.json()['total']:.2f} vs {esperado_antes / 100:.2f}")
    r = api.delete(f"/facturas/{fid}")
    j = r.json()
    check("DELETE /facturas/:id -> 200 y estado=borrada", r.status_code == 200 and j["factura"]["estado"] == "borrada" and j["ya_borrada"] is False,
          f"HTTP {r.status_code}")
    r = api.get("/facturas")
    check("desaparece de /facturas", r.json()["total"] == base_n and all(x["id"] != fid for x in r.json()["items"]), f"total={r.json()['total']}")
    r = api.get("/facturas", estado="borrada")
    check("aparece con estado=borrada", any(x["id"] == fid for x in r.json()["items"]))
    r = api.get("/resumen", desde=desde, hasta=hasta)
    check("desaparece de /resumen", c(r.json()["total"]) == ref["total"], f"{r.json()['total']:.2f}")
    r = api.delete("/facturas", id=fid)
    check("DELETE /facturas?id=N (repetido) -> 200 idempotente", r.status_code == 200 and r.json().get("ya_borrada") is True, f"HTTP {r.status_code}")


def probar_listado(api: Api, esp: list[dict]) -> None:
    print("\nGET /facturas")
    r = api.get("/facturas")
    j = r.json()
    n = len(esp)
    check("sin filtros: HTTP 200 y total = 14", r.status_code == 200 and j["total"] == n, f"total={j.get('total')}")
    check("sin filtros: la Repsol (revisar) está incluida", any("repsol" in (x["proveedor"] or "").lower() for x in j["items"]))
    fechas = [x["fecha_emision"] for x in j["items"]]
    check("orden fecha_emision desc", fechas == sorted(fechas, reverse=True))
    check("formato {items,total,pagina,por_pagina,paginas}", {"items", "total", "pagina", "por_pagina", "paginas"} <= set(j)
          and j["pagina"] == 1 and j["por_pagina"] == 50 and j["paginas"] == 1)

    cat = "Streaming y música"
    r = api.get("/facturas", categoria=cat)
    esperados = sum(1 for e in esp if e["categoria"] == cat)
    check(f"categoria='{cat}'", r.json()["total"] == esperados, f"{r.json()['total']} vs {esperados}")
    for tipo in ("suscripcion", "contrato", "puntual"):
        r = api.get("/facturas", tipo=tipo)
        esperados = sum(1 for e in esp if e["tipo_gasto"] == tipo)
        check(f"tipo={tipo}", r.json()["total"] == esperados, f"{r.json()['total']} vs {esperados}")
    r = api.get("/facturas", estado="revisar")
    check("estado=revisar -> 1 (Repsol)", r.json()["total"] == 1 and "repsol" in r.json()["items"][0]["proveedor"].lower())
    r = api.get("/facturas", proveedor="netflix")
    check("proveedor parcial 'netflix' -> 3", r.json()["total"] == 3, f"{r.json()['total']}")
    r = api.get("/facturas", proveedor="NETFLIX")
    check("proveedor sin distinguir mayúsculas", r.json()["total"] == 3)
    desde, hasta = "2026-09-01", "2026-09-30"
    r = api.get("/facturas", desde=desde, hasta=hasta)
    esperados = sum(1 for e in esp if desde <= e["fecha_emision"] <= hasta)
    check(f"rango {desde}..{hasta}", r.json()["total"] == esperados
          and all(desde <= x["fecha_emision"] <= hasta for x in r.json()["items"]), f"{r.json()['total']} vs {esperados}")

    ids = []
    paginas = None
    for p in (1, 2, 3):
        r = api.get("/facturas", por_pagina=5, pagina=p)
        j = r.json()
        paginas = j["paginas"]
        ids += [x["id"] for x in j["items"]]
    check("por_pagina=5 -> 3 páginas, 5+5+4 sin repetir", paginas == 3 and len(ids) == n and len(set(ids)) == n, f"paginas={paginas}, ids={len(set(ids))}")
    r = api.get("/facturas", por_pagina=5, pagina=4)
    check("página fuera de rango -> items vacío", r.status_code == 200 and r.json()["items"] == [])
    r = api.get("/facturas", por_pagina=500)
    check("por_pagina=500 -> 400", r.status_code == 400)
    r = api.get("/facturas", desde="2026-13-01")
    check("desde inválido -> 400", r.status_code == 400)
    r = api.get("/facturas", estado="inventado")
    check("estado inválido -> 400", r.status_code == 400)

    r = api.get("/categorias")
    j = r.json()
    # 20 personales (Suministros separado en Agua/Luz/Gas/Telefonía) + 8 de empresa (modo gestoría); «Otros» al final; cada una con su cuenta PGC.
    check("GET /categorias -> 28 activas ordenadas, con cuenta_pgc", r.status_code == 200 and j["total"] == 28
          and [x["orden"] for x in j["items"]] == sorted(x["orden"] for x in j["items"]) and j["items"][-1]["nombre"] == "Otros"
          and all(x.get("cuenta_pgc") for x in j["items"]))


def probar_resumen(api: Api, esp: list[dict]) -> dict:
    print("\nGET /resumen 2026-01-01..2026-10-14")
    desde, hasta = "2026-01-01", "2026-10-14"
    ref = resumen_independiente(esp, desde, hasta)
    r = api.get("/resumen", desde=desde, hasta=hasta)
    j = r.json()
    check("HTTP 200", r.status_code == 200)
    check("total", c(j["total"]) == ref["total"], f"API {j['total']:.2f} / Python {ref['total'] / 100:.2f}")
    check("num_facturas", j["num_facturas"] == ref["num"], f"{j['num_facturas']} / {ref['num']}")
    pe = j.get("por_estado") or {}
    # por_estado cuenta todas las filas del periodo (también borrada/duplicada, que no suman).
    check("por_estado (ok 13, revisar 1; borrada/duplicada no suman)",
          pe.get("ok") == 13 and pe.get("revisar") == 1 and set(pe) <= {"ok", "revisar", "borrada", "duplicada"}, str(pe))
    api_cat = {x["categoria"]: c(x["total"]) for x in j["por_categoria"]}
    check("por_categoria", api_cat == ref["por_cat"], "" if api_cat == ref["por_cat"] else f"{api_cat} vs {ref['por_cat']}")
    suma_pct = sum(x["pct"] for x in j["por_categoria"])
    check("pct de categorías suma ~100", abs(suma_pct - 100) < 0.1, f"{suma_pct:.2f}")
    api_mes = {x["mes"]: c(x["total"]) for x in j["por_mes"]}
    check("por_mes (10 meses, con ceros)", api_mes == ref["por_mes"], "" if api_mes == ref["por_mes"] else f"{api_mes} vs {ref['por_mes']}")
    top = j["top_proveedores"]
    check("top_proveedores: 5, orden desc", len(top) == 5 and [x["total"] for x in top] == sorted((x["total"] for x in top), reverse=True),
          ", ".join(f"{x['proveedor'][:18]} {x['total']:.2f}" for x in top))
    rec = j["recurrente"]
    check("recurrente.mensual", c(rec["mensual"]) == ref["mensual"], f"API {rec['mensual']:.2f} / Python {ref['mensual'] / 100:.2f}")
    check("recurrente.anual", c(rec["anual"]) == ref["anual"], f"API {rec['anual']:.2f} / Python {ref['anual'] / 100:.2f}")
    print("    detalle recurrente (API):")
    for d in rec["detalle"]:
        print(f"      {d['proveedor'][:40]:40} {d['periodicidad']:9} último {d['ultimo_importe']:8.2f}  mes {d['coste_mensual']:8.2f}  año {d['coste_anual']:8.2f}  ({d['ultima_fecha']})")
    netflix = next((d for d in rec["detalle"] if "netflix" in d["proveedor"].lower()), None)
    check("Netflix toma el ÚLTIMO importe (15,98, no 13,99)", netflix is not None and c(netflix["ultimo_importe"]) == 1598)
    check("Mapfre anual 285 -> 23,75 €/mes", any("mapfre" in d["proveedor"].lower() and c(d["coste_mensual"]) == 2375 and c(d["coste_anual"]) == 28500 for d in rec["detalle"]))
    comp = j["comparacion_periodo_anterior"]
    check("periodo anterior: fechas", comp["desde"] == ref["ant_desde"] and comp["hasta"] == ref["ant_hasta"], f"{comp['desde']}..{comp['hasta']}")
    check("periodo anterior: total y diferencia", c(comp["total"]) == ref["ant_total"] and c(comp["diferencia"]) == ref["total"] - ref["ant_total"],
          f"anterior {comp['total']:.2f}, diferencia {comp['diferencia']:.2f}, pct {comp['pct']}")
    r = api.get("/resumen")
    j2 = r.json()
    hoy = date.today()
    check("sin fechas -> últimos 12 meses hasta hoy", r.status_code == 200 and j2["hasta"] == hoy.isoformat()
          and j2["desde"] == (hoy.replace(year=hoy.year - 1) + timedelta(days=1)).isoformat(), f"{j2.get('desde')}..{j2.get('hasta')}")
    r = api.get("/resumen", desde="2026-10-14", hasta="2026-01-01")
    check("desde > hasta -> 400", r.status_code == 400)
    return ref


def probar_patch(api: Api, ref: dict) -> None:
    print("\nPATCH /facturas/:id")
    repsol = api.get("/facturas", proveedor="repsol").json()["items"][0]
    rid = repsol["id"]
    r = api.patch(f"/facturas/{rid}", {"total": 60.50})
    j = r.json()
    f = j.get("factura", {})
    check("Repsol total 60,50 -> 200, estado ok, sin errores", r.status_code == 200 and f.get("estado") == "ok" and f.get("errores_validacion") is None
          and c(f.get("total", 0)) == 6050, f"HTTP {r.status_code}, estado={f.get('estado')}")
    check("estado=revisar ya no tiene filas", api.get("/facturas", estado="revisar").json()["total"] == 0)
    res = api.get("/resumen", desde="2026-01-01", hasta="2026-10-14").json()
    check("/resumen refleja la corrección (-1,00)", c(res["total"]) == ref["total"] - 100, f"{res['total']:.2f}")
    r = api.patch("/facturas", {"total": 61.50, "estado": "revisar"}, id=rid)
    f = r.json().get("factura", {})
    check("Repsol restaurada (61,50, revisar) vía /facturas?id=N", r.status_code == 200 and f.get("estado") == "revisar" and c(f.get("total", 0)) == 6150)
    despues = api.get("/facturas", proveedor="repsol").json()["items"][0]
    distintos = [k for k in repsol if k not in ("actualizado", "updatedAt") and repsol[k] != despues.get(k)]
    check("Repsol idéntica a la original (salvo actualizado)", not distintos, ", ".join(distintos))

    glovo = api.get("/facturas", proveedor="glovo").json()["items"][0]
    gid = glovo["id"]
    r = api.patch(f"/facturas/{gid}", {"categoria": "Inventada"})
    check("categoría inexistente -> 422", r.status_code == 422, f"HTTP {r.status_code}")
    r = api.patch(f"/facturas/{gid}", {"total": "doce"})
    check("total no numérico -> 422", r.status_code == 422)
    r = api.patch(f"/facturas/{gid}", {"estado": "borrada"})
    check("estado=borrada por PATCH -> 422", r.status_code == 422)
    r = api.patch(f"/facturas/{gid}", {"hash_sha256": "x"})
    check("campo fuera de la lista blanca -> 400", r.status_code == 400)
    r = api.patch(f"/facturas/{gid}", {})
    check("cuerpo vacío -> 400", r.status_code == 400)
    sin_cambios = api.get("/facturas", proveedor="glovo").json()["items"][0]
    check("los rechazos no modifican la fila", sin_cambios == glovo)

    r = api.patch(f"/facturas/{gid}", {"categoria": "Otros"})
    j = r.json()
    f = j.get("factura", {})
    regla = j.get("regla") or {}
    check("Glovo -> Otros: 200, origen manual", r.status_code == 200 and f.get("categoria") == "Otros" and f.get("origen_categoria") == "manual")
    check("regla guardada en fact_reglas", regla.get("guardada") is True and regla.get("proveedor_norm") == glovo["proveedor_norm"] and regla.get("categoria") == "Otros",
          f"proveedor_norm={regla.get('proveedor_norm')}")
    check("Glovo aparece en categoria=Otros", any(x["id"] == gid for x in api.get("/facturas", categoria="Otros").json()["items"]))
    r = api.patch(f"/facturas/{gid}", {"categoria": glovo["categoria"], "subcategoria": glovo["subcategoria"]})
    f = r.json().get("factura", {})
    check("Glovo restaurada a su categoría original", r.status_code == 200 and f.get("categoria") == glovo["categoria"] and f.get("subcategoria") == glovo["subcategoria"],
          f"origen_categoria queda '{f.get('origen_categoria')}'; la regla de {glovo['proveedor_norm']} queda -> {glovo['categoria']}")


def probar_errores(api: Api) -> None:
    print("\nErrores, autenticación y CORS")
    check("PATCH id inexistente -> 404", api.patch("/facturas/999999", {"total": 1}).status_code == 404)
    check("DELETE id inexistente -> 404", api.delete("/facturas/999999").status_code == 404)
    check("PATCH id no numérico -> 400", api.patch("/facturas/abc", {"total": 1}).status_code == 400)
    for metodo, ruta in (("GET", "/facturas"), ("GET", "/resumen"), ("GET", "/categorias"), ("PATCH", "/facturas/1"), ("DELETE", "/facturas/1")):
        r = requests.request(metodo, api.base + ruta, json={} if metodo == "PATCH" else None, timeout=TIMEOUT)
        check(f"{metodo} {ruta} sin X-API-Key -> 403", r.status_code == 403, f"HTTP {r.status_code}")
    r = requests.get(api.base + "/facturas", headers={"X-API-Key": "clave-incorrecta"}, timeout=TIMEOUT)
    check("X-API-Key incorrecta -> 403", r.status_code == 403)
    casos = [("/facturas", "GET"), ("/resumen", "GET"), ("/categorias", "GET"), ("/facturas", "PATCH"), ("/facturas", "DELETE")]
    for ruta, metodo in casos:
        r = requests.options(api.base + ruta, headers={"Origin": "null", "Access-Control-Request-Method": metodo,
                                                      "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=TIMEOUT)
        metodos = r.headers.get("Access-Control-Allow-Methods") or ""
        ok = r.headers.get("Access-Control-Allow-Origin") == "null" and metodo in metodos and "x-api-key" in (r.headers.get("Access-Control-Allow-Headers") or "").lower()
        check(f"preflight Origin null {metodo} {ruta}", ok, f"HTTP {r.status_code}, Allow-Methods={metodos}")
    r = requests.options(api.base + "/facturas/1", headers={"Origin": "null", "Access-Control-Request-Method": "PATCH"}, timeout=TIMEOUT)
    print(f"  [INFO] preflight /facturas/1 (ruta dinámica): Allow-Methods={r.headers.get('Access-Control-Allow-Methods')} "
          "— n8n 2.42 solo anuncia un método en rutas dinámicas; desde el navegador usa /facturas?id=N.")
    r = requests.get(api.base + "/categorias", headers={**api.h, "Origin": "null"}, timeout=TIMEOUT)
    check("respuesta real con Origin null lleva Allow-Origin", r.headers.get("Access-Control-Allow-Origin") == "null")


def probar_archivo(api: Api) -> None:
    """GET /archivo?id=N (solo lectura). Busca por nombre de archivo la Zara (PDF) y la foto de Netflix (JPEG):
    los ids cambian cada vez que se vacía la tabla y se vuelven a subir las facturas."""
    print("\nGET /archivo (original para la miniatura)")
    items = api.get("/facturas", desde="2000-01-01", hasta="2100-12-31", por_pagina=200).json()["items"]
    por_nombre = {f["archivo_nombre"]: f["id"] for f in items}
    casos = (("01_zara_ropa.pdf", b"%PDF", "application/pdf"), ("05_netflix_septiembre_foto.jpg", b"\xff\xd8", "image/jpeg"))
    for nombre, firma, mime in casos:
        fid = por_nombre.get(nombre)
        if fid is None:
            check(f"GET /archivo de {nombre}", False, "no está en /facturas")
            continue
        r = api.get("/archivo", id=fid)
        ct = r.headers.get("Content-Type") or ""
        ok = (r.status_code == 200 and r.content.startswith(firma) and ct.startswith(mime)
              and (r.headers.get("Content-Disposition") or "").startswith("inline")
              and r.headers.get("Cache-Control") == "private, max-age=3600"
              and "content-type" in (r.headers.get("Access-Control-Expose-Headers") or "").lower())
        check(f"GET /archivo?id={fid} -> {mime}, firma {firma!r}, cabeceras", ok, f"HTTP {r.status_code}, {ct}, {len(r.content)} bytes")
    r = api.get("/archivo", id=999999)
    es_json = (r.headers.get("Content-Type") or "").startswith("application/json")
    check("GET /archivo id inexistente -> 404 JSON", r.status_code == 404 and es_json and "error" in r.json(), f"HTTP {r.status_code}")
    r = api.get("/archivo", id="abc")
    check("GET /archivo id no numérico -> 400", r.status_code == 400, f"HTTP {r.status_code}")
    r = requests.get(api.base + "/archivo", params={"id": 1}, timeout=TIMEOUT)
    check("GET /archivo sin X-API-Key -> 403", r.status_code == 403, f"HTTP {r.status_code}")
    r = requests.options(api.base + "/archivo", headers={"Origin": "null", "Access-Control-Request-Method": "GET",
                                                         "Access-Control-Request-Headers": "x-api-key"}, timeout=TIMEOUT)
    metodos = r.headers.get("Access-Control-Allow-Methods") or ""
    ok = (r.headers.get("Access-Control-Allow-Origin") == "null" and "GET" in metodos
          and "x-api-key" in (r.headers.get("Access-Control-Allow-Headers") or "").lower())
    check("preflight Origin null GET /archivo", ok, f"HTTP {r.status_code}, Allow-Methods={metodos}")
    r = requests.get(api.base + "/archivo", params={"id": 1}, headers={**api.h, "Origin": "null"}, timeout=TIMEOUT)
    check("respuesta binaria con Origin null lleva Allow-Origin", r.headers.get("Access-Control-Allow-Origin") == "null")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    env = leer_env()
    api = Api(env["N8N_BASE_URL"], env["FACT_API_KEY"])
    if "--solo-archivo" in sys.argv[1:]:
        probar_archivo(api)
        return resumen_final()
    esp = cargar_esperado()
    probar_borrado(api, esp)
    probar_listado(api, esp)
    ref = probar_resumen(api, esp)
    probar_patch(api, ref)
    probar_errores(api)
    probar_archivo(api)
    return resumen_final()


def resumen_final() -> int:
    fallos = [n for n, ok, _ in resultados if not ok]
    print(f"\n{len(resultados) - len(fallos)}/{len(resultados)} comprobaciones OK")
    for n in fallos:
        print(f"  FALLO: {n}")
    print("RESULTADO GLOBAL:", "OK" if not fallos else "CON FALLOS")
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
