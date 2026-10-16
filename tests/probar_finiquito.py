"""Prueba FACT — Finiquito (POST /finiquito) contra un cálculo INDEPENDIENTE en Python (Fraction, sin reutilizar el JS).
Casos: tests/casos_finiquito.json (los usa también tests/e2e/finiquito.spec.js para comparar la copia JS de la web).
Uso: .venv\\Scripts\\python tests\\probar_finiquito.py   (sin Gemini; no escribe datos)"""
from __future__ import annotations

import calendar
import json
import sys
from datetime import date, timedelta
from fractions import Fraction as F
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probar_api import leer_env, check, resultados  # noqa: E402

RAIZ = Path(__file__).resolve().parent


def rnd(x):  # medio hacia arriba, céntimos
    return int((F(x) + F(1, 2)) // 1)


def add_meses(d: date, k: int) -> date:
    t = d.year * 12 + d.month - 1 + k
    y, m = divmod(t, 12)
    return date(y, m + 1, min(d.day, calendar.monthrange(y, m + 1)[1]))


def meses_dias(a: date, b: date):  # b excluido
    m = (b.year - a.year) * 12 + b.month - a.month
    if b.day < a.day:
        m -= 1
    m = max(m, 0)
    return m, (b - add_meses(a, m)).days


def meses_ceil(a: date, b: date) -> int:
    if b <= a:
        return 0
    m, r = meses_dias(a, b)
    return m + (1 if r else 0)


def esperado(e: dict) -> dict:
    ini, fin = date.fromisoformat(e["fecha_inicio"]), date.fromisoformat(e["fecha_fin"])
    tipo = e["tipo_extincion"]
    anual = rnd(F(str(e["salario_bruto_anual"])) * 100)
    n = e.get("num_pagas", 14)
    prorr = e.get("pagas_prorrateadas", False)
    vac_anu = F(str(e.get("dias_vacaciones_anuales", 30)))
    vac_dis = F(str(e.get("dias_vacaciones_disfrutadas", 0)))
    pre = F(str(e.get("preaviso_dias_incumplidos", 0)))
    irpf = F(str(e.get("irpf_pct", 0)))
    ss = F(str(e.get("ss_pct", 6.5)))
    pact = F(str(e.get("indemnizacion_pactada_dias_por_anio", 0)))
    sep = (not prorr) and n > 12
    ord_m = F(anual, n) if sep else F(anual, 12)
    sd = F(anual, 365)
    sd_base = ord_m * 12 / 365 if sep else sd
    paga = F(anual, n)
    # salario del último mes
    primero = fin.replace(day=1)
    ultimo = calendar.monthrange(fin.year, fin.month)[1]
    desde = max(ini, primero)
    dias_mes = (fin - desde).days + 1
    if desde == primero and fin.day == ultimo:
        dias_mes = 30
    dias_mes = min(30, dias_mes)
    sal = rnd(ord_m / 30 * dias_mes)
    # vacaciones
    a1, a2 = date(fin.year, 1, 1), date(fin.year, 12, 31)
    dias_anio = (a2 - a1).days + 1
    trab = (fin - max(ini, a1)).days + 1
    vac_dev = vac_anu * trab / dias_anio
    vac = rnd((vac_dev - vac_dis) * sd_base)
    # pagas extra
    ext = 0
    if sep:
        s1, s2 = (a1, date(fin.year, 6, 30)) if fin.month <= 6 else (date(fin.year, 7, 1), a2)
        imp = paga * F((fin - max(ini, s1)).days + 1, (s2 - s1).days + 1)
        if n == 15:
            imp += paga * F(trab, dias_anio)
        ext = rnd(imp)
    prea = rnd(pre * sd)
    sub = sal + vac + ext - prea
    # indemnización
    fin_ex = fin + timedelta(days=1)
    M = meses_ceil(ini, fin_ex)
    legal = 0
    exenta_ok = False
    corte = date(2012, 2, 12)
    if tipo == "despido_improcedente":
        exenta_ok = True
        if ini >= corte:
            dias = min(F(33 * M, 12), 720)
        else:
            mp = meses_ceil(ini, min(fin_ex, corte))
            dp, dq = F(45 * mp, 12), F(33 * (M - mp), 12)
            dias = min(dp, 1260) if dp > 720 else min(dp + dq, 720)
        legal = rnd(dias * sd)
    elif tipo == "despido_objetivo":
        exenta_ok = True
        legal = min(rnd(F(20 * M, 12) * sd), anual)
    elif tipo in ("fin_contrato_temporal", "fin_obra_o_servicio"):
        legal = rnd(F(12 * M, 12) * sd)
    indem = legal
    if pact > 0:
        p = rnd(pact * M / 12 * sd)
        if p > legal:
            indem = p
    exenta = min(legal, 18000000) if exenta_ok else 0
    base_irpf = max(0, sub) + indem - exenta
    ret = rnd(base_irpf * irpf / 100)
    ssc = rnd(max(0, sub) * ss / 100)
    return {"salario_mes": sal, "vacaciones": vac, "pagas_extra": ext, "preaviso": -prea, "subtotal": sub, "indemnizacion": indem,
            "irpf": ret, "ss": ssc, "neto": sub + indem - ret - ssc, "meses": M}


def comparar(base_url, h, casos):
    for c in casos:
        r = requests.post(f"{base_url}/finiquito", json=c["e"], headers=h, timeout=60)
        if r.status_code != 200:
            check(c["n"], False, f"HTTP {r.status_code}")
            continue
        j = r.json()
        ex = esperado(c["e"])
        got = {"salario_mes": j["conceptos"]["salario_mes"], "vacaciones": j["conceptos"]["vacaciones"], "pagas_extra": j["conceptos"]["pagas_extra"],
               "preaviso": j["conceptos"]["preaviso"], "subtotal": j["subtotal_finiquito"], "indemnizacion": j["indemnizacion"],
               "irpf": j["retencion_irpf"], "ss": j["seguridad_social"], "neto": j["neto"]}
        malos = [f"{k}: n8n {round(got[k] * 100)} vs {ex[k]}" for k in got if abs(round(got[k] * 100) - ex[k]) > 1]
        if j["meses_indemnizacion"] != ex["meses"]:
            malos.append("meses")
        d = {l["clave"]: l["importe_cent"] for l in j["desglose"]}
        if d.get("neto") != round(j["neto"] * 100):
            malos.append("desglose")
        check(c["n"], not malos, "; ".join(malos) or f"neto {j['neto']:.2f} €")


def main():
    env = leer_env()
    base = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
    h = {"X-API-Key": env["FACT_API_KEY"], "Content-Type": "application/json"}
    casos = json.loads((RAIZ / "casos_finiquito.json").read_text(encoding="utf-8"))
    comparar(base, h, casos)
    # valor fijo calculado a mano
    r = requests.post(f"{base}/finiquito", json={"fecha_inicio": "2020-01-01", "fecha_fin": "2024-12-31", "tipo_extincion": "despido_improcedente",
                                                  "salario_bruto_anual": 36500, "num_pagas": 12, "pagas_prorrateadas": True,
                                                  "dias_vacaciones_disfrutadas": 30}, headers=h, timeout=60).json()
    check("a mano: 5 años exactos × 33 días × 100 €/día = 16.500 €",
          abs(r["indemnizacion"] - 16500) < 0.01 and r["antiguedad"]["anios"] == 5 and r["antiguedad"]["meses"] == 0, str(r.get("indemnizacion")))
    base_ok = {"fecha_inicio": "2024-01-01", "fecha_fin": "2025-01-01", "tipo_extincion": "dimision", "salario_bruto_anual": 20000}
    malos = [
        ("fecha inválida (30 de febrero)", {**base_ok, "fecha_inicio": "2025-02-30", "fecha_fin": "2025-06-01"}),
        ("fin anterior al inicio", {**base_ok, "fecha_inicio": "2025-06-01", "fecha_fin": "2025-01-01"}),
        ("tipo desconocido", {**base_ok, "tipo_extincion": "jubilacion"}),
        ("sin salario", {k: v for k, v in base_ok.items() if k != "salario_bruto_anual"}),
        ("num_pagas 13", {**base_ok, "num_pagas": 13}),
        ("irpf fuera de rango", {**base_ok, "irpf_pct": 99}),
    ]
    for n, cuerpo in malos:
        r = requests.post(f"{base}/finiquito", json=cuerpo, headers=h, timeout=60)
        check(f"400: {n}", r.status_code == 400 and bool(r.json().get("detalles")), f"HTTP {r.status_code}")
    r = requests.post(f"{base}/finiquito", json=casos[0]["e"], timeout=30)
    check("403 sin clave", r.status_code == 403)
    r = requests.post(f"{base}/finiquito", json=casos[0]["e"], headers={"X-API-Key": "mala"}, timeout=30)
    check("403 con clave incorrecta", r.status_code == 403)
    for origen in ("null", "http://localhost:5500"):
        r = requests.options(f"{base}/finiquito", headers={"Origin": origen, "Access-Control-Request-Method": "POST",
                                                           "Access-Control-Request-Headers": "x-api-key,content-type"}, timeout=30)
        check(f"CORS preflight {origen}", r.headers.get("Access-Control-Allow-Origin") in (origen, "*")
              and "POST" in r.headers.get("Access-Control-Allow-Methods", ""),
              f"{r.status_code} {r.headers.get('Access-Control-Allow-Origin')} {r.headers.get('Access-Control-Allow-Methods')}")
    fallos = [x for x in resultados if not x[1]]
    print(f"\n{len(resultados) - len(fallos)}/{len(resultados)} OK")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
