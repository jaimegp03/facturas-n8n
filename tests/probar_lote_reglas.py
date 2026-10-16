"""PATCH /facturas/lote aprende reglas igual que PATCH /facturas?id= (sin Gemini).

  python tests/probar_lote_reglas.py

Usa las facturas TEST del cliente «TEST·Restaurante La Barraca del Puerto, S.L.» (archivo_nombre TEST_R…). Si no
existen, sale con código 2 sin hacer nada. Casos: cuenta_gasto en dos proveedores (2 reglas nuevas con cliente_id),
categoría (regla de categoría), dos facturas del mismo proveedor (una sola regla; segunda pasada: usos + 1 sin duplicar
filas), cuenta que no empieza por 60 (cuenta_proveedor 410), y un lote sin cambios de categoría/cuenta (reglas 0).
Una cuenta ya igual a la actual no genera regla (misma condición que el PATCH individual), por eso los valores nuevos
se eligen distintos de los actuales. No borra nada: limpia después con «FACT — TEMP auditoría: borrar TEST».
"""
from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests"))
sys.path.insert(0, str(RAIZ / "tests" / "auditoria"))
import fixture_gestoria as fx  # noqa: E402
from mcp_cliente import TABLAS_TODAS, leer_tabla  # noqa: E402

res: list[tuple[str, bool]] = []


def check(n, ok, det=""):
    res.append((n, bool(ok)))
    print(f"  [{'OK' if ok else 'FALLO'}] {n}" + (f" — {det}" if det and not ok else ""))
    return ok


