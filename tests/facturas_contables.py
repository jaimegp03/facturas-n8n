"""Facturas TEST con casos contables reales para la auditoría (gestoría, facturas recibidas).

Se invoca desde generar_facturas.py con --contables. Crea tests/facturas-contables/ con 27 documentos y
esperado_contable.json con lo que apuntaría un contable para cada uno (bases por tipo, retención,
recargo, deducibilidad, cuenta PGC, modelos afectados...).

Todo es ficticio y va marcado: proveedores «TEST·…», archivos «TEST_…». Los NIF se generan con dígito de
control correcto salvo el caso de NIF inválido, que se rompe a propósito.
"""
import io
import json
import random
import shutil
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

SALIDA = Path(__file__).parent / "facturas-contables"
LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE"

# ---------------------------------------------------------------- NIF / CIF con control

def cif(letra, num7):
    d = f"{num7:07d}"
    par = sum(int(d[i]) for i in (1, 3, 5))
    impar = sum(sum(divmod(int(d[i]) * 2, 10)) for i in (0, 2, 4, 6))
    c = (10 - (par + impar) % 10) % 10
    ctrl = "JABCDEFGHI"[c] if letra in "KPQS" else str(c)
    return f"{letra}{d}{ctrl}"


def dni(num8):
    return f"{num8:08d}{LETRAS_DNI[num8 % 23]}"


def nif_valido(n):
    n = n.upper().replace("-", "").replace(" ", "").replace(".", "")
    if n.startswith("ES"):
        n = n[2:]
    if len(n) == 9 and n[:8].isdigit():
        return n[8] == LETRAS_DNI[int(n[:8]) % 23]
    if len(n) == 9 and n[0] in "ABCDEFGHJNPQRSUVW" and n[1:8].isdigit():
        return cif(n[0], int(n[1:8])) == n
    return False


# ---------------------------------------------------------------- partes del caso

GESTORIA_CLIENTES = {
    "A": dict(nombre="TEST·Reformas García e Hijos, S.L.", nif=cif("B", 4417302), dom="C/ Mayor 12, 46001 Valencia",
              regimen="general"),
    "B": dict(nombre="TEST·Panadería Lucía Martín", nif=dni(48211735), dom="Av. del Puerto 88, 46023 Valencia",
              regimen="recargo_equivalencia"),
}

P = {  # proveedores
    "makro": dict(nombre="TEST·Distribuciones Mayoristas del Turia, S.A.", nif=cif("A", 4610233)),
    "abogado": dict(nombre="TEST·Elena Ruiz Abogada", nif=dni(29384756)),
    "disenador": dict(nombre="TEST·Pablo Soler Diseño", nif=dni(53102944)),
    "casero": dict(nombre="TEST·Inmuebles Malvarrosa, S.L.", nif=cif("B", 9871234)),
    "harinas": dict(nombre="TEST·Harinas y Levaduras Levante, S.L.", nif=cif("B", 3361780)),
    "gasolinera": dict(nombre="TEST·Estación de Servicio Pista de Silla", nif=cif("B", 2200917)),
    "ferreteria": dict(nombre="TEST·Ferretería Ruzafa, S.L.", nif=cif("B", 5502348)),
    "cloud": dict(nombre="TEST·Cloudhost Ireland Ltd", nif="IE3668997OH"),
    "subcontrata": dict(nombre="TEST·Albañilería Benimaclet, S.L.", nif=cif("B", 7310452)),
    "saas_us": dict(nombre="TEST·Tasklytics Inc.", nif="EIN 84-3920571"),
    "nif_malo": dict(nombre="TEST·Limpiezas Brillo Total, S.L.", nif=cif("B", 6620981)[:-1] + "0"),
    "sin_numero": dict(nombre="TEST·Imprenta Express Valencia, S.L.", nif=cif("B", 1287654)),
    "transportes": dict(nombre="TEST·Transportes Huerta Sur, S.L.", nif=cif("B", 4458209)),
    "gestor": dict(nombre="TEST·Gestoría Administrativa Colón", nif=dni(22917364)),
    "materiales": dict(nombre="TEST·Materiales de Construcción Levante, S.L.", nif=cif("B", 9045612)),
    "telefono": dict(nombre="TEST·Telecomunicaciones Albufera, S.A.", nif=cif("A", 8123457)),
    "seguros": dict(nombre="TEST·Seguros del Mediterráneo, S.A.", nif=cif("A", 2810453)),
    "restaurante": dict(nombre="TEST·Restaurante El Racó", nif=cif("B", 9733201)),
}
# El caso «nif_malo» tiene a propósito un dígito de control incorrecto
assert not nif_valido(P["nif_malo"]["nif"]) or P["nif_malo"]["nif"].endswith("0")


