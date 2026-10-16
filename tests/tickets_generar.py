"""Genera tickets de compra ficticios (imagenes) en tests/tickets-ejemplo/ + esperado_tickets.json.
Uso: python tests/generar_facturas.py --tickets"""
import json, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAIZ = Path(__file__).resolve().parent
SALIDA = RAIZ / "tickets-ejemplo"
FONT = "C:/Windows/Fonts/cour.ttf"
FONTB = "C:/Windows/Fonts/courbd.ttf"
ANCHO = 38  # caracteres por linea


def e(x):
    return f"{x:.2f}".replace(".", ",")


def iva_tabla(lineas):
    """lineas: (desc, cant, importe_con_iva, tipo). Devuelve {tipo: (base, cuota)} y total, en centimos."""
    por = {}
    for _, _, imp, t in lineas:
        por[t] = por.get(t, 0) + round(imp * 100)
    tabla = {}
    for t, c in por.items():
        base = round(c * 100 / (100 + t))
        tabla[t] = (base, c - base)
    return tabla, sum(por.values())


def ticket(c):
    lineas = c["lineas"]
    tabla, total_c = iva_tabla(lineas)
    propina = round(c.get("propina", 0) * 100)
    filas = []

    def add(t="", b=False):
        filas.append((t, b))

    add(c["comercio"].center(ANCHO), True)
    for l in c.get("cabecera", []):
        add(l.center(ANCHO))
    if c.get("nif"):
        add(f"CIF: {c['nif']}".center(ANCHO))
    add("-" * ANCHO)
    add(f"Fecha: {c['fecha_es']}" + (f"  Hora: {c['hora']}" if c.get("hora") else ""))
    if c.get("numero"):
        add(f"Ticket: {c['numero']}")
    add("-" * ANCHO)
    add(f"{'DESCRIPCION':<22}{'UD':>3}{'IMPORTE':>13}")
    for d, q, imp, t in lineas:
        add(f"{d[:22]:<22}{q:>3}{e(imp):>13}")
    add("-" * ANCHO)
    if propina:
        add(f"{'PROPINA':<25}{e(propina / 100):>13}")
    add(f"{'TOTAL EUR':<22}{e((total_c + propina) / 100):>16}", True)
    add(f"{c.get('pago', 'TARJETA')}")
    if c.get("iva_tabla", True):
        add("-" * ANCHO)
        add(f"{'BASE':>10}{'%IVA':>8}{'CUOTA':>10}")
        for t, (b, q) in sorted(tabla.items(), reverse=True):
            add(f"{e(b / 100):>10}{t:>7}%{e(q / 100):>10}")
    else:
        add("IVA INCLUIDO (21%)")
    add("")
    add("GRACIAS POR SU VISITA".center(ANCHO))
    esc = 2
    f, fb = ImageFont.truetype(FONT, 14 * esc), ImageFont.truetype(FONTB, 14 * esc)
    h = 14 * esc * 1.25
    img = Image.new("RGB", (int(ANCHO * 8.4 * esc) + 60 * esc, int(len(filas) * h) + 50 * esc), (250, 250, 246))
    d = ImageDraw.Draw(img)
    for i, (t, b) in enumerate(filas):
        d.text((30 * esc, 25 * esc + i * h), t, font=fb if b else f, fill=(25, 25, 25))
    return img, tabla, total_c, propina


