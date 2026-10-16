"""Prueba FACT — Asesor de gastos (POST /asesor y GET /recomendaciones).

Uso:
    .venv\\Scripts\\python tests\\probar_asesor.py            # POST /asesor (1 llamada a Gemini)
    .venv\\Scripts\\python tests\\probar_asesor.py --ultima   # solo GET /recomendaciones (sin Gemini)

Requisitos: fact_facturas con el dataset de 14 facturas (ver CLAUDE.md).

Los valores esperados se calculan aquí de forma independiente a partir de
tests/facturas-ejemplo/esperado.json (no a partir de la API):
- subida de Netflix (+1,99 €/mes, +23,88 €/año);
- solape de música Spotify / Apple Music (ahorro = la más barata: 10,99 €/mes, 131,88 €/año);
- vencimientos entre hoy y hoy+15 días (Iberdrola 2026-10-20);
- coste mensual/anual de las suscripciones y contratos activos;
- gasto hormiga vacío;
- 3–6 recomendaciones y ninguna cifra en título/texto que no esté en su dato o ahorros
  (extractor de números propio, independiente del Code node de n8n).

Lee N8N_BASE_URL y FACT_API_KEY de .env. Nunca imprime el token.
"""
from __future__ import annotations

import re
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probar_api import leer_env, cargar_esperado, check, resultados  # noqa: E402

POR_ANIO = {"semanal": 52, "mensual": 12, "bimestral": 6, "trimestral": 4, "semestral": 2, "anual": 1}
INTERVALO = {"semanal": 7, "mensual": 31, "bimestral": 62, "trimestral": 92, "semestral": 183, "anual": 366}
TIMEOUT = 240


def c(x) -> int:
    return round(float(x) * 100)


# ------------------------------------------------------------ cálculo independiente
def esperado_asesor(esp: list[dict], desde: str, hasta: str, hoy: str) -> dict:
    periodo = [e for e in esp if desde <= e["fecha_emision"] <= hasta]
    ref = min(hasta, hoy)
    grupos: dict[str, list[dict]] = {}
    for e in sorted(periodo, key=lambda x: x["fecha_emision"]):
        if e["tipo_gasto"] in ("suscripcion", "contrato"):
            grupos.setdefault(e["nif"] or e["proveedor"], []).append(e)
    activos = {}
    for k, lista in grupos.items():
        u = lista[-1]
        dias = (date.fromisoformat(ref) - date.fromisoformat(u["fecha_emision"])).days
        iv = INTERVALO[u["periodicidad"]]
        if 0 <= dias <= iv + max(10, min(45, round(iv / 2))):
            anual = c(u["total"]) * POR_ANIO[u["periodicidad"]]
            activos[k] = {"ultima": u, "anterior": lista[-2] if len(lista) > 1 else None, "anual": anual, "mensual": round(anual / 12)}
    subidas = {}
    for k, a in activos.items():
        if a["anterior"] and c(a["ultima"]["total"]) > c(a["anterior"]["total"]):
            dif = c(a["ultima"]["total"]) - c(a["anterior"]["total"])
            veces = POR_ANIO[a["ultima"]["periodicidad"]]
            subidas[a["ultima"]["proveedor"]] = {"dif": dif, "mensual": round(dif * veces / 12), "anual": dif * veces}
    musica = [a for a in activos.values() if re.search(r"spotify|apple_music", a["ultima"]["archivo"])]
    barata = min(musica, key=lambda a: a["mensual"]) if len(musica) >= 2 else None
    hormiga = []
    pequenas: dict[str, list[str]] = {}
    for e in periodo:
        if e["tipo_gasto"] == "puntual" and 0 < c(e["total"]) < 1500:
            pequenas.setdefault(e["categoria"], []).append(e["fecha_emision"])
    for cat, fechas in pequenas.items():
        fechas.sort()
        for i in range(len(fechas)):
            n = sum(1 for f in fechas[i:] if (date.fromisoformat(f) - date.fromisoformat(fechas[i])).days <= 29)
            if n >= 5:
                hormiga.append(cat)
                break
    lim = (date.fromisoformat(hoy) + timedelta(days=15)).isoformat()
    venc = sorted((e["proveedor"], e["fecha_vencimiento"]) for e in esp if e.get("fecha_vencimiento") and hoy <= e["fecha_vencimiento"] <= lim)
    return {
        "mensual": sum(a["mensual"] for a in activos.values()),
        "anual": sum(a["anual"] for a in activos.values()),
        "num_activos": len(activos),
        "subidas": subidas,
        "solape": {"proveedores": sorted(a["ultima"]["proveedor"] for a in musica), "mensual": barata["mensual"], "anual": barata["anual"]} if barata else None,
        "hormiga": hormiga,
        "vencimientos": venc,
    }