def r2(x):
    return round(x + 1e-9, 2)


def eur(x, moneda="EUR"):
    s = f"{abs(x):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    s = ("-" if x < 0 else "") + s
    return f"{s} €" if moneda == "EUR" else f"{s} {moneda}"


def fecha_es(iso):
    if not iso:
        return "—"
    a, m, d = iso.split("-")
    return f"{d}/{m}/{a}"


# ---------------------------------------------------------------- definición de los 27 casos
# lineas: (concepto, cantidad, precio_unitario_sin_iva, tipo_iva o None si no sujeta/exenta)
# re: aplicar recargo de equivalencia; irpf: % retención; suplidos: [(concepto, importe)]

def caso(**k):
    k.setdefault("moneda", "EUR")
    k.setdefault("re", False)
    k.setdefault("irpf", 0)
    k.setdefault("suplidos", [])
    k.setdefault("vence", None)
    k.setdefault("pagada", None)
    k.setdefault("f_operacion", None)
    k.setdefault("tipo_doc", "completa")
    k.setdefault("menciones", [])
    k.setdefault("formato", "pdf")
    k.setdefault("cliente", "A")
    k.setdefault("paginas_relleno", 0)
    return k


CASOS = [
    caso(id="01", archivo="TEST_01_varios_tipos_iva.pdf", prov="makro", numero="MT-2026/004518", fecha="2026-07-03",
         lineas=[("Material de oficina y consumibles", 1, 120.00, 21), ("Agua y café para clientes", 1, 40.00, 10),
                 ("Libros técnicos de construcción", 2, 25.00, 4)],
         pagada="2026-07-03", gasto="629", motivo_deducible="sí",
         nota="Tres tipos de IVA en una factura: el 303 necesita la base y la cuota de cada tipo por separado."),
    caso(id="02", archivo="TEST_02_abogado_irpf15.pdf", prov="abogado", numero="2026-0087", fecha="2026-07-10",
         lineas=[("Honorarios: asesoramiento contrato de obra", 1, 500.00, 21)], irpf=15,
         vence="2026-08-09", gasto="623", menciones=["Retención IRPF 15 % (art. 101.5 a) LIRPF)"],
         nota="Profesional con retención del 15 %: la retención va al modelo 111 y a la 4751; se paga total − retención."),
    caso(id="03", archivo="TEST_03_disenador_irpf7.pdf", prov="disenador", numero="PS-14", fecha="2026-07-14",
         lineas=[("Diseño de logotipo e identidad corporativa", 1, 800.00, 21)], irpf=7,
         vence="2026-07-31", pagada="2026-07-29", gasto="623",
         menciones=["Retención 7 %: profesional en los tres primeros años de actividad"],
         nota="Profesional de nuevo inicio: retención del 7 %."),
    caso(id="04", archivo="TEST_04_alquiler_local_irpf19.pdf", prov="casero", numero="ALQ-2026-07", fecha="2026-07-01",
         lineas=[("Alquiler local comercial C/ Mayor 12 — julio 2026", 1, 1000.00, 21)], irpf=19,
         vence="2026-07-05", pagada="2026-07-05", gasto="621",
         menciones=["Retención IRPF 19 % arrendamiento de inmueble urbano (modelo 115)"],
         nota="Alquiler de local: retención del 19 %, modelo 115 y cuenta 621."),
    caso(id="05", archivo="TEST_05_recargo_equivalencia.pdf", prov="harinas", numero="HL-26-3307", fecha="2026-07-08",
         cliente="B", re=True,
         lineas=[("Harina de trigo panificable (sacos 25 kg)", 12, 25.00, 10),
                 ("Bolsas de papel y envases", 1, 200.00, 21)],
         vence="2026-08-07", gasto="600",
         menciones=["Operación sujeta a recargo de equivalencia"],
         nota="Cliente en recargo de equivalencia: el recargo forma parte del coste; ni IVA ni recargo son deducibles."),
    caso(id="06", archivo="TEST_06_ticket_gasolinera.jpg", prov="gasolinera", numero="T-0045-118823", fecha="2026-07-16",
         tipo_doc="simplificada", formato="ticket_foto",
         lineas=[("Gasóleo A 38,20 L", 1, 49.59, 21)], pagada="2026-07-16", gasto="628",
         nota="Ticket (factura simplificada) sin NIF del destinatario: el gasto se contabiliza pero el IVA NO es deducible."),
    caso(id="07", archivo="TEST_07_simplificada_cualificada.pdf", prov="ferreteria", numero="FS-2026-00912", fecha="2026-07-18",
         tipo_doc="simplificada_cualificada",
         lineas=[("Brocas y tacos surtidos", 1, 62.40, 21)], pagada="2026-07-18", gasto="602",
         nota="Factura simplificada con NIF y domicilio del destinatario y cuota desglosada: el IVA sí es deducible."),
    caso(id="08", archivo="TEST_08_rectificativa_abono.pdf", prov="abogado", numero="R-2026-0003", fecha="2026-07-25",
         tipo_doc="rectificativa", rectifica="2026-0087", rectifica_fecha="2026-07-10",
         lineas=[("Abono parcial de honorarios por descuento acordado", 1, -100.00, 21)], irpf=15, gasto="623",
         menciones=["Factura rectificativa (art. 15 RD 1619/2012)"],
         nota="Rectificativa en negativo: resta base, cuota y retención de la factura que rectifica."),
    caso(id="09", archivo="TEST_09_intracomunitaria_servicios.pdf", prov="cloud", numero="IE-INV-558201", fecha="2026-07-01",
         lineas=[("Cloud hosting — Business plan (July 2026)", 1, 120.00, None)], pagada="2026-07-01", gasto="629",
         operacion="intracomunitaria", menciones=["Reverse charge — VAT to be accounted for by the recipient (Art. 196 Directive 2006/112/EC)"],
         nota="Servicio intracomunitario sin IVA: autorrepercusión al 21 % (303 casillas 10-11 y deducible), modelo 349 clave I."),
    caso(id="10", archivo="TEST_10_inversion_sujeto_pasivo.pdf", prov="subcontrata", numero="AB-2026-071", fecha="2026-07-21",
         lineas=[("Ejecución de obra de albañilería en reforma de vivienda (subcontrata)", 1, 2000.00, None)],
         vence="2026-08-20", gasto="607", operacion="isp_nacional",
         menciones=["Inversión del sujeto pasivo (art. 84.Uno.2º f) Ley 37/1992)"],
         nota="Inversión del sujeto pasivo nacional: el destinatario autorrepercute el IVA (303 casillas 12-13)."),
    caso(id="11", archivo="TEST_11_proveedor_usd.pdf", prov="saas_us", numero="INV-2026-07-10443", fecha="2026-07-05",
         moneda="USD", lineas=[("Tasklytics Team plan — monthly subscription", 1, 99.00, None)], pagada="2026-07-05",
         gasto="629", operacion="servicio_extracomunitario",
         nota="Proveedor fuera de la UE que factura en USD: hay que convertir a euros e invertir el sujeto pasivo."),
    caso(id="12", archivo="TEST_12_nif_invalido.pdf", prov="nif_malo", numero="LB-2026-0412", fecha="2026-07-22",
         lineas=[("Limpieza mensual de oficina — julio", 1, 180.00, 21)], vence="2026-08-21", gasto="622",
         nota="NIF del proveedor con dígito de control incorrecto: hay que pedir factura corregida antes de deducir."),
    caso(id="13", archivo="TEST_13_sin_numero.pdf", prov="sin_numero", numero=None, fecha="2026-07-23",
         lineas=[("Impresión de 500 tarjetas de visita", 1, 45.00, 21)], pagada="2026-07-23", gasto="627",
         nota="Falta el número de factura (dato obligatorio art. 6.1 a): no es factura completa válida."),
    caso(id="14", archivo="TEST_14_fecha_operacion_distinta.pdf", prov="transportes", numero="THS-26-1182", fecha="2026-07-02",
         f_operacion="2026-06-27",
         lineas=[("Transporte de material a obra (servicio del 27/06/2026)", 1, 350.00, 21)], vence="2026-08-01",
         gasto="624", nota="Fecha de operación (27/06) distinta de la de expedición (02/07): el libro registro debe recoger ambas."),
    caso(id="15", archivo="TEST_15_suplidos.pdf", prov="gestor", numero="GC-2026-0233", fecha="2026-07-28",
         lineas=[("Honorarios: transferencia de vehículo", 1, 50.00, 21)], irpf=15,
         suplidos=[("Tasa DGT (suplido)", 55.70), ("Impuesto de transmisiones ITP (suplido)", 42.70)],
         pagada="2026-07-28", gasto="623",
         nota="Suplidos: no forman parte de la base imponible ni llevan IVA; se contabilizan aparte."),
    caso(id="16", archivo="TEST_16_varias_paginas.pdf", prov="materiales", numero="MCL-26-01988", fecha="2026-07-29",
         lineas=[(f"Material de obra ref. {1000 + i}", (i % 4) + 1, 7.35 + i * 1.1, 21) for i in range(46)],
         vence="2026-08-28", gasto="601",
         nota="Factura de 3 páginas: los totales están en la última; hay que leerla entera."),
    # 17 = copia exacta de la 01 (duplicada)
    caso(id="18", archivo="TEST_18_mismo_proveedor_otro_nif.pdf", prov="materiales", numero="MCL-26-02210", fecha="2026-08-19",
         nif_mostrado="ES-" + P["materiales"]["nif"][0] + "-" + P["materiales"]["nif"][1:],
         lineas=[("Cemento cola y áridos", 1, 960.00, 21)], vence="2026-09-18", gasto="601",
         nota="Mismo proveedor que la 16 con el NIF escrito como «ES-B-…»: el 347 debe agruparlos."),
    # Más compras al mismo proveedor de materiales a lo largo del año para superar el umbral del 347
    caso(id="19", archivo="TEST_19_materiales_q1.pdf", prov="materiales", numero="MCL-26-00321", fecha="2026-02-11",
         lineas=[("Ladrillo y mortero", 1, 820.00, 21)], vence="2026-03-13", pagada="2026-03-12", gasto="601",
         nota="Parte del volumen anual del proveedor para el 347."),
    caso(id="20", archivo="TEST_20_materiales_q2.pdf", prov="materiales", numero="MCL-26-01107", fecha="2026-05-06",
         lineas=[("Pladur y perfilería", 1, 540.00, 21)], vence="2026-06-05", pagada="2026-06-04", gasto="601",
         nota="Parte del volumen anual del proveedor para el 347."),
    caso(id="21", archivo="TEST_21_telefono.pdf", prov="telefono", numero="TA-0726-55120", fecha="2026-07-31",
         lineas=[("Fibra + 2 líneas móviles empresa — julio", 1, 74.30, 21)], pagada="2026-08-05", gasto="629",
         nota="Gasto corriente domiciliado."),
    caso(id="22", archivo="TEST_22_seguro_rc.pdf", prov="seguros", numero="RC-2026-114522", fecha="2026-07-15",
         lineas=[("Prima seguro de responsabilidad civil (anual)", 1, 612.00, None)], pagada="2026-07-15", gasto="625",
         menciones=["Operación exenta de IVA (art. 20.Uno.16º Ley 37/1992)"],
         nota="Seguro exento de IVA: base sin cuota; el 303 no recoge IVA soportado."),
    caso(id="23", archivo="TEST_23_restaurante_comida.jpg", prov="restaurante", numero="F-2026-3381", fecha="2026-07-24",
         formato="foto", lineas=[("Comida de trabajo con cliente (3 menús)", 3, 22.73, 10)], pagada="2026-07-24",
         gasto="629", nota="Restauración: la deducción del IVA exige afectación probada; el contable decide (dudoso)."),
    caso(id="24", archivo="TEST_24_harinas_agosto.pdf", prov="harinas", numero="HL-26-3811", fecha="2026-08-05",
         cliente="B", re=True, lineas=[("Harina integral (sacos 25 kg)", 8, 27.50, 10)], vence="2026-09-04",
         gasto="600", nota="Segunda compra del cliente B en recargo de equivalencia."),
    caso(id="25", archivo="TEST_25_alquiler_agosto.pdf", prov="casero", numero="ALQ-2026-08", fecha="2026-08-01",
         lineas=[("Alquiler local comercial C/ Mayor 12 — agosto 2026", 1, 1000.00, 21)], irpf=19,
         vence="2026-08-05", gasto="621", menciones=["Retención IRPF 19 % arrendamiento de inmueble urbano (modelo 115)"],
         nota="Alquiler pendiente de pago: sirve para la tarea de vencimientos y cuadre con el banco."),
    caso(id="26", archivo="TEST_26_abogado_septiembre.pdf", prov="abogado", numero="2026-0121", fecha="2026-09-15",
         lineas=[("Honorarios: reclamación de cantidad", 1, 2400.00, 21)], irpf=15, vence="2026-10-15",
         gasto="623", nota="Con la 02 y la rectificativa 08, el abogado supera el umbral del 347 (y además tiene retención)."),
    caso(id="27", archivo="TEST_27_materiales_septiembre.pdf", prov="materiales", numero="MCL-26-02654", fecha="2026-09-23",
         lineas=[("Azulejo porcelánico 60x60 (m²)", 40, 18.50, 21)], vence="2026-10-23", gasto="601",
         nota="Cierra el año del proveedor de materiales por encima de 3.005,06 €."),
]
DUPLICADA = dict(id="17", archivo="TEST_17_duplicada_de_01.pdf", origen="TEST_01_varios_tipos_iva.pdf")