def main() -> int:
    api = fx.Api()
    m = fx.mcp()
    facturas, _ = leer_tabla(m, TABLAS_TODAS["fact_facturas"])
    fr = [f for f in facturas if (f.get("archivo_nombre") or "").startswith("TEST_R")]
    if not fr:
        print("No hay facturas TEST_R…; nada que probar.")
        return 2
    cid = fr[0]["cliente_id"]

    def por_prov(sub):
        return [f for f in fr if sub in (f["proveedor_norm"] or "")]

    def reglas():
        r, _ = leer_tabla(m, TABLAS_TODAS["fact_reglas"])
        return r

    def regla(prov_norm, cliente=cid):
        return [r for r in reglas() if r["proveedor_norm"] == prov_norm and r.get("cliente_id") == cliente]

    def usos(prov):
        r = regla(prov)
        return r[0]["usos"] if r else 0

    def lote(ids, cambios):
        r = api.patch("/facturas/lote", {"ids": ids, "cambios": cambios})
        return r.status_code, r.json()

    def fila(i):
        return next(f for f in leer_tabla(m, TABLAS_TODAS["fact_facturas"])[0] if f["id"] == i)

    def otra(actual, a, b):
        return b if actual == a else a

    antes_glob = sorted((r["id"], r["usos"]) for r in reglas() if r.get("cliente_id") != cid)

    # A: cuenta_gasto en dos proveedores distintos -> 2 reglas nuevas del cliente
    print("A) cuenta_gasto en Higiene Profesional y Obrador Horno Viejo")
    hig, obr = por_prov("higiene profesional")[0], por_prov("obrador horno viejo")[0]
    cu_h = cu_o = next(x for x in ("601", "602", "603") if x not in (hig["cuenta_gasto"], obr["cuenta_gasto"]))
    n0 = len(reglas())
    u_h, u_o = usos(hig["proveedor_norm"]), usos(obr["proveedor_norm"])
    nuevas_a = (u_h == 0) + (u_o == 0)
    st, j = lote([hig["id"], obr["id"]], {"cuenta_gasto": cu_h})
    check("A: 200 y sin errores", st == 200 and not j["errores"], str(j))
    check("A: reglas = 2", j["reglas"] == 2, str(j))
    check("A: dos filas nuevas en fact_reglas", len(reglas()) == n0 + nuevas_a)
    rh, ro = regla(hig["proveedor_norm"]), regla(obr["proveedor_norm"])
    check("A: regla Higiene con cliente_id y cuenta", len(rh) == 1 and rh[0]["cuenta_gasto"] == cu_h and rh[0]["usos"] == u_h + 1, str(rh))
    check("A: regla Obrador con cliente_id y cuenta", len(ro) == 1 and ro[0]["cuenta_gasto"] == cu_o and ro[0]["usos"] == u_o + 1, str(ro))
    check("A: cuenta_proveedor 400 (cuenta 60x)", fila(hig["id"])["cuenta_proveedor"] == "400" and fila(obr["id"])["cuenta_proveedor"] == "400")

    # B: categoría -> regla de categoría
    print("B) categoría de Carnes Selectas")
    car = por_prov("carnes selectas")[0]
    cat = otra(car["categoria"], "Mercaderías", "Alimentación y supermercado")
    u_c = usos(car["proveedor_norm"])
    st, j = lote([car["id"]], {"categoria": cat})
    rc = regla(car["proveedor_norm"])
    check("B: reglas = 1", st == 200 and j["reglas"] == 1, str(j))
    check("B: regla con la categoría y usos + 1", len(rc) == 1 and rc[0]["categoria"] == cat and rc[0]["usos"] == u_c + 1, str(rc))
    check("B: factura recategorizada (origen manual)", fila(car["id"])["categoria"] == cat and fila(car["id"])["origen_categoria"] == "manual")

    # C/D: dos facturas del mismo proveedor -> una sola regla; segunda pasada usos 2
    print("C) dos facturas de Distribuciones Bebidas Valencia")
    beb = por_prov("distribuciones bebidas valencia")
    ids = [f["id"] for f in beb]
    check("C: hay 2 facturas del proveedor", len(ids) == 2, str(ids))
    cu = otra(beb[0]["cuenta_gasto"], "601", "602")
    n0 = len(reglas())
    u_b = usos(beb[0]["proveedor_norm"])
    st, j = lote(ids, {"cuenta_gasto": cu})
    rb = regla(beb[0]["proveedor_norm"])
    check("C: actualizadas 2 y reglas 1", st == 200 and j["actualizadas"] == 2 and j["reglas"] == 1, str(j))
    check("C: una sola fila nueva", len(reglas()) == n0 + (u_b == 0) and len(rb) == 1, str(len(rb)))
    check("C: usos + 1 (una vez aunque sean 2 facturas)", rb[0]["usos"] == u_b + 1 and rb[0]["cuenta_gasto"] == cu, str(rb))
    cu2 = otra(cu, "601", "602")
    st, j = lote(ids, {"cuenta_gasto": cu2})
    rb = regla(beb[0]["proveedor_norm"])
    check("D: segunda pasada: reglas 1, sigue una fila y usos + 2", st == 200 and j["reglas"] == 1 and len(rb) == 1 and rb[0]["usos"] == u_b + 2 and rb[0]["cuenta_gasto"] == cu2, str(rb))

    # E: cuenta que no es 60x -> cuenta_proveedor 410
    print("E) cuenta 629 en Gases Butano")
    gas = por_prov("gases butano")[0]
    st, j = lote([gas["id"]], {"cuenta_gasto": otra(gas["cuenta_gasto"], "629", "628")})
    rg = regla(gas["proveedor_norm"])
    cp = fila(gas["id"])["cuenta_proveedor"]
    check("E: regla creada", st == 200 and j["reglas"] == 1 and len(rg) == 1, str(j))
    check("E: cuenta_proveedor 410", cp == "410", cp)

    # F: sin cambios de categoría/cuenta -> reglas 0, nada nuevo
    print("F) lote de estado_pago (sin reglas)")
    n0 = len(reglas())
    st, j = lote([hig["id"], obr["id"]], {"estado_pago": "pendiente"})
    check("F: reglas = 0 y sin filas nuevas", st == 200 and j["reglas"] == 0 and len(reglas()) == n0, str(j))
    st, j = lote([hig["id"], 999999], {"cuenta_gasto": "XX"})
    check("F: contrato intacto (400 con cuenta no válida / errores por id)", st == 200 and j["actualizadas"] == 0 and len(j["errores"]) == 2 and j["reglas"] == 0, f"{st} {j}")

    despues_glob = sorted((r["id"], r["usos"]) for r in reglas() if r.get("cliente_id") != cid)
    check("G: reglas de otros clientes intactas", antes_glob == despues_glob)

    ok = sum(1 for _, o in res if o)
    print(f"\n{ok}/{len(res)} OK")
    return 0 if ok == len(res) else 1


if __name__ == "__main__":
    sys.exit(main())