# ------------------------------------------------------------ control de cifras independiente
def valores(tok: str) -> set[int]:
    """Todas las lecturas posibles de una cifra (1.234,56 / 1234.56 / 14,2), en centésimas."""
    out: set[int] = set()

    def add(s: str) -> None:
        try:
            out.add(round(float(s) * 100))
        except ValueError:
            pass

    if "," in tok and "." in tok:
        dec = "," if tok.rfind(",") > tok.rfind(".") else "."
        mil = "." if dec == "," else ","
        add(tok.replace(mil, "").replace(dec, "."))
    elif "," in tok or "." in tok:
        sep = "," if "," in tok else "."
        partes = tok.split(sep)
        if len(partes) == 2:
            add(".".join(partes))
        if all(len(p) == 3 for p in partes[1:]):
            add("".join(partes))
    else:
        add(tok)
    return out


def cifras(texto: str) -> list[str]:
    return re.findall(r"\d+(?:[.,]\d+)*", texto or "")


def cifras_ajenas(rec: dict) -> list[str]:
    permitidas: set[int] = set()
    for t in cifras(rec.get("dato", "")):
        permitidas |= valores(t)
    for k in ("ahorro_mensual", "ahorro_anual"):
        if isinstance(rec.get(k), (int, float)):
            permitidas.add(c(rec[k]))
    return [t for t in cifras(rec.get("titulo", "") + " " + rec.get("texto", "")) if not (valores(t) & permitidas)]