def foto(img, rot=0, ruido=False, borroso=0):
    fondo = Image.new("RGB", (img.width + 200, img.height + 200), (95, 85, 75))
    fondo.paste(img, (100, 100))
    if rot:
        fondo = fondo.rotate(rot, expand=True, fillcolor=(95, 85, 75), resample=Image.BICUBIC)
    if ruido:
        rnd = random.Random(7)
        px = fondo.load()
        for _ in range(fondo.width * fondo.height // 25):
            x, y = rnd.randrange(fondo.width), rnd.randrange(fondo.height)
            v = rnd.randrange(-40, 40)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    if borroso:
        fondo = fondo.filter(ImageFilter.GaussianBlur(borroso))
    return fondo


SUPER = [("LECHE ENTERA 1L", 6, 6.54, 4), ("PAN BARRA", 2, 1.80, 4), ("HUEVOS DOCENA", 1, 2.95, 4), ("MANZANAS KG", 1, 2.39, 4),
         ("YOGUR NATURAL X4", 2, 2.58, 10), ("ACEITE OLIVA 1L", 1, 8.95, 4), ("POLLO ENTERO", 1, 6.80, 10), ("ARROZ 1KG", 2, 2.30, 4),
         ("DETERGENTE 40D", 1, 7.99, 21), ("PAPEL COCINA", 1, 3.45, 21), ("CERVEZA PACK 6", 1, 4.20, 21), ("BOLSA PLASTICO", 1, 0.15, 21)]
FARM = [("IBUPROFENO 600 20C", 1, 4.60, 4), ("MASCARILLAS 50U", 1, 5.50, 21), ("CREMA SOLAR SPF50", 1, 14.90, 21),
        ("JARABE TOS", 1, 7.25, 10), ("TERMOMETRO", 1, 9.95, 21)]
GAS = [("GASOLINA 95 E5  38.12L", 1, 66.71, 21)]
BAR = [("CAFE CON LECHE", 2, 3.60, 10), ("TOSTADA TOMATE", 2, 6.40, 10), ("ZUMO NARANJA", 1, 3.00, 10), ("CANA", 2, 4.40, 10), ("TORTILLA PINCHO", 2, 7.00, 10)]
ROPA = [("CAMISETA ALGODON", 2, 19.98, 21), ("VAQUERO SLIM", 1, 39.95, 21)]

CASOS = [
    dict(id="T01", archivo="TEST_T01_super.png", comercio="SUPERMERCADOS TEST LA ESQUINA", cabecera=["C/ Mayor 12 MADRID"], nif="B12345674",
         fecha="2026-10-05", fecha_es="05/10/2026", hora="18:42", numero="0048/2217", lineas=SUPER, pago="TARJETA",
         categoria="Alimentación y supermercado", estado="ok", extra="mixto 4/10/21"),
    dict(id="T02", archivo="TEST_T02_farmacia.png", comercio="FARMACIA TEST DEL PARQUE", cabecera=["Avda. Parque 3 SEVILLA"], nif="B28013811",
         fecha="2026-10-08", fecha_es="08/10/2026", hora="11:05", numero="F-77310", lineas=FARM, pago="EFECTIVO",
         categoria="Salud y farmacia", estado="ok", extra="4/10/21"),
    dict(id="T03", archivo="TEST_T03_gasolinera.png", comercio="ESTACION SERVICIO TEST NORTE", cabecera=["Ctra. N-I km 23"], nif="A08000143",
         fecha="2026-10-09", fecha_es="09/10/2026", hora="07:58", numero="3321-009", lineas=GAS, pago="TARJETA",
         categoria="Transporte y combustible", estado="ok", extra="gasolinera"),
    dict(id="T04", archivo="TEST_T04_bar.png", comercio="BAR TEST EL PORTAL", cabecera=["Pza. del Sol 1"], nif="B83000010",
         fecha="2026-10-10", fecha_es="10/10/2026", hora="14:20", numero=None, lineas=BAR, propina=2.00, pago="TARJETA",
         categoria="Restaurantes y comida a domicilio", estado="ok", extra="propina 2,00"),
    dict(id="T05", archivo="TEST_T05_super_rotado.jpg", comercio="SUPERMERCADOS TEST EL ARCO", cabecera=["C/ Arco 7 VALENCIA"], nif="B46000193",
         fecha="2026-10-11", fecha_es="11/10/2026", hora="19:10", numero="0012/0455", lineas=SUPER[:6], pago="TARJETA",
         categoria="Alimentación y supermercado", estado="ok", rot=4, ruido=True),
    dict(id="T06", archivo="TEST_T06_borroso.jpg", comercio="TIENDA TEST MODA", cabecera=["C/ Gran Via 40"], nif="B11000019",
         fecha="2026-10-12", fecha_es="12/10/2026", hora="17:30", numero="9981", lineas=ROPA, pago="TARJETA",
         categoria="Ropa y calzado", estado="revisar", borroso=9, ruido=True, rot=-3),
    dict(id="T07", archivo="TEST_T07_farmacia_copia.jpg", comercio="FARMACIA TEST DEL PARQUE", cabecera=["Avda. Parque 3 SEVILLA"], nif="B28013811",
         fecha="2026-10-08", fecha_es="08/10/2026", hora="11:05", numero="F-77310", lineas=FARM, pago="EFECTIVO",
         categoria="Salud y farmacia", estado="posible_duplicada", ruido=True, copia_de="T02"),
    dict(id="T08", archivo="TEST_T08_sin_nif.jpg", comercio="MERCERIA TEST CARMEN", cabecera=["Mercado Central p.14"], nif=None,
         fecha="2026-10-13", fecha_es="13/10/2026", hora="10:12", numero=None,
         lineas=[("HILO COSER X5", 1, 4.50, 21), ("BOTONES SURTIDO", 2, 3.60, 21), ("TIJERAS", 1, 8.95, 21)],
         pago="EFECTIVO", iva_tabla=False, categoria="Ropa y calzado", estado="ok", rot=-2, ruido=True,
         extra="sin NIF ni numero, IVA incluido"),
]


def generar():
    SALIDA.mkdir(exist_ok=True)
    esp = []
    for c in CASOS:
        img, tabla, total_c, propina = ticket(c)
        if c.get("rot") or c.get("ruido") or c.get("borroso"):
            img = foto(img, c.get("rot", 0), c.get("ruido", False), c.get("borroso", 0))
        if c["archivo"].endswith("jpg"):
            img.save(SALIDA / c["archivo"], quality=88)
        else:
            img.save(SALIDA / c["archivo"])
        base = sum(b for b, _ in tabla.values())
        esp.append(dict(id=c["id"], archivo=c["archivo"], comercio=c["comercio"], categoria=c["categoria"],
                        total=(total_c + propina) / 100, base=base / 100, iva_cuota=sum(q for _, q in tabla.values()) / 100,
                        propina=propina / 100, n_lineas=len(c["lineas"]), estado=c["estado"], nif=c["nif"], numero=c["numero"],
                        hora=c["hora"], pago=c["pago"], copia_de=c.get("copia_de"), nota=c.get("extra"),
                        iva_tabla=c.get("iva_tabla", True)))
    (RAIZ / "esperado_tickets.json").write_text(json.dumps(esp, ensure_ascii=False, indent=2), encoding="utf-8")
    for x in esp:
        print(x["archivo"], x["total"], x["estado"])


if __name__ == "__main__":
    generar()
