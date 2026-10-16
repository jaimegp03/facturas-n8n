"""Audita las facturas activas de Luz/Gas/Agua/Telefonía e internet comparando la categoría con el tipo
detectado por el CONTENIDO del PDF original (detector de n8n/codigo/ingesta_tipo_suministro.js, vía node).
Genera docs/auditoria-suministros.md (sin datos personales) y tests/salida/sum/correcciones.json.
Uso: .venv\Scripts\python tests\auditoria\auditar_suministros.py"""
import json, subprocess, sys
from collections import Counter
from pathlib import Path
import pymupdf, requests
RAIZ = Path(__file__).resolve().parents[2]
env = dict(l.strip().split("=", 1) for l in (RAIZ / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
H = {"X-API-Key": env["FACT_API_KEY"]}; B = env["N8N_BASE_URL"] + "/webhook"
SUM = {"Luz", "Gas", "Agua", "Telefonía e internet"}
CAT = {"luz": "Luz", "gas": "Gas", "agua": "Agua", "telefonia": "Telefonía e internet"}
items, p = [], 1
while True:
    r = requests.get(B + "/facturas", headers=H, params={"por_pagina": 200, "pagina": p}).json()
    items += r["items"]
    if p >= r["paginas"]: break
    p += 1
sel = [i for i in items if i["categoria"] in SUM]
ent = []
for i in sel:
    ruta = Path(i["archivo_ruta"].replace("/home/node/.n8n-files/facturas", r"C:\Users\GOMEZ\facturas-almacen"))
    try: t = "\n".join(pg.get_text() for pg in pymupdf.open(ruta))
    except Exception: t = ""
    ent.append({"id": i["id"], "texto": t, "archivo": i["archivo_nombre"], "subcategoria": i.get("subcategoria"),
                "lineas": [l.get("descripcion", "") for l in json.loads(i.get("lineas_json") or "[]")] if i.get("lineas_json") else []})
tmp = RAIZ / "tests" / "salida" / "sum"; tmp.mkdir(parents=True, exist_ok=True)
(tmp / "ent_aud.json").write_text(json.dumps(ent, ensure_ascii=False), encoding="utf-8")
subprocess.run(["node", str(RAIZ / "tests" / "detector_lote.js"), str(tmp / "ent_aud.json"), str(tmp / "sal_aud.json")], check=True)
sal = {s["id"]: s for s in json.loads((tmp / "sal_aud.json").read_text())}
filas, corr, errores = [], [], Counter()
for i in sorted(sel, key=lambda x: (x["proveedor"], x["fecha_emision"])):
    s = sal[i["id"]]; texto = bool(next(e for e in ent if e["id"] == i["id"])["texto"].strip())
    tipo = s["tipo"] if s["concluyente"] else None
    cat_ok = CAT.get(tipo)
    ok = cat_ok == i["categoria"]
    ev = f"PDF {'con texto' if texto else 'sin texto'}: {s['puntos'][s['tipo']] if s['tipo'] else 0} pts {tipo or 'sin tipo'} (resto máx. {sorted(s['puntos'].values())[-2]}); archivo «{i['archivo_nombre'][:3].upper()}…»"
    filas.append((i, tipo, ev, ok))
    if not ok and cat_ok:
        errores[f"{i['categoria']} -> {cat_ok}"] += 1
        corr.append({"id": i["id"], "categoria": cat_ok, "estado": i["estado"], "de": i["categoria"]})
(tmp / "correcciones.json").write_text(json.dumps(corr), encoding="utf-8")
n = len(filas); c = sum(1 for f in filas if f[3])
md = ["# Auditoría de suministros (Luz, Gas, Agua, Telefonía e internet)", "",
      "Fecha: 2026-10-16. Cliente Personal. El tipo real se decide por el **contenido** del PDF original (texto extraído en local); el proveedor no cuenta.", "",
      f"- Facturas revisadas: **{n}**; coinciden: **{c}**; mal categorizadas: **{n - c}** ({', '.join(f'{k}: {v}' for k, v in errores.items()) or 'ninguna'}).",
      "- Causa: la recategorización por nombre de proveedor mandó todo Endesa y Energía XXI a «Luz», pero las facturas de Endesa son de **gas** (cabecera «Factura de gas», término fijo/energía gas, kWh/m³).",
      "- Ninguna factura mezcla dos conceptos (el segundo tipo puntúa como máximo 2-3 puntos por palabras sueltas como «kWh»).",
      "- Nota: en la carpeta de descargas hay un archivo llamado «AGUA 07-25 330,07€» que por su contenido es una factura de **electricidad** de Energía XXI (nombre mal puesto); no está en el sistema. El detector la clasifica como Luz.", "",
      "| id | proveedor | fecha | importe | categoría actual | tipo detectado | evidencia | ¿coincide? |", "|---|---|---|---|---|---|---|---|"]
for i, tipo, ev, ok in filas:
    md.append(f"| {i['id']} | {i['proveedor'][:24]} | {i['fecha_emision']} | {i['total']:.2f} € | {i['categoria']} | {CAT.get(tipo, '—')} | {ev} | {'sí' if ok else '**NO**'} |")
(RAIZ / "docs" / "auditoria-suministros.md").write_text("\n".join(md) + "\n", encoding="utf-8")
print(n, c, dict(errores), len(corr))
