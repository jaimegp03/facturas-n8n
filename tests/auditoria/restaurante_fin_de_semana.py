"""Facturas TEST de un restaurante para el fin de semana del 10-11/10/2026 (proveedores habituales de hostelería).

Reutiliza el generador contable (tests/facturas_contables.py). Todo es ficticio y va marcado «TEST·» / «TEST_».
Crea tests/facturas-restaurante/ con los documentos y esperado_restaurante.json (lo que apuntaría el dueño).

Uso: .venv\\Scripts\\python -W ignore tests\\auditoria\\restaurante_fin_de_semana.py
"""
import json
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "tests"))
import facturas_contables as fc                     # noqa: E402
from generar_facturas import como_foto, rasterizar  # noqa: E402

SALIDA = RAIZ / "tests" / "facturas-restaurante"
CLIENTE = dict(nombre="TEST·Restaurante La Barraca del Puerto, S.L.", nif=fc.cif("B", 9640127),
               dom="Paseo Marítimo 14, 46011 Valencia", regimen="general")
fc.GESTORIA_CLIENTES["R"] = CLIENTE

PROV = {
    "pescado": ("TEST·Pescados Mar de Levante, S.L.", fc.cif("B", 4100233)),
    "bebidas": ("TEST·Distribuciones Bebidas Valencia, S.A.", fc.cif("A", 4700128)),
    "carne": ("TEST·Carnes Selectas Meliá, S.L.", fc.cif("B", 8012445)),
    "verdura": ("TEST·Frutas y Verduras Huerta del Turia, S.L.", fc.cif("B", 5230987)),
    "pan": ("TEST·Obrador Horno Viejo, S.C.", fc.cif("J", 9915320)),
    "cash": ("TEST·Cash & Carry Valencia Norte, S.A.", fc.cif("A", 3321809)),
    "gas": ("TEST·Gases Butano Levante, S.L.", fc.cif("B", 1180764)),
    "limpieza": ("TEST·Higiene Profesional Valencia, S.L.", fc.cif("B", 6609312)),
    "vino_pt": ("TEST·Vinhos do Douro Lda", "PT501964843"),
}
for k, (n, nif) in PROV.items():
    fc.P["r_" + k] = dict(nombre=n, nif=nif)


def c(id_, prov, numero, fecha, lineas, **kw):
    return fc.caso(id=id_, archivo=f"TEST_R{id_}_{prov}.pdf", prov="r_" + prov, numero=numero, fecha=fecha,
                   lineas=lineas, cliente="R", **kw)


CASOS = [
    c("01", "pescado", "PM-2026-18344", "2026-10-09", [("Lubina de piscifactoría 12 kg", 12, 14.50, 10), ("Gamba roja 5 kg", 5, 28.00, 10),
       ("Mejillón gallego 10 kg", 10, 4.20, 10), ("Calamar fresco 6 kg", 6, 11.90, 10)], vence="2026-10-23"),
    c("02", "bebidas", "DB-26-091522", "2026-10-10", [("Cerveza barril 30 L (x4)", 4, 96.00, 21), ("Refrescos caja 24 uds (x6)", 6, 17.40, 21),
       ("Vino tinto crianza D.O. Valencia (caja 6)", 8, 31.50, 21), ("Agua mineral 1/2 L (caja 24)", 10, 5.80, 10)], vence="2026-11-09"),
    c("03", "carne", "CS-2026-6620", "2026-10-09", [("Entrecot de ternera 18 kg", 18, 19.80, 10), ("Cordero lechal 6 kg", 6, 16.40, 10),
       ("Jamón ibérico de bellota (pieza)", 1, 189.00, 10)], vence="2026-10-24"),
    c("04", "verdura", "FV-2026-3105", "2026-10-11", [("Tomate de ensalada 20 kg", 20, 1.95, 4), ("Lechuga y verdura de hoja", 1, 41.50, 4),
       ("Limón 10 kg", 10, 1.60, 4), ("Aceite de oliva virgen extra 5 L (x4)", 4, 29.90, 10)], pagada="2026-10-11"),
    c("05", "pan", "OH-26-0411", "2026-10-11", [("Pan de barra y mini hogazas (fin de semana)", 1, 46.15, 4)], pagada="2026-10-11"),
    c("06", "cash", "T-2026-77231", "2026-10-10", [("Compra urgente: servilletas, film, papel y bolsas", 1, 71.40, 21)],
       tipo_doc="simplificada", formato="foto", pagada="2026-10-10"),
    c("07", "gas", "GBL-26-5120", "2026-10-10", [("Bombona butano industrial 35 kg (x3)", 3, 37.50, 21), ("Alquiler de bombonas y transporte", 1, 12.00, 21)],
       pagada="2026-10-10"),
    c("08", "bebidas", "R-DB-26-0113", "2026-10-11", [("Abono: 1 barril de cerveza 30 L recibido en mal estado", 1, -96.00, 21)],
       tipo_doc="rectificativa", rectifica="DB-26-091522", rectifica_fecha="2026-10-10"),
    c("09", "limpieza", "HP-2026-2290", "2026-10-10", [("Desengrasante industrial 5 L (x4)", 4, 14.80, 21), ("Detergente lavavajillas (garrafa 20 L)", 2, 38.60, 21),
       ("Guantes y bayetas profesionales", 1, 22.30, 21)], vence="2026-10-30"),
    c("10", "vino_pt", "PT-2026-00418", "2026-10-09", [("Vinho Verde Alvarinho 2025 (caja 6) x12", 12, 41.00, None)],
       vence="2026-11-08", menciones=["Entrega intracomunitaria exenta de IVA (art. 14 CIVA / art. 138 Directiva 2006/112/CE)"]),
]


def main():
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir(parents=True)
    esperado = []
    for caso in CASOS:
        prov = fc.P[caso["prov"]]
        imp = fc.calcular(caso)
        ruta = SALIDA / caso["archivo"]
        if caso["formato"] == "foto":
            ruta = ruta.with_suffix(".jpg")
            como_foto(rasterizar(fc.pdf(caso, prov["nif"], imp), 110)).save(ruta, "JPEG", quality=80)
        else:
            ruta.write_bytes(fc.pdf(caso, prov["nif"], imp))
        esperado.append(dict(id=caso["id"], archivo=ruta.name, proveedor=prov["nombre"], nif=prov["nif"], numero=caso["numero"],
                             fecha=caso["fecha"], vence=caso["vence"], pagada=caso["pagada"], tipo_factura=caso["tipo_doc"],
                             rectifica=caso.get("rectifica"), **imp))
    shutil.copyfile(SALIDA / CASOS[0]["archivo"], SALIDA / "TEST_R11_duplicada_de_pescado.pdf")
    esperado.append(dict(id="11", archivo="TEST_R11_duplicada_de_pescado.pdf", duplicada_de=CASOS[0]["archivo"]))
    (SALIDA / "esperado_restaurante.json").write_text(json.dumps(dict(cliente=CLIENTE, facturas=esperado), ensure_ascii=False, indent=2), encoding="utf-8")
    tot = sum(e["total_factura"] for e in esperado if "total_factura" in e)
    iva = sum(e["cuota_iva_total"] for e in esperado if "cuota_iva_total" in e)
    for e in esperado:
        print(f"{e['archivo']:<46}{e.get('total_factura', ''):>10}")
    print(f"TOTAL esperado (suma de totales): {tot:.2f} · IVA soportado: {iva:.2f} · cliente NIF {CLIENTE['nif']}")


if __name__ == "__main__":
    main()
