"""Fase 3 (tickets): sube <=6 tickets TEST_T.. por el webhook (6 llamadas a Gemini como maximo), compara con
tests/esperado_tickets.json y limpia.

  python tests/probar_tickets.py --subir      sube T01, T02, T04, T06, T08 y T07 (copia de T02), guarda la respuesta
  python tests/probar_tickets.py --comprobar  compara la respuesta guardada con lo esperado
  python tests/probar_tickets.py --limpiar    ejecuta «FACT — TEMP auditoría: borrar TEST» y borra los originales del almacen
Sin argumentos: --subir --comprobar. No sube de nuevo los que ya estan en la respuesta guardada."""
import json, os, sys, time
from pathlib import Path
import requests

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests" / "auditoria"))
CARP = RAIZ / "tests" / "tickets-ejemplo"
SAL = RAIZ / "tests" / "salida" / "tickets"
SAL.mkdir(parents=True, exist_ok=True)
GUARDADO = SAL / "ingesta.json"
ESP = {e["id"]: e for e in json.loads((RAIZ / "tests" / "esperado_tickets.json").read_text(encoding="utf-8"))}
ORDEN = ["T01", "T02", "T04", "T06", "T08", "T07"]
ALMACEN = Path(r"C:\Users\GOMEZ\facturas-almacen")
TEMP_BORRAR = "MSwqgl62QaYcNj61"
MIME = {".jpg": "image/jpeg", ".png": "image/png"}


def env():
    d = {}
    for l in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.split("=", 1)
            d[k.strip()] = v.strip().strip('"').strip("'")
    d.setdefault("N8N_BASE_URL", "http://localhost:5678")
    return d


def subir():
    e = env()
    url = e["N8N_BASE_URL"].rstrip("/") + "/webhook/facturas"
    res = json.loads(GUARDADO.read_text(encoding="utf-8")) if GUARDADO.exists() else {}
    llamadas = 0
    for i in ORDEN:
        if i in res:
            continue
        f = CARP / ESP[i]["archivo"]
        with f.open("rb") as h:
            r = requests.post(url, files=[("archivo", (f.name, h, MIME[f.suffix]))], headers={"X-API-Key": e["FACT_API_KEY"]}, timeout=300)
        llamadas += 1
        res[i] = {"http": r.status_code, "cuerpo": r.json() if r.headers.get("content-type", "").startswith("application/json") else None}
        GUARDADO.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  {i}: HTTP {r.status_code}")
    print(f"Llamadas a la Ingesta (una por ticket, 1 Gemini c/u): {llamadas}")


resultados = []


def check(n, ok, d=""):
    resultados.append(bool(ok))
    print(f"  [{'OK' if ok else 'FALLO'}] {n}" + (f" - {d}" if d else ""))


def comprobar():
    res = json.loads(GUARDADO.read_text(encoding="utf-8"))
    for i in ORDEN:
        x = ESP[i]
        r = (res.get(i) or {}).get("cuerpo") or {}
        it = (r.get("resultados") or [{}])[0]
        f = it.get("factura") or {}
        print(f"{i} {x['archivo']}  estado={it.get('estado')} modelo={(it.get('extraccion') or {}).get('modelo')} modo={(it.get('extraccion') or {}).get('modo')}")
        if it.get("estado") == "error":
            check(f"{i} procesado", False, str(it.get("error"))[:120])
            continue
        err = f.get("errores_validacion") or ""
        if x["estado"] == "revisar":
            check(f"{i} borroso => revisar", f.get("estado") == "revisar", err[:140])
            check(f"{i} motivo claro", bool(err))
            continue
        if x["copia_de"]:
            check(f"{i} duplicado detectado (posible_duplicada)", f.get("estado") == "posible_duplicada", err[:100])
            continue
        check(f"{i} estado ok", f.get("estado") == "ok", err[:140])
        check(f"{i} categoria", f.get("categoria") == x["categoria"] or (i == "T08" and f.get("categoria") in ("Hogar", "Ropa y calzado")), str(f.get("categoria")))
        check(f"{i} total", abs((f.get("total") or 0) - x["total"]) <= 0.02, f"{f.get('total')} vs {x['total']}")
        check(f"{i} base", abs((f.get("base") or 0) - x["base"]) <= 0.03, f"{f.get('base')} vs {x['base']}")
        check(f"{i} iva_cuota", abs((f.get("iva_cuota") or 0) - x["iva_cuota"]) <= 0.03, f"{f.get('iva_cuota')} vs {x['iva_cuota']}")
        ls = json.loads(f.get("lineas_json") or "[]")
        check(f"{i} lineas >= {x['n_lineas']}", len(ls) >= x["n_lineas"], str(len(ls)))
        check(f"{i} tipo_factura simplificada", str(f.get("tipo_factura", "")).startswith("simplificada"), str(f.get("tipo_factura")))
        check(f"{i} deducible na (particular)", f.get("deducible") == "na", str(f.get("deducible")))
        if x["nif"] is None:
            check(f"{i} sin NIF no es motivo de revisar", not f.get("nif") and "NIF" not in err.upper().split("(")[0] and f.get("estado") == "ok")
        if x["numero"] is None:
            check(f"{i} sin numero no es motivo de revisar", f.get("estado") == "ok")
        if x["propina"]:
            check(f"{i} propina no rompe la validacion", f.get("estado") == "ok" and abs((f.get("suplidos") or 0) - x["propina"]) <= 0.02, f"suplidos={f.get('suplidos')}")
        if x["hora"]:
            check(f"{i} hora", f.get("hora") == x["hora"], str(f.get("hora")))
        check(f"{i} pagada", f.get("estado_pago") == "pagada", str(f.get("estado_pago")))
    print(f"\nComprobaciones: {sum(resultados)}/{len(resultados)} OK")
    return 0 if all(resultados) else 1


def limpiar():
    from mcp_cliente import MCP
    m = MCP()
    r = m.call("execute_workflow", {"workflowId": TEMP_BORRAR, "executionMode": "manual"})
    ex = str(r.get("executionId"))
    estado = None
    for _ in range(60):
        e = m.call("get_workflow_execution", {"workflowId": TEMP_BORRAR, "executionId": ex})
        estado = (e.get("execution") or e).get("status")
        if estado in ("success", "error", "crashed", "canceled"):
            break
        time.sleep(1)
    borrados = 0
    if GUARDADO.exists():
        for v in json.loads(GUARDADO.read_text(encoding="utf-8")).values():
            for it in ((v.get("cuerpo") or {}).get("resultados") or []):
                ruta = (it.get("factura") or {}).get("archivo_ruta") or ""
                if ruta.startswith("/home/node/.n8n-files/facturas/"):
                    p = ALMACEN / ruta[len("/home/node/.n8n-files/facturas/"):]
                    if p.exists():
                        p.unlink()
                        borrados += 1
    print(f"Borrado TEST: {estado}; originales borrados del almacen: {borrados}")
    return 0 if estado == "success" else 1


if __name__ == "__main__":
    a = sys.argv[1:] or ["--subir", "--comprobar"]
    rc = 0
    if "--subir" in a:
        subir()
    if "--comprobar" in a:
        rc = comprobar()
    if "--limpiar" in a:
        rc = limpiar() or rc
    sys.exit(rc)
