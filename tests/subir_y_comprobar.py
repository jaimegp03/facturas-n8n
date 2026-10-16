"""Sube las facturas de ejemplo a FACT — Ingesta y las compara con esperado.json.

Uso:
    .venv\\Scripts\\python tests\\subir_y_comprobar.py            # todo (lotes + pruebas extra)
    .venv\\Scripts\\python tests\\subir_y_comprobar.py --sin-extra

Requisitos: fact_facturas vacía (si no, las facturas ya subidas saldrán como
"duplicada"); ver CLAUDE.md, "Vaciar fact_facturas".

Lee N8N_BASE_URL y FACT_API_KEY de .env. Nunca imprime el token ni datos de las
facturas más allá de archivo, categoría, total y estado.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
CARPETA = RAIZ / "tests" / "facturas-ejemplo"
TOLERANCIA = 0.02
TIMEOUT = 900  # la ingesta es secuencial y llama a Gemini por archivo

# Tres peticiones multipart con varios archivos; la 15 (duplicada) va después de la 01.
LOTES = [
    ["01", "02", "03", "04", "05"],
    ["06", "07", "08", "09", "10"],
    ["11", "12", "13", "14", "15"],
]
MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic"}


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


def subir(url: str, clave: str | None, archivos: list[Path]) -> requests.Response:
    abiertos = [f.open("rb") for f in archivos]
    try:
        partes = [("archivo", (f.name, h, MIME.get(f.suffix.lower(), "application/octet-stream")))
                  for f, h in zip(archivos, abiertos)]
        cabeceras = {"X-API-Key": clave} if clave else {}
        return requests.post(url, files=partes, headers=cabeceras, timeout=TIMEOUT)
    finally:
        for h in abiertos:
            h.close()


def fmt_total(x) -> str:
    return "-" if x is None else f"{float(x):.2f}"


def comparar(esp: dict, res: dict | None) -> list[str]:
    if res is None:
        return ["sin resultado"]
    fallos = []
    if res.get("estado") != esp["estado"]:
        fallos.append(f"estado {res.get('estado')} != {esp['estado']}")
    if esp["estado"] == "duplicada":
        return fallos
    f = res.get("factura") or {}
    if f.get("categoria") != esp["categoria"]:
        fallos.append("categoría")
    if f.get("tipo_gasto") != esp["tipo_gasto"]:
        fallos.append(f"tipo_gasto {f.get('tipo_gasto')} != {esp['tipo_gasto']}")
    if esp.get("periodicidad") and f.get("periodicidad") != esp["periodicidad"]:
        fallos.append(f"periodicidad {f.get('periodicidad')} != {esp['periodicidad']}")
    total = f.get("total")
    if total is None or abs(float(total) - esp["total"]) > TOLERANCIA:
        fallos.append(f"total {fmt_total(total)} != {esp['total']:.2f}")
    return fallos


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sin-extra", action="store_true", help="omite las pruebas de .txt, 401 y CORS")
    args = ap.parse_args()

    env = leer_env()
    url = env["N8N_BASE_URL"].rstrip("/") + "/webhook/facturas"
    esperado = {e["archivo"]: e for e in json.loads((CARPETA / "esperado.json").read_text(encoding="utf-8"))}
    por_prefijo = {n[:2]: n for n in esperado}

    resultados: dict[str, dict] = {}
    for i, lote in enumerate(LOTES, 1):
        archivos = [CARPETA / por_prefijo[p] for p in lote]
        print(f"Lote {i}: subiendo {len(archivos)} archivos en una petición...", flush=True)
        r = subir(url, env["FACT_API_KEY"], archivos)
        if r.status_code != 200:
            print(f"  HTTP {r.status_code}: la petición falló.")
            continue
        for item in r.json().get("resultados", []):
            resultados[item.get("archivo")] = item

    print()
    cab = f"{'archivo':34} {'categoría esperada / obtenida':56} {'total esp/obt':17} {'estado esp/obt':30} resultado"
    print(cab)
    print("-" * len(cab))
    ok = 0
    for nombre, esp in esperado.items():
        res = resultados.get(nombre)
        fallos = comparar(esp, res)
        f = (res or {}).get("factura") or {}
        if esp["estado"] == "duplicada":
            cat = "-"
            tot = "-"
        else:
            cat = f"{esp['categoria'][:26]} / {(f.get('categoria') or '-')[:26]}"
            tot = f"{esp['total']:.2f}/{fmt_total(f.get('total'))}"
        est = f"{esp['estado']}/{(res or {}).get('estado', '-')}"
        marca = "OK" if not fallos else "FALLO: " + "; ".join(fallos)
        ok += not fallos
        print(f"{nombre:34} {cat:56} {tot:17} {est:30} {marca}")
    print(f"\nFacturas: {ok}/{len(esperado)} OK")

    extra_ok = True
    if not args.sin_extra:
        print("\nPruebas extra")
        txt = RAIZ / "tests" / "_rechazar.txt"
        txt.write_text("esto no es una factura\n", encoding="utf-8")
        try:
            r = subir(url, env["FACT_API_KEY"], [txt])
            est = (r.json().get("resultados") or [{}])[0].get("estado") if r.status_code == 200 else None
            bien = est == "rechazado"
            print(f"  .txt rechazado: HTTP {r.status_code}, estado={est} -> {'OK' if bien else 'FALLO'}")
            extra_ok &= bien
        finally:
            txt.unlink(missing_ok=True)

        r = subir(url, None, [CARPETA / por_prefijo["01"]])
        bien = r.status_code in (401, 403)
        print(f"  sin X-API-Key: HTTP {r.status_code} -> {'OK' if bien else 'FALLO'}")
        extra_ok &= bien

        r = subir(url, "clave-incorrecta", [CARPETA / por_prefijo["01"]])
        bien = r.status_code in (401, 403)
        print(f"  X-API-Key incorrecta: HTTP {r.status_code} -> {'OK' if bien else 'FALLO'}")
        extra_ok &= bien

        for origen in ("null", "http://localhost:5500"):
            r = requests.options(url, headers={"Origin": origen, "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "x-api-key"}, timeout=30)
            acao = r.headers.get("Access-Control-Allow-Origin")
            bien = acao == origen and "x-api-key" in (r.headers.get("Access-Control-Allow-Headers") or "").lower()
            print(f"  CORS preflight Origin={origen}: HTTP {r.status_code}, Allow-Origin={acao} -> {'OK' if bien else 'FALLO'}")
            extra_ok &= bien

    todo_ok = ok == len(esperado) and extra_ok
    print("\nRESULTADO GLOBAL:", "OK" if todo_ok else "CON FALLOS")
    return 0 if todo_ok else 1


if __name__ == "__main__":
    sys.exit(main())