# ------------------------------------------------------------ pruebas
def main() -> int:
    env = leer_env()
    base = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
    cab = {"X-API-Key": env["FACT_API_KEY"]}
    solo_ultima = "--ultima" in sys.argv
    hoy = date.today().isoformat()
    hasta = hoy
    desde = (date.fromisoformat(hoy).replace(year=date.fromisoformat(hoy).year - 1) + timedelta(days=1)).isoformat()
    esp = cargar_esperado()
    exp = esperado_asesor(esp, desde, hasta, hoy)

    print("== Errores y seguridad (sin Gemini)")
    r = requests.post(base + "/asesor", json={"desde": "2026-13-01"}, headers=cab, timeout=TIMEOUT)
    check("400 con fecha inválida", r.status_code == 400 and "error" in r.json(), str(r.status_code))
    r = requests.post(base + "/asesor", json={"desde": "2026-10-14", "hasta": "2026-01-01"}, headers=cab, timeout=TIMEOUT)
    check("400 con desde > hasta", r.status_code == 400, str(r.status_code))
    r = requests.post(base + "/asesor", json={}, timeout=TIMEOUT)
    check("403 sin X-API-Key (POST /asesor)", r.status_code == 403, str(r.status_code))
    r = requests.get(base + "/recomendaciones", headers={"X-API-Key": "incorrecta"}, timeout=TIMEOUT)
    check("403 con clave incorrecta (GET /recomendaciones)", r.status_code == 403, str(r.status_code))
    for origen in ("null", "http://localhost:5500"):
        r = requests.options(base + "/asesor", headers={"Origin": origen, "Access-Control-Request-Method": "POST",
                                                         "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=TIMEOUT)
        check(f"CORS preflight /asesor Origin={origen}", r.headers.get("Access-Control-Allow-Origin") == origen, str(r.headers.get("Access-Control-Allow-Origin")))

    if solo_ultima:
        print("== GET /recomendaciones (última guardada, sin Gemini)")
        r = requests.get(base + "/recomendaciones", headers=cab, timeout=TIMEOUT)
        check("GET /recomendaciones 200", r.status_code == 200, str(r.status_code))
        d = r.json()
    else:
        print("== POST /asesor (1 llamada a Gemini)")
        r = requests.post(base + "/asesor", json={}, headers=cab, timeout=TIMEOUT)
        check("POST /asesor 200", r.status_code == 200, str(r.status_code))
        d = r.json()
        r2 = requests.get(base + "/recomendaciones", headers=cab, timeout=TIMEOUT)
        check("GET /recomendaciones devuelve la recién generada", r2.status_code == 200 and r2.json().get("generado") == d.get("generado")
              and r2.json().get("recomendaciones") == d.get("recomendaciones"))
    check("periodo por defecto = últimos 12 meses", (d.get("desde"), d.get("hasta")) == (desde, hasta), f"{d.get('desde')}..{d.get('hasta')}")
    h = d.get("hallazgos", {})
    recs = d.get("recomendaciones", [])

    print("== Hallazgos")
    sa = h.get("suscripciones_activas", {})
    check("suscripciones activas: coste mensual", c(sa.get("coste_mensual", 0)) == exp["mensual"], f"{sa.get('coste_mensual')} vs {exp['mensual'] / 100:.2f}")
    check("suscripciones activas: coste anual", c(sa.get("coste_anual", 0)) == exp["anual"], f"{sa.get('coste_anual')} vs {exp['anual'] / 100:.2f}")
    check("suscripciones activas: número", sa.get("num") == exp["num_activos"], f"{sa.get('num')} vs {exp['num_activos']}")
    sub = [s for s in h.get("subidas_precio", []) if "netflix" in s.get("proveedor", "").lower()]
    en = exp["subidas"].get("Netflix International B.V.")
    check("subida de Netflix detectada", bool(sub) and en is not None)
    if sub and en:
        s = sub[0]
        check("Netflix 13,99 → 15,98", (c(s["importe_anterior"]), c(s["importe_actual"])) == (1399, 1598))
        check("Netflix +1,99 €/mes", c(s["impacto_mensual"]) == en["mensual"] == 199, str(s["impacto_mensual"]))
        check("Netflix +23,88 €/año", c(s["impacto_anual"]) == en["anual"] == 2388, str(s["impacto_anual"]))
    check("solo hay subidas esperadas", {s["proveedor"] for s in h.get("subidas_precio", [])} == set(exp["subidas"]))
    sol = h.get("solapes", [])
    check("solape de música detectado (1 grupo)", len(sol) == 1 and sorted(x["proveedor"] for x in sol[0]["suscripciones"]) == exp["solape"]["proveedores"],
          str([[x["proveedor"] for x in g["suscripciones"]] for g in sol]))
    if sol:
        check("solape: ahorro 10,99 €/mes (Apple Music)", c(sol[0]["ahorro_mensual"]) == exp["solape"]["mensual"] == 1099, str(sol[0]["ahorro_mensual"]))
        check("solape: ahorro 131,88 €/año", c(sol[0]["ahorro_anual"]) == exp["solape"]["anual"] == 13188, str(sol[0]["ahorro_anual"]))
    venc = sorted((v["proveedor"], v["fecha_vencimiento"]) for v in h.get("vencimientos", []))
    check("vencimientos próximos = esperados", venc == exp["vencimientos"], str(venc))
    check("Iberdrola vence 2026-10-20 (si hoy <= 2026-10-20)", hoy > "2026-10-20" or ("Iberdrola Clientes, S.A.U.", "2026-10-20") in venc)
    check("gasto hormiga vacío", h.get("gasto_hormiga") == [] and exp["hormiga"] == [], str(h.get("gasto_hormiga")))
    crec = h.get("categorias_crecen", {})
    check("categorías que crecen: Streaming y música (sept. vs jun–ago)", crec.get("mes") == "2026-09"
          and [x["categoria"] for x in crec.get("items", [])] == ["Streaming y música"]
          and c(crec["items"][0]["gasto_mes"]) == 3896 and c(crec["items"][0]["media_3_meses"]) == 933, str(crec.get("items")))

    print("== Recomendaciones")
    check("entre 3 y 6 recomendaciones", 3 <= len(recs) <= 6, str(len(recs)))
    campos = {"id", "tipo", "titulo", "texto", "dato", "ahorro_mensual", "ahorro_anual", "redaccion"}
    check("todas con los campos pedidos", all(campos <= set(x) for x in recs))
    check("redaccion ∈ {gemini, plantilla}", all(x["redaccion"] in ("gemini", "plantilla") for x in recs))
    anuales = [x["ahorro_anual"] for x in recs]
    check("ordenadas por ahorro anual", anuales == sorted(anuales, reverse=True), str(anuales))
    tipos = {x["tipo"]: x for x in recs}
    check("recomendación de solape con 10,99 / 131,88", "solape" in tipos and (c(tipos["solape"]["ahorro_mensual"]), c(tipos["solape"]["ahorro_anual"])) == (1099, 13188))
    check("recomendación de subida con 1,99 / 23,88", "subida" in tipos and (c(tipos["subida"]["ahorro_mensual"]), c(tipos["subida"]["ahorro_anual"])) == (199, 2388))
    check("recomendación de vencimiento con ahorro 0", "vencimiento" in tipos and tipos["vencimiento"]["ahorro_anual"] == 0)
    for x in recs:
        malas = cifras_ajenas(x)
        check(f"{x['id']} ({x['tipo']}, {x['redaccion']}): sin cifras ajenas al dato", not malas, ", ".join(malas))
    for x in recs:
        print(f"     · {x['id']} [{x['redaccion']}] {x['titulo']} — ahorro {x['ahorro_mensual']:.2f} €/mes, {x['ahorro_anual']:.2f} €/año")
    if d.get("redaccion"):
        print(f"     redacción: modelo={d['redaccion'].get('modelo')} gemini={d['redaccion'].get('gemini')} plantilla={d['redaccion'].get('plantilla')}")
        for ctl in d["redaccion"].get("control", []):
            print(f"     control {ctl.get('id')}: {ctl.get('motivo')} {ctl.get('cifras', '')}")

    fallos = [r for r in resultados if not r[1]]
    print(f"\nResultado: {len(resultados) - len(fallos)}/{len(resultados)} OK" + (f", {len(fallos)} FALLO" if fallos else ""))
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