RE_TIPO = {21: 5.2, 10: 1.4, 4: 0.5}
CUENTAS = {"600": "Compras de mercaderías", "601": "Compras de materias primas", "602": "Compras de otros aprovisionamientos",
           "607": "Trabajos realizados por otras empresas", "621": "Arrendamientos y cánones",
           "622": "Reparaciones y conservación", "623": "Servicios de profesionales independientes",
           "624": "Transportes", "625": "Primas de seguros", "627": "Publicidad, propaganda y relaciones públicas",
           "628": "Suministros", "629": "Otros servicios"}


def calcular(c):
    """Lo que apuntaría el contable: bases y cuotas por tipo, recargo, retención, totales."""
    por_tipo = {}
    no_sujeta = 0.0
    for _, cant, pu, tipo in c["lineas"]:
        imp = r2(cant * pu)
        if tipo is None:
            no_sujeta = r2(no_sujeta + imp)
        else:
            por_tipo[tipo] = r2(por_tipo.get(tipo, 0) + imp)
    bases = []
    for tipo in sorted(por_tipo, reverse=True):
        b = por_tipo[tipo]
        cuota = r2(b * tipo / 100)
        re_t = RE_TIPO[tipo] if c["re"] else 0
        bases.append(dict(base=b, tipo_iva=tipo, cuota_iva=cuota, tipo_re=re_t, cuota_re=r2(b * re_t / 100)))
    base_total = r2(sum(b["base"] for b in bases) + no_sujeta)
    cuota_iva = r2(sum(b["cuota_iva"] for b in bases))
    cuota_re = r2(sum(b["cuota_re"] for b in bases))
    base_irpf = r2(sum(b["base"] for b in bases) + no_sujeta) if c["irpf"] else 0
    irpf = r2(base_irpf * c["irpf"] / 100)
    suplidos = r2(sum(i for _, i in c["suplidos"]))
    total_factura = r2(base_total + cuota_iva + cuota_re + suplidos)
    return dict(bases=bases, base_no_sujeta_o_exenta=no_sujeta, base_total=base_total, cuota_iva_total=cuota_iva,
                cuota_re_total=cuota_re, irpf_tipo=c["irpf"], irpf_cuota=irpf, suplidos=suplidos,
                total_factura=total_factura, total_a_pagar=r2(total_factura - irpf))


