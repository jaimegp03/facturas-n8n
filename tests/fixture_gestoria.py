"""Datos de prueba del modo gestoría (sin Gemini), reutilizable para la web (Playwright) y probar_gestoria_b.py.

  python tests/fixture_gestoria.py crear [--sin-extracto]
      Crea (o reutiliza) los clientes TEST·Reformas García (general) y TEST·Panadería Lucía (recargo de
      equivalencia) por POST /clientes, inserta las 26 facturas de tests/facturas-contables/esperado_contable.json
      (todas menos la 17, que es la duplicada exacta de la 01) como filas mínimas por el MCP y las completa por
      PATCH /facturas?id=N, de modo que la API (bloque COMÚN, el mismo de la Ingesta) calcula desglose, deducibilidad,
      total a pagar, autorrepercusión, cuentas, NIF y tipo de cambio del BCE. El nº de recepción se asigna aquí
      igual que la Ingesta (correlativo por cliente y año de emisión). Genera los extractos de prueba
      tests/facturas-contables/extracto_TEST.n43 y extracto_TEST.csv y, salvo --sin-extracto, importa el N43 por
      POST /banco/importar. Imprime en JSON los ids de los clientes, de las facturas (por id de esperado) y el resultado
      de la importación.
  python tests/fixture_gestoria.py borrar [--copia CARPETA]
      Ejecuta «FACT — TEMP auditoría: borrar TEST» (facturas, reglas, movimientos, recomendaciones y clientes TEST),
      borra los originales TEST que hubiera en C:\\Users\\GOMEZ\\facturas-almacen y comprueba que fact_facturas,
      fact_clientes, fact_reglas y fact_categorias coinciden fila a fila (todas las columnas) con la instantánea que
      guardó «crear» antes de crear nada (tests/salida/fixture_gestoria/antes; si no existe, la copia
      tests/salida/backup-pre-tandaB-2026-10-15 o la de --copia) y que no quedan movimientos ni recomendaciones de clientes TEST.
      Sale con 1 si algo no cuadra.

Lee N8N_BASE_URL y FACT_API_KEY de .env y N8N_MCP_TOKEN del entorno. Nunca imprime tokens.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "tests" / "auditoria"))
CARPETA = RAIZ / "tests" / "facturas-contables"
ESPERADO = [e for e in json.loads((CARPETA / "esperado_contable.json").read_text(encoding="utf-8")) if "bases" in e]
PROYECTO = "bZtIqKac0YRZrt14"
TABLA_FACTURAS = "7PLB3ZEQRDVYx6iD"
TABLA_MOVIMIENTOS = "AlnHkQASriQlekIA"
TABLA_RECOMENDACIONES = "0LOu68SrmyMgKOIi"
TEMP_BORRAR = "MSwqgl62QaYcNj61"
ALMACEN = Path(r"C:\Users\GOMEZ\facturas-almacen")
COPIA = RAIZ / "tests" / "salida" / "backup-pre-tandaB-2026-10-15"
INSTANTANEA = RAIZ / "tests" / "salida" / "fixture_gestoria" / "antes"  # la guarda «crear» si no había datos TEST
CLIENTES = {"reformas": ("TEST·Reformas García e Hijos, S.L.", "B44173029", "general"),
            "panaderia": ("TEST·Panadería Lucía Martín", "48211735D", "recargo_equivalencia")}
# Categoría de cada factura (la cuenta del esperado se envía aparte cuando no es la de la categoría).
CATEGORIA = {"01": "Otros", "02": "Servicios profesionales", "03": "Servicios profesionales", "04": "Alquileres", "05": "Mercaderías",
             "06": "Transporte y combustible", "07": "Compras y materiales", "08": "Servicios profesionales", "09": "Software y apps",
             "10": "Subcontratas", "11": "Software y apps", "12": "Reparaciones y mantenimiento", "13": "Publicidad", "14": "Transporte y combustible",
             "15": "Servicios profesionales", "16": "Compras y materiales", "18": "Compras y materiales", "19": "Compras y materiales",
             "20": "Compras y materiales", "21": "Luz", "22": "Seguros",
             "23": "Restaurantes y comida a domicilio", "24": "Mercaderías", "25": "Alquileres", "26": "Servicios profesionales", "27": "Compras y materiales"}
OPERACION = {"servicio_extracomunitario": "extracomunitaria"}
SUFIJOS = {"sa", "sau", "sl", "slu", "sll", "slne", "scoop", "sc", "cb", "bv", "nv", "ab", "ltd", "limited", "inc", "llc", "gmbh", "ag", "plc", "corp",
           "corporation", "spa", "srl", "sas", "sarl", "oy", "aps", "as", "unipersonal", "co"}

# ---- extractos de prueba: 3 pagos que casan con facturas TEST de Reformas y 1 que no, en cada formato ----
CUENTA_N43 = ("2100", "0001", "0200012345")
MOV_N43 = [  # (fecha, importe, concepto, factura esperada)
    ("2026-08-05", -1020.00, "TRANSF INMUEBLES MALVARROSA ALQUILER AGOSTO", "25"),
    ("2026-08-12", -530.00, "TRANSFERENCIA ELENA RUIZ ABOGADA FRA 2026-0087", "02"),
    ("2026-08-28", -4404.34, "RECIBO MATERIALES CONSTRUCCION LEVANTE MCL-26-01988", "16"),
    ("2026-09-30", -37.45, "COMISION MANTENIMIENTO CUENTA", None),
]
MOV_CSV = [
    ("2026-08-03", "-423,50", "TRANSPORTES HUERTA SUR PORTES JULIO", "14"),
    ("2026-08-25", "-217,80", "PAGO LIMPIEZAS BRILLO TOTAL LB-2026-0412", "12"),
    ("2026-09-18", "-1.161,60", "RECIBO MATERIALES CONSTRUCCION LEVANTE", "18"),
    ("2026-09-20", "45,00", "BIZUM RECIBIDO", None),
]


def leer_env() -> dict:
    env = {}
    for linea in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("FACT_API_KEY"):
        sys.exit("FACT_API_KEY vacío en .env.")
    env.setdefault("N8N_BASE_URL", "http://localhost:5678")
    return env


class Api:
    def __init__(self):
        env = leer_env()
        self.base = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
        self.h = {"X-API-Key": env["FACT_API_KEY"]}

    def get(self, ruta, **params):
        return requests.get(self.base + ruta, headers=self.h, params=params, timeout=300)

    def post(self, ruta, cuerpo):
        return requests.post(self.base + ruta, headers=self.h, json=cuerpo, timeout=300)

    def patch(self, ruta, cuerpo, **params):
        return requests.patch(self.base + ruta, headers=self.h, params=params, json=cuerpo, timeout=300)

    def importar(self, archivo: Path, cliente_id: int):
        with archivo.open("rb") as h:
            return requests.post(self.base + "/banco/importar", headers=self.h, files=[("extracto", (archivo.name, h, "text/plain"))],
                                 data={"cliente_id": str(cliente_id)}, timeout=300)


def mcp():
    from mcp_cliente import MCP
    return MCP()


def normalizar_proveedor(s: str) -> str:
    t = unicodedata.normalize("NFD", s)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn").lower().replace(".", "")
    w = [x for x in re.sub(r"[^a-z0-9]+", " ", t).split() if x]
    while len(w) > 1 and w[-1] in SUFIJOS:
        w.pop()
    return " ".join(w)


def clientes_test(api: Api) -> dict:
    items = api.get("/clientes").json()["items"]
    return {k: next((x for x in items if x["nif"] == nif), None) for k, (_, nif, _) in CLIENTES.items()}


def filas_test(api: Api) -> list[dict]:
    filas = []
    for estado in (None, "borrada"):
        pagina = 1
        while True:
            params = {"por_pagina": 200, "pagina": pagina, **({"estado": estado} if estado else {})}
            j = api.get("/facturas", **params).json()
            filas += [f for f in j["items"] if str(f.get("archivo_nombre") or "").startswith("TEST_") or str(f.get("proveedor") or "").startswith("TEST·")]
            if pagina >= (j["paginas"] or 1):
                break
            pagina += 1
    return filas


# ---------------------------------------------------------------- extractos
def generar_extractos() -> tuple[Path, Path]:
    ent, ofi, cta = CUENTA_N43
    aamm = lambda f: f[2:4] + f[5:7] + f[8:10]  # noqa: E731
    regs = ["11" + ent + ofi + cta + "260801" + "260930" + "2" + f"{1500000:014d}" + "978" + "3" + "TEST REFORMAS GARCIA".ljust(26) + "   "]
    debe = haber = nd = nh = 0
    for fecha, imp, concepto, _ in MOV_N43:
        c = round(abs(imp) * 100)
        dh = "1" if imp < 0 else "2"
        if dh == "1":
            debe, nd = debe + c, nd + 1
        else:
            haber, nh = haber + c, nh + 1
        regs.append("22" + "    " + ofi + aamm(fecha) + aamm(fecha) + "04" + "000" + dh + f"{c:014d}" + "0" * 10 + "0" * 12 + "REF" + aamm(fecha) + " " * 7)
        regs.append("23" + "01" + concepto[:38].ljust(38) + concepto[38:76].ljust(38))
    saldo = 1500000 - debe + haber
    regs.append("33" + ent + ofi + cta + f"{nd:05d}" + f"{debe:014d}" + f"{nh:05d}" + f"{haber:014d}" + ("2" if saldo >= 0 else "1") + f"{abs(saldo):014d}" + "978" + "    ")
    regs.append("88" + "9" * 18 + f"{len(regs):06d}" + " " * 54)
    assert all(len(r) == 80 for r in regs), [len(r) for r in regs]
    n43 = CARPETA / "extracto_TEST.n43"
    n43.write_bytes(("\r\n".join(regs) + "\r\n").encode("ascii"))
    lineas = ["Fecha;Fecha valor;Concepto;Importe;Saldo"]
    saldo = 10000.0
    for fecha, imp, concepto, _ in MOV_CSV:
        saldo += float(imp.replace(".", "").replace(",", "."))
        dd = f"{fecha[8:10]}/{fecha[5:7]}/{fecha[:4]}"
        lineas.append(f"{dd};{dd};{concepto};{imp};" + f"{saldo:.2f}".replace(".", ","))
    csv = CARPETA / "extracto_TEST.csv"
    csv.write_text("\r\n".join(lineas) + "\r\n", encoding="utf-8")
    return n43, csv


# ---------------------------------------------------------------- crear
def guardar_instantanea() -> None:
    """Copia fact_facturas, fact_clientes, fact_reglas y fact_categorias (formato de backup_tablas.py) antes de crear."""
    import hashlib
    from mcp_cliente import TABLAS_TODAS, leer_tabla
    m = mcp()
    INSTANTANEA.mkdir(parents=True, exist_ok=True)
    manifest = {"creado": time.strftime("%Y-%m-%dT%H:%M:%S"), "proyecto": PROYECTO, "tablas": {}}
    for nombre in ("fact_facturas", "fact_clientes", "fact_reglas", "fact_categorias"):
        filas, total = leer_tabla(m, TABLAS_TODAS[nombre])
        ruta = INSTANTANEA / f"{nombre}.json"
        ruta.write_text(json.dumps({"tabla": nombre, "id": TABLAS_TODAS[nombre], "filas": filas}, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest["tablas"][nombre] = {"id": TABLAS_TODAS[nombre], "archivo": ruta.name, "filas": len(filas), "filas_en_tabla": total,
                                      "sha256": hashlib.sha256(ruta.read_bytes()).hexdigest()}
    (INSTANTANEA / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def crear(api: Api, con_extracto: bool = True) -> dict:
    cl = clientes_test(api)
    if not any(cl.values()) and not filas_test(api):
        guardar_instantanea()  # estado sin datos TEST: «borrar» comprobará que se vuelve a él
    for k, (nombre, nif, regimen) in CLIENTES.items():
        if cl[k] is None:
            r = api.post("/clientes", {"nombre": nombre, "nif": nif, "regimen_iva": regimen, "prorrata_pct": 100})
            if r.status_code != 201:
                sys.exit(f"POST /clientes {k}: HTTP {r.status_code}")
    cl = clientes_test(api)
    ids_cliente = {e["id"]: cl["panaderia" if e["cliente_nif"] == CLIENTES["panaderia"][1] else "reformas"]["id"] for e in ESPERADO}
    ya = {str(f.get("archivo_nombre") or "")[5:7]: f for f in filas_test(api) if str(f.get("archivo_nombre") or "").startswith("TEST_")}
    pendientes = [e for e in ESPERADO if e["id"] not in ya]
    # Nº de recepción: correlativo por cliente y año de emisión (como «Decidir estado final» de la Ingesta)
    contador: dict = {}
    for f in ya.values():
        if f.get("num_recepcion"):
            k = (f["cliente_id"], f["num_recepcion"][:4])
            contador[k] = max(contador.get(k, 0), int(f["num_recepcion"][5:]))
    ahora = time.strftime("%Y-%m-%dT%H:%M:%S+02:00")
    nuevas = []
    for e in sorted(pendientes, key=lambda x: (x["fecha_expedicion"], x["id"])):
        cid = ids_cliente[e["id"]]
        k = (cid, e["fecha_expedicion"][:4])
        contador[k] = contador.get(k, 0) + 1
        nuevas.append({
            "usuario_id": "default", "hash_sha256": ("testgb" + e["id"]).ljust(64, "0"), "archivo_ruta": None, "archivo_nombre": f"TEST_{e['id']}_fixture.pdf",
            "mime": "application/pdf", "proveedor": e["proveedor"], "proveedor_norm": normalizar_proveedor(e["proveedor"]), "nif": e["proveedor_nif_en_documento"],
            "numero": e["numero"], "fecha_emision": e["fecha_expedicion"], "fecha_vencimiento": e["fecha_vencimiento"], "lineas_json": "[]",
            "base": e["base_total"], "iva_tipo": max(e["bases"], key=lambda b: abs(b["base"]))["tipo_iva"] if e["bases"] else 0, "iva_cuota": e["cuota_iva_total"],
            "total": e["total_factura"], "moneda": e["moneda"], "metodo_pago": "Transferencia", "categoria": CATEGORIA[e["id"]], "subcategoria": None,
            "tipo_gasto": "puntual", "periodicidad": None, "confianza": 1, "motivo": "Fila de prueba (tests/fixture_gestoria.py).", "estado": "revisar",
            "errores_validacion": None, "origen_categoria": "manual", "creado": ahora, "actualizado": ahora, "cliente_id": cid,
            "destinatario_nif": None if e["tipo_factura"] == "simplificada" else e["cliente_nif"], "desglose_iva_json": None, "tipo_cambio": None,
            "total_eur": None, "num_recepcion": f"{k[1]}-{contador[k]:06d}", "estado_pago": "pendiente",
        })
    if nuevas:
        mcp().call("add_data_table_rows", {"dataTableId": TABLA_FACTURAS, "projectId": PROYECTO, "rows": nuevas})
    por_id = {str(f.get("archivo_nombre") or "")[5:7]: f for f in filas_test(api) if str(f.get("archivo_nombre") or "").startswith("TEST_")}
    problemas = []
    for e in pendientes:
        f = por_id[e["id"]]
        cuerpo = {
            "categoria": CATEGORIA[e["id"]], "cuenta_gasto": e["cuenta_gasto"], "tipo_factura": e["tipo_factura"], "rectifica_numero": e["rectifica"],
            "fecha_operacion": e["fecha_operacion"], "operacion": OPERACION.get(e["operacion"], e["operacion"]),
            "desglose_iva_json": [{"base": b["base"], "tipo_iva": b["tipo_iva"], "cuota_iva": b["cuota_iva"], "tipo_re": b["tipo_re"], "cuota_re": b["cuota_re"]} for b in e["bases"]],
            "base_exenta": e["base_no_sujeta_o_exenta"], "irpf_tipo": e["irpf_tipo"], "irpf_cuota": e["irpf_cuota"], "suplidos": e["suplidos"],
            "total": e["total_factura"], "moneda": e["moneda"], "estado_pago": e["estado_pago"],
        }
        if e["estado_pago"] == "pagada":
            cuerpo["fecha_pago"] = e["fecha_pago"]
        r = api.patch("/facturas", cuerpo, id=f["id"])
        j = r.json() if r.headers.get("Content-Type", "").startswith("application/json") else {}
        if r.status_code != 200 or j.get("factura", {}).get("estado") != "ok":
            problemas.append({"id": e["id"], "http": r.status_code, "estado": j.get("factura", {}).get("estado"), "errores": j.get("revalidacion", {}).get("errores") or j.get("error")})
    por_id = {str(f.get("archivo_nombre") or "")[5:7]: f for f in filas_test(api) if str(f.get("archivo_nombre") or "").startswith("TEST_")}
    n43, csv = generar_extractos()
    importacion = None
    if con_extracto:
        r = api.importar(n43, cl["reformas"]["id"])
        importacion = r.json() if r.status_code == 200 else {"http": r.status_code, "error": r.text[:300]}
    return {"clientes": {k: v["id"] for k, v in cl.items()}, "facturas": {k: v["id"] for k, v in sorted(por_id.items())},
            "problemas": problemas, "extractos": [str(n43), str(csv)], "importacion": importacion}


# ---------------------------------------------------------------- borrar
def borrar(api: Api, copia: Path) -> int:
    m = mcp()
    from mcp_cliente import TABLAS_TODAS, leer_tabla
    test_ids = {v["id"] for v in clientes_test(api).values() if v}
    rutas = [f.get("archivo_ruta") for f in filas_test(api) if f.get("archivo_ruta")]
    r = m.call("execute_workflow", {"workflowId": TEMP_BORRAR, "executionMode": "manual"})
    ex = str(r.get("executionId"))
    for _ in range(60):
        e = m.call("get_workflow_execution", {"workflowId": TEMP_BORRAR, "executionId": ex})
        estado = (e.get("execution") or e).get("status")
        if estado in ("success", "error", "crashed", "canceled"):
            break
        time.sleep(1)
    fallos = []
    if estado != "success":
        fallos.append(f"«borrar TEST» terminó en {estado}")
    for ruta in rutas:  # originales TEST en disco (las filas del fixture no tienen; las de una ingesta real sí)
        if ruta.startswith("/home/node/.n8n-files/facturas/"):
            p = ALMACEN / ruta[len("/home/node/.n8n-files/facturas/"):]
            if p.exists():
                p.unlink()
    manifest = json.loads((copia / "manifest.json").read_text(encoding="utf-8"))
    for nombre in ("fact_facturas", "fact_clientes", "fact_reglas", "fact_categorias"):
        if nombre not in manifest["tablas"]:
            continue
        antes = {f["id"]: f for f in json.loads((copia / manifest["tablas"][nombre]["archivo"]).read_text(encoding="utf-8"))["filas"]}
        ahora, _ = leer_tabla(m, TABLAS_TODAS[nombre])
        ahora = {f["id"]: f for f in ahora}
        if set(antes) != set(ahora):
            fallos.append(f"{nombre}: ids distintos (sobran {sorted(set(ahora) - set(antes))[:10]}, faltan {sorted(set(antes) - set(ahora))[:10]})")
        for i in set(antes) & set(ahora):
            difs = [c for c in antes[i] if antes[i][c] != ahora[i].get(c, "<sin columna>")]
            if difs:
                fallos.append(f"{nombre} id={i}: columnas distintas {difs}")
    for tabla, nombre in ((TABLA_MOVIMIENTOS, "fact_movimientos"), (TABLA_RECOMENDACIONES, "fact_recomendaciones")):
        filas, _ = leer_tabla(m, tabla)
        quedan = [f["id"] for f in filas if f.get("cliente_id") in test_ids]
        if quedan:
            fallos.append(f"{nombre}: quedan filas de clientes TEST {quedan[:10]}")
    print(json.dumps({"borrado": estado, "clientes_test_borrados": sorted(test_ids), "fallos": fallos}, ensure_ascii=False, indent=2))
    return 1 if fallos else 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2 or sys.argv[1] not in ("crear", "borrar"):
        print(__doc__)
        return 2
    api = Api()
    if sys.argv[1] == "crear":
        res = crear(api, "--sin-extracto" not in sys.argv)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 1 if res["problemas"] else 0
    copia = Path(sys.argv[sys.argv.index("--copia") + 1]) if "--copia" in sys.argv else (INSTANTANEA if (INSTANTANEA / "manifest.json").exists() else COPIA)
    return borrar(api, copia)


if __name__ == "__main__":
    sys.exit(main())
