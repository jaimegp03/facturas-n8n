"""Precisión de la extracción, campo a campo, en las facturas TEST ingeridas de verdad (con Gemini).

Compara lo que guardó el sistema (GET /facturas) con tests/facturas-contables/esperado_contable.json.
Dos bloques:
  · campos que el esquema SÍ tiene: ¿los ha leído bien?
  · datos contables que el esquema NO puede guardar: cuentan como no capturados (evidencia de modelo de datos).
No imprime nada que no sea de las facturas TEST.

Uso: .venv\\Scripts\\python tests\\auditoria\\precision_extraccion.py
"""
import json
import re
import unicodedata
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "tests" / "salida" / "auditoria-contable"
env = dict(l.split("=", 1) for l in (RAIZ / ".env").read_text(encoding="utf-8").splitlines() if "=" in l)
BASE = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
H = {"X-API-Key": env["FACT_API_KEY"]}


def norm_txt(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def norm_nif(s):
    s = re.sub(r"[^A-Z0-9]", "", str(s or "").upper())
    return s[2:] if s.startswith("ES") and len(s) == 11 else s


def igual_num(a, b, tol=0.02):
    try:
        return a is not None and b is not None and abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def main():
    esperado = {e["archivo"]: e for e in json.loads((RAIZ / "tests/facturas-contables/esperado_contable.json").read_text(encoding="utf-8"))}
    filas = []
    for estado in ("", "borrada"):
        params = {"desde": "2000-01-01", "hasta": "2100-12-31", "por_pagina": 200}
        if estado:
            params["estado"] = estado
        filas += requests.get(BASE + "/facturas", headers=H, params=params, timeout=60).json()["items"]
    ingeridas = [f for f in filas if str(f.get("archivo_nombre", "")).startswith("TEST_") and not str(f.get("hash_sha256", "")).startswith("test-sintetico")]

    campos = {  # campo del esquema -> función que dice si acierta
        "proveedor": lambda f, e: norm_txt(e["proveedor"].replace("TEST·", "")) in norm_txt(f["proveedor"]),
        "nif": lambda f, e: norm_nif(f["nif"]) == norm_nif(e["proveedor_nif_en_documento"]),
        "numero": lambda f, e: (f["numero"] or None) == e["numero"],
        "fecha_emision": lambda f, e: f["fecha_emision"] == e["fecha_expedicion"],
        "fecha_vencimiento": lambda f, e: (f["fecha_vencimiento"] or None) == e["fecha_vencimiento"],
        "base (base imponible total)": lambda f, e: igual_num(f["base"], e["base_total"]),
        "iva_cuota (IVA + recargo)": lambda f, e: igual_num(f["iva_cuota"], e["cuota_iva_total"] + e["cuota_re_total"]),
        "iva_tipo": lambda f, e: (len(e["bases"]) == 1 and igual_num(f["iva_tipo"], e["bases"][0]["tipo_iva"], 0.001))
                                 or (not e["bases"] and igual_num(f["iva_tipo"], 0, 0.001)),
        "total (total factura)": lambda f, e: igual_num(f["total"], e["total_factura"]),
        "moneda": lambda f, e: (f["moneda"] or "").upper() == e["moneda"],
    }
    no_capturables = {
        "bases por tipo de IVA (si hay más de una)": lambda e: len(e["bases"]) > 1,
        "recargo de equivalencia separado": lambda e: e["cuota_re_total"] != 0,
        "retención IRPF": lambda e: e["irpf_cuota"] != 0,
        "total a pagar (total − retención)": lambda e: e["irpf_cuota"] != 0,
        "suplidos fuera de la base": lambda e: e["suplidos"] != 0,
        "tipo de factura (simplificada / rectificativa)": lambda e: e["tipo_factura"] != "completa",
        "factura que rectifica": lambda e: bool(e.get("rectifica")),
        "operación (intracomunitaria / ISP / extracomunitaria)": lambda e: e["operacion"] != "interior",
        "cuota autorrepercutida": lambda e: e["cuota_autorrepercutida"] != 0,
        "fecha de operación distinta": lambda e: e["fecha_operacion"] != e["fecha_expedicion"],
        "deducibilidad y motivo": lambda e: True,
        "cliente (destinatario) y su NIF": lambda e: True,
        "cuenta de gasto PGC y cuenta de proveedor": lambda e: True,
        "estado / fecha de pago": lambda e: True,
    }
    detalle, aciertos = [], {c: [0, 0] for c in campos}
    nc = {c: 0 for c in no_capturables}
    for f in sorted(ingeridas, key=lambda x: x["archivo_nombre"]):
        e = esperado.get(f["archivo_nombre"])
        if not e or "bases" not in e:
            continue
        fila = {"archivo": f["archivo_nombre"], "estado_sistema": f["estado"], "errores": {}}
        for c, ok in campos.items():
            r = bool(ok(f, e))
            aciertos[c][0] += r
            aciertos[c][1] += 1
            if not r:
                clave = c.split(" ")[0]
                fila["errores"][c] = {"guardado": f.get(clave), "esperado": {
                    "proveedor": e["proveedor"], "nif": e["proveedor_nif_en_documento"], "numero": e["numero"],
                    "fecha_emision": e["fecha_expedicion"], "fecha_vencimiento": e["fecha_vencimiento"],
                    "base": e["base_total"], "iva_cuota": round(e["cuota_iva_total"] + e["cuota_re_total"], 2),
                    "iva_tipo": [b["tipo_iva"] for b in e["bases"]], "total": e["total_factura"], "moneda": e["moneda"]}[clave]}
        for c, aplica in no_capturables.items():
            if aplica(e):
                nc[c] += 1
        detalle.append(fila)
    total_ok = sum(a for a, _ in aciertos.values())
    total_n = sum(n for _, n in aciertos.values())
    res = {"facturas_evaluadas": len(detalle),
           "precision_global_campos_esquema": f"{total_ok}/{total_n}",
           "por_campo": {c: f"{a}/{n}" for c, (a, n) in aciertos.items()},
           "datos_contables_no_capturables": {c: n for c, n in nc.items() if n},
           "detalle": detalle}
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / "precision_extraccion.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Facturas evaluadas: {len(detalle)} · precisión en campos del esquema: {total_ok}/{total_n}")
    for c, (a, n) in aciertos.items():
        print(f"  {c:<32} {a}/{n}")
    print("Datos contables que el esquema no guarda (nº de facturas afectadas):")
    for c, n in nc.items():
        if n:
            print(f"  {c:<52} {n}")
    for d in detalle:
        if d["errores"]:
            print(f"  · {d['archivo']} ({d['estado_sistema']}): " + "; ".join(f"{k}: {v['guardado']} ≠ {v['esperado']}" for k, v in d["errores"].items()))


if __name__ == "__main__":
    main()