# ---------------------------------------------------------------- PDF

def pdf(c, nif_prov, imp):
    buf = io.BytesIO()
    cv = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    prov = P[c["prov"]]
    cli = GESTORIA_CLIENTES[c["cliente"]]
    mon = c["moneda"]
    titulo = {"completa": "FACTURA", "simplificada": "FACTURA SIMPLIFICADA", "simplificada_cualificada": "FACTURA SIMPLIFICADA",
              "rectificativa": "FACTURA RECTIFICATIVA"}[c["tipo_doc"]]
    lineas = list(c["lineas"])
    por_pagina = 22
    paginas = max(1, -(-len(lineas) // por_pagina))

    def cabecera(n):
        cv.setFont("Helvetica-Bold", 15); cv.drawString(20 * mm, h - 22 * mm, prov["nombre"])
        cv.setFont("Helvetica", 9); cv.drawString(20 * mm, h - 28 * mm, f"NIF: {c.get('nif_mostrado') or nif_prov}")
        cv.drawString(20 * mm, h - 33 * mm, "C/ Ficticia 1, 46000 Valencia (España)" if not prov["nif"][:2].isalpha() or prov["nif"][:2] in ("A0", "B0") else "Domicilio del proveedor (ficticio)")
        cv.setFont("Helvetica-Bold", 17); cv.drawRightString(w - 20 * mm, h - 22 * mm, titulo)
        cv.setFont("Helvetica", 9); cv.drawRightString(w - 20 * mm, h - 28 * mm, f"Página {n} de {paginas}")

    def bloque_datos():
        y = h - 46 * mm
        cv.setFont("Helvetica", 10)
        datos = []
        if c["numero"]:
            datos.append(("Nº factura", c["numero"]))
        datos.append(("Fecha de expedición", fecha_es(c["fecha"])))
        if c["f_operacion"]:
            datos.append(("Fecha de la operación", fecha_es(c["f_operacion"])))
        if c["vence"]:
            datos.append(("Vencimiento", fecha_es(c["vence"])))
        if mon != "EUR":
            datos.append(("Moneda", mon))
        if c["tipo_doc"] == "rectificativa":
            datos.append(("Rectifica la factura", f"{c['rectifica']} de {fecha_es(c['rectifica_fecha'])}"))
            datos.append(("Motivo", "Descuento comercial posterior (art. 80 Ley 37/1992)"))
        for k, v in datos:
            cv.drawString(20 * mm, y, f"{k}: {v}"); y -= 5.5 * mm
        if c["tipo_doc"] != "simplificada":
            cv.setFont("Helvetica-Bold", 10); cv.drawString(115 * mm, h - 46 * mm, "Cliente")
            cv.setFont("Helvetica", 10)
            cv.drawString(115 * mm, h - 51.5 * mm, cli["nombre"])
            cv.drawString(115 * mm, h - 57 * mm, f"NIF: {cli['nif']}")
            cv.drawString(115 * mm, h - 62.5 * mm, cli["dom"])
        return min(y, h - 70 * mm) - 6 * mm

    idx = 0
    for n in range(1, paginas + 1):
        cabecera(n)
        y = bloque_datos() if n == 1 else h - 45 * mm
        cv.setFont("Helvetica-Bold", 9)
        cv.drawString(20 * mm, y, "Concepto"); cv.drawRightString(125 * mm, y, "Cant.")
        cv.drawRightString(145 * mm, y, "Precio"); cv.drawRightString(160 * mm, y, "IVA")
        cv.drawRightString(w - 20 * mm, y, "Importe")
        cv.line(20 * mm, y - 2 * mm, w - 20 * mm, y - 2 * mm); y -= 7 * mm
        cv.setFont("Helvetica", 9)
        for concepto, cant, pu, tipo in lineas[idx: idx + por_pagina]:
            cv.drawString(20 * mm, y, concepto[:62]); cv.drawRightString(125 * mm, y, str(cant))
            cv.drawRightString(145 * mm, y, eur(pu, mon)); cv.drawRightString(160 * mm, y, "—" if tipo is None else f"{tipo} %")
            cv.drawRightString(w - 20 * mm, y, eur(r2(cant * pu), mon)); y -= 5.5 * mm
        idx += por_pagina
        if n < paginas:
            cv.setFont("Helvetica-Oblique", 9); cv.drawRightString(w - 20 * mm, 20 * mm, "Suma y sigue →")
            cv.showPage()
    # resumen de impuestos y totales en la última página
    y -= 4 * mm
    for concepto, importe in c["suplidos"]:
        cv.drawString(20 * mm, y, concepto); cv.drawRightString(w - 20 * mm, y, eur(importe, mon)); y -= 5.5 * mm
    y -= 3 * mm
    cv.setFont("Helvetica-Bold", 9)
    cv.drawString(95 * mm, y, "Base"); cv.drawString(125 * mm, y, "Tipo"); cv.drawRightString(w - 20 * mm, y, "Cuota"); y -= 5.5 * mm
    cv.setFont("Helvetica", 9)
    for b in imp["bases"]:
        cv.drawString(95 * mm, y, eur(b["base"], mon)); cv.drawString(125 * mm, y, f"IVA {b['tipo_iva']} %")
        cv.drawRightString(w - 20 * mm, y, eur(b["cuota_iva"], mon)); y -= 5 * mm
        if b["tipo_re"]:
            cv.drawString(125 * mm, y, f"Recargo eq. {str(b['tipo_re']).replace('.', ',')} %")
            cv.drawRightString(w - 20 * mm, y, eur(b["cuota_re"], mon)); y -= 5 * mm
    if imp["base_no_sujeta_o_exenta"]:
        cv.drawString(95 * mm, y, eur(imp["base_no_sujeta_o_exenta"], mon)); cv.drawString(125 * mm, y, "Sin IVA")
        cv.drawRightString(w - 20 * mm, y, eur(0, mon)); y -= 5 * mm
    if imp["irpf_cuota"]:
        cv.drawString(125 * mm, y, f"Retención IRPF {c['irpf']} %"); cv.drawRightString(w - 20 * mm, y, eur(-imp["irpf_cuota"], mon)); y -= 5 * mm
    cv.setFont("Helvetica-Bold", 11)
    cv.drawString(125 * mm, y - 3 * mm, "TOTAL FACTURA"); cv.drawRightString(w - 20 * mm, y - 3 * mm, eur(imp["total_factura"], mon)); y -= 9 * mm
    if imp["irpf_cuota"]:
        cv.drawString(125 * mm, y - 1 * mm, "TOTAL A PAGAR"); cv.drawRightString(w - 20 * mm, y - 1 * mm, eur(imp["total_a_pagar"], mon)); y -= 8 * mm
    cv.setFont("Helvetica", 8.5)
    for m in c["menciones"]:
        cv.drawString(20 * mm, y, m); y -= 4.5 * mm
    if c["pagada"]:
        cv.setFont("Helvetica-Bold", 14); cv.drawString(20 * mm, 30 * mm, f"PAGADO {fecha_es(c['pagada'])}")
    cv.setFont("Helvetica-Oblique", 7.5)
    cv.drawString(20 * mm, 14 * mm, "Documento ficticio generado para la auditoría (TEST). Sin validez fiscal.")
    cv.showPage(); cv.save()
    return buf.getvalue()


def ticket_img(c, nif_prov, imp):
    """Ticket estrecho de gasolinera: factura simplificada sin datos del destinatario."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = 420, 760
    im = Image.new("RGB", (W, H), (250, 249, 244)); d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype("consola.ttf", 17); fb = ImageFont.truetype("consolab.ttf", 19)
    except OSError:
        f = fb = ImageFont.load_default()
    y = 20
    for t, font in [(P[c["prov"]]["nombre"].replace("TEST·", "TEST·"), fb), (f"NIF {nif_prov}", f), ("Autovía V-31 km 6, Silla", f),
                    ("FACTURA SIMPLIFICADA", fb), (f"Nº {c['numero']}", f), (f"Fecha {fecha_es(c['fecha'])} 08:41", f), ("-" * 34, f)]:
        d.text((16, y), t, fill=(20, 20, 20), font=font); y += 28
    for concepto, cant, pu, tipo in c["lineas"]:
        tot = r2(cant * pu * (1 + tipo / 100))
        d.text((16, y), concepto, fill=(20, 20, 20), font=f); y += 26
        d.text((16, y), f"   1,302 €/L        {eur(tot)}", fill=(20, 20, 20), font=f); y += 30
    total = imp["total_factura"]
    d.text((16, y), "-" * 34, fill=(20, 20, 20), font=f); y += 26
    d.text((16, y), f"TOTAL (IVA incl.)   {eur(total)}", fill=(0, 0, 0), font=fb); y += 30
    d.text((16, y), f"IVA 21 % incluido", fill=(20, 20, 20), font=f); y += 28
    d.text((16, y), "Pago: TARJETA ****4417", fill=(20, 20, 20), font=f); y += 40
    d.text((16, y), "Documento ficticio (TEST)", fill=(90, 90, 90), font=f)
    return im


def generar():
    from generar_facturas import rasterizar, como_foto  # reutiliza utilidades existentes
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir(parents=True)
    esperado = []
    for c in CASOS:
        prov = P[c["prov"]]
        imp = calcular(c)
        ruta = SALIDA / c["archivo"]
        if c["formato"] == "ticket_foto":
            como_foto(ticket_img(c, prov["nif"], imp)).save(ruta, "JPEG", quality=80)
        elif c["formato"] == "foto":
            como_foto(rasterizar(pdf(c, prov["nif"], imp), 110)).save(ruta, "JPEG", quality=80)
        else:
            ruta.write_bytes(pdf(c, prov["nif"], imp))
        cli = GESTORIA_CLIENTES[c["cliente"]]
        operacion = c.get("operacion", "interior")
        deducible, motivo = "sí", "Factura completa con todos los datos obligatorios."
        if cli["regimen"] == "recargo_equivalencia":
            deducible, motivo = "no", "Destinatario en recargo de equivalencia: el IVA y el recargo son mayor coste."
        elif c["tipo_doc"] == "simplificada":
            deducible, motivo = "no", "Factura simplificada sin NIF ni domicilio del destinatario (art. 7.2 RD 1619/2012)."
        elif not nif_valido(prov["nif"]) and prov["nif"][:2] not in ("IE", "EI"):
            deducible, motivo = "no (subsanable)", "NIF del expedidor con dígito de control incorrecto: pedir factura corregida."
        elif not c["numero"]:
            deducible, motivo = "no (subsanable)", "Falta el número de factura (art. 6.1 a RD 1619/2012)."
        elif c["prov"] == "restaurante":
            deducible, motivo = "dudoso", "Restauración: solo si se acredita afectación a la actividad (art. 96 Ley 37/1992)."
        elif not imp["bases"]:
            deducible, motivo = "n/a", "Sin IVA repercutido (exenta, intracomunitaria, ISP o extracomunitaria)."
        cuota_autorrep = r2(imp["base_total"] * 0.21) if operacion in ("intracomunitaria", "isp_nacional", "servicio_extracomunitario") else 0
        modelos = ["303"] if (imp["bases"] or cuota_autorrep) and cli["regimen"] == "general" else []
        if c["irpf"]:
            modelos.append("115" if c["gasto"] == "621" else "111")
        if operacion == "intracomunitaria":
            modelos.append("349")
        esperado.append(dict(
            id=c["id"], archivo=c["archivo"], formato=c["formato"], cliente=cli["nombre"], cliente_nif=cli["nif"],
            cliente_regimen=cli["regimen"], proveedor=prov["nombre"], proveedor_nif=prov["nif"],
            proveedor_nif_en_documento=c.get("nif_mostrado") or prov["nif"], proveedor_nif_valido=nif_valido(prov["nif"]) if prov["nif"][:2] not in ("IE", "EI") else None,
            numero=c["numero"], tipo_factura=c["tipo_doc"], rectifica=c.get("rectifica"),
            fecha_expedicion=c["fecha"], fecha_operacion=c["f_operacion"] or c["fecha"],
            fecha_vencimiento=c["vence"], fecha_pago=c["pagada"], estado_pago="pagada" if c["pagada"] else "pendiente",
            trimestre=f"{c['fecha'][:4]}-{(int(c['fecha'][5:7]) - 1) // 3 + 1}T",
            moneda=c["moneda"], operacion=operacion, cuota_autorrepercutida=cuota_autorrep,
            **imp, deducible=deducible, motivo_deducibilidad=motivo,
            cuenta_gasto=c["gasto"], cuenta_gasto_nombre=CUENTAS[c["gasto"]],
            cuenta_proveedor="400" if c["gasto"] in ("600", "601", "602") else "410",
            modelos=modelos, nota=c["nota"]))
    shutil.copyfile(SALIDA / DUPLICADA["origen"], SALIDA / DUPLICADA["archivo"])
    esperado.append(dict(id="17", archivo=DUPLICADA["archivo"], duplicada_de=DUPLICADA["origen"], estado_esperado="duplicada",
                         nota="Mismo archivo subido dos veces: no debe contarse dos veces."))
    esperado.sort(key=lambda e: e["id"])
    (SALIDA / "esperado_contable.json").write_text(json.dumps(esperado, ensure_ascii=False, indent=2), encoding="utf-8")
    for e in esperado:
        print(f"{e['archivo']:<44} {e.get('total_factura', ''):>9}  {e.get('deducible', e.get('estado_esperado', ''))}")
    return esperado
