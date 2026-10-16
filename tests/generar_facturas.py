"""Genera 15 facturas ficticias de prueba en tests/facturas-ejemplo/ y esperado.json.

Casos cubiertos: PDFs con texto, PDF escaneado (rasterizado), fotos y capturas,
varias categorías, una duplicada exacta, una con el IVA mal sumado, una
suscripción mensual tres meses seguidos con subida de precio, dos suscripciones
de música que se solapan, un contrato anual y una factura a punto de vencer.

Uso:  .venv\\Scripts\\python tests\\generar_facturas.py
"""
import io
import json
import random
import shutil
from pathlib import Path

import fitz  # pymupdf
from PIL import Image, ImageFilter, ImageEnhance
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

SALIDA = Path(__file__).parent / "facturas-ejemplo"
random.seed(42)

# formato: pdf | pdf_escaneado | foto_jpg | captura_png | captura_webp
FACTURAS = [
    dict(archivo="01_zara_ropa.pdf", formato="pdf", proveedor="Zara España, S.A.", nif="A15075062",
         numero="ZR-2026-118734", fecha="2026-07-12", vence=None, iva=21,
         lineas=[("Camisa lino", 1, 29.75), ("Pantalón chino", 1, 19.80)], pago="Tarjeta",
         esperado=dict(categoria="Ropa y calzado", tipo_gasto="puntual", estado="ok")),
    dict(archivo="02_steam_videojuego.png", formato="captura_png", proveedor="Valve Corporation", nif="EU826010755",
         numero="STM-5521098834", fecha="2026-08-03", vence=None, iva=21,
         lineas=[("Juego digital: Hollow Realms", 1, 41.31)], pago="PayPal",
         esperado=dict(categoria="Videojuegos y ocio digital", tipo_gasto="puntual", estado="ok")),
    dict(archivo="03_netflix_julio.pdf", formato="pdf", proveedor="Netflix International B.V.", nif="NL853746333B01",
         numero="NFX-ES-2026-07-4471", fecha="2026-07-05", vence=None, iva=21,
         lineas=[("Suscripción Netflix Estándar (mensual)", 1, 11.56)], pago="Tarjeta",
         esperado=dict(categoria="Streaming y música", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
    dict(archivo="04_netflix_agosto.pdf", formato="pdf", proveedor="Netflix International B.V.", nif="NL853746333B01",
         numero="NFX-ES-2026-08-4471", fecha="2026-08-05", vence=None, iva=21,
         lineas=[("Suscripción Netflix Estándar (mensual)", 1, 11.56)], pago="Tarjeta",
         esperado=dict(categoria="Streaming y música", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
    dict(archivo="05_netflix_septiembre_foto.jpg", formato="foto_jpg", proveedor="Netflix International B.V.", nif="NL853746333B01",
         numero="NFX-ES-2026-09-4471", fecha="2026-09-05", vence=None, iva=21,
         lineas=[("Suscripción Netflix Estándar (mensual) - nuevo precio", 1, 13.21)], pago="Tarjeta",
         esperado=dict(categoria="Streaming y música", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
    dict(archivo="06_spotify.pdf", formato="pdf", proveedor="Spotify AB", nif="SE556703748501",
         numero="SPT-ES-88213409", fecha="2026-09-10", vence=None, iva=21,
         lineas=[("Spotify Premium Individual (mensual)", 1, 9.91)], pago="Tarjeta",
         esperado=dict(categoria="Streaming y música", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
    dict(archivo="07_apple_music_captura.webp", formato="captura_webp", proveedor="Apple Distribution International Ltd.", nif="IE9700053D",
         numero="MLR7Q2K9XP", fecha="2026-09-15", vence=None, iva=21,
         lineas=[("Apple Music Individual (mensual)", 1, 9.08)], pago="Tarjeta",
         esperado=dict(categoria="Streaming y música", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
    dict(archivo="08_iberdrola_luz.pdf", formato="pdf", proveedor="Iberdrola Clientes, S.A.U.", nif="A95758389",
         numero="FE26-0098812345", fecha="2026-09-20", vence="2026-10-20", iva=21,
         lineas=[("Término de potencia 30 días", 1, 28.40), ("Energía consumida 245 kWh", 1, 41.60)], pago="Domiciliación",
         esperado=dict(categoria="Luz", tipo_gasto="contrato", periodicidad="mensual", estado="ok")),
    dict(archivo="09_mapfre_seguro_hogar_anual.pdf", formato="pdf", proveedor="Mapfre España, S.A.", nif="A28141935",
         numero="POL-HOG-2026-551203", fecha="2026-03-01", vence="2026-03-15", iva=0,
         lineas=[("Prima anual seguro de hogar (exento de IVA)", 1, 285.00)], pago="Domiciliación",
         esperado=dict(categoria="Seguros", tipo_gasto="contrato", periodicidad="anual", estado="ok")),
    dict(archivo="10_mercadona_ticket.jpg", formato="foto_jpg", proveedor="Mercadona, S.A.", nif="A46103834",
         numero="4211-017-883421", fecha="2026-09-28", vence=None, iva=10,
         lineas=[("Compra semanal alimentación", 1, 62.73)], pago="Tarjeta",
         esperado=dict(categoria="Alimentación y supermercado", tipo_gasto="puntual", estado="ok")),
    dict(archivo="11_glovo_cena.pdf", formato="pdf", proveedor="Glovoapp23, S.A.", nif="A66362906",
         numero="GLV-ES-2026-77120", fecha="2026-09-12", vence=None, iva=10,
         lineas=[("Pedido restaurante: menú pizza", 1, 18.18), ("Gastos de envío", 1, 2.27)], pago="Tarjeta",
         esperado=dict(categoria="Restaurantes y comida a domicilio", tipo_gasto="puntual", estado="ok")),
    # IVA mal sumado a propósito: 50,00 + 10,50 = 60,50 pero el total impreso es 61,50.
    dict(archivo="12_repsol_iva_mal.pdf", formato="pdf", proveedor="Repsol Comercial de Productos Petrolíferos, S.A.", nif="A80298839",
         numero="RPS-0045-2026-339812", fecha="2026-08-22", vence=None, iva=21,
         lineas=[("Gasolina 95 E5 - 30,1 L", 1, 50.00)], pago="Tarjeta", total_forzado=61.50,
         esperado=dict(categoria="Transporte y combustible", tipo_gasto="puntual", estado="revisar")),
    dict(archivo="13_mediamarkt_escaneada.pdf", formato="pdf_escaneado", proveedor="Media Markt Saturn Administración España, S.A.U.", nif="A62191572",
         numero="MM-1150-2026-004417", fecha="2026-06-18", vence=None, iva=21,
         lineas=[("Auriculares inalámbricos con cancelación de ruido", 1, 247.93)], pago="Tarjeta",
         esperado=dict(categoria="Tecnología y electrónica", tipo_gasto="puntual", estado="ok")),
    dict(archivo="14_basicfit_gimnasio.pdf", formato="pdf", proveedor="Basic-Fit Spain, S.A.U.", nif="A86814324",
         numero="BF-ES-2026-10-220931", fecha="2026-10-01", vence="2026-10-05", iva=21,
         lineas=[("Cuota mensual Comfort octubre", 1, 24.79)], pago="Domiciliación",
         esperado=dict(categoria="Deporte y gimnasio", tipo_gasto="suscripcion", periodicidad="mensual", estado="ok")),
]
# 15.ª: copia exacta (mismos bytes) de la 01 → debe responder "duplicada".
DUPLICADA = dict(archivo="15_zara_ropa_DUPLICADA.pdf", origen="01_zara_ropa.pdf",
                 esperado=dict(estado="duplicada"))


def importes(f):
    base = round(sum(c * p for _, c, p in f["lineas"]), 2)
    cuota = round(base * f["iva"] / 100, 2)
    total = f.get("total_forzado", round(base + cuota, 2))
    return base, cuota, total


def eur(x):
    return f"{x:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def fecha_es(iso):
    a, m, d = iso.split("-")
    return f"{d}/{m}/{a}"


def pdf_factura(f) -> bytes:
    base, cuota, total = importes(f)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, h - 25 * mm, f["proveedor"])
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, h - 32 * mm, f"NIF/CIF: {f['nif']}")
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(w - 20 * mm, h - 25 * mm, "FACTURA")
    c.setFont("Helvetica", 10)
    y = h - 45 * mm
    for etiqueta, valor in [("Nº factura", f["numero"]), ("Fecha de emisión", fecha_es(f["fecha"])),
                            ("Fecha de vencimiento", fecha_es(f["vence"]) if f["vence"] else "—"),
                            ("Forma de pago", f["pago"]), ("Cliente", "Cliente de prueba")]:
        c.drawString(20 * mm, y, f"{etiqueta}: {valor}")
        y -= 6 * mm
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Concepto")
    c.drawRightString(140 * mm, y, "Cant.")
    c.drawRightString(w - 20 * mm, y, "Importe")
    c.line(20 * mm, y - 2 * mm, w - 20 * mm, y - 2 * mm)
    c.setFont("Helvetica", 10)
    y -= 8 * mm
    for concepto, cant, precio in f["lineas"]:
        c.drawString(20 * mm, y, concepto)
        c.drawRightString(140 * mm, y, str(cant))
        c.drawRightString(w - 20 * mm, y, eur(cant * precio))
        y -= 6 * mm
    y -= 8 * mm
    for etiqueta, valor in [("Base imponible", eur(base)), (f"IVA {f['iva']} %", eur(cuota))]:
        c.drawRightString(150 * mm, y, etiqueta)
        c.drawRightString(w - 20 * mm, y, valor)
        y -= 6 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(150 * mm, y - 2 * mm, "TOTAL (EUR)")
    c.drawRightString(w - 20 * mm, y - 2 * mm, eur(total))
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(20 * mm, 15 * mm, "Documento ficticio generado para pruebas. Sin validez fiscal.")
    c.showPage()
    c.save()
    return buf.getvalue()


def rasterizar(pdf: bytes, dpi=110) -> Image.Image:
    doc = fitz.open(stream=pdf, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def como_foto(img: Image.Image) -> Image.Image:
    img = img.rotate(random.uniform(-3, 3), expand=True, fillcolor=(205, 200, 190))
    img = ImageEnhance.Brightness(img).enhance(0.92)
    img = ImageEnhance.Contrast(img).enhance(0.85)
    ruido = Image.effect_noise(img.size, 18).convert("RGB")
    img = Image.blend(img, ruido, 0.06)
    return img.filter(ImageFilter.GaussianBlur(0.6))


def main():
    if SALIDA.exists():
        shutil.rmtree(SALIDA)
    SALIDA.mkdir(parents=True)
    esperado = []
    for f in FACTURAS:
        pdf = pdf_factura(f)
        ruta = SALIDA / f["archivo"]
        fmt = f["formato"]
        if fmt == "pdf":
            ruta.write_bytes(pdf)
        elif fmt == "pdf_escaneado":
            # PDF sin capa de texto: solo una imagen de la página.
            img = como_foto(rasterizar(pdf, 120))
            img.save(ruta, "PDF", resolution=120)
        elif fmt == "foto_jpg":
            como_foto(rasterizar(pdf, 110)).save(ruta, "JPEG", quality=78)
        elif fmt == "captura_png":
            rasterizar(pdf, 96).save(ruta, "PNG", optimize=True)
        elif fmt == "captura_webp":
            rasterizar(pdf, 96).save(ruta, "WEBP", quality=85)
        base, cuota, total = importes(f)
        esperado.append(dict(archivo=f["archivo"], formato=fmt, proveedor=f["proveedor"], nif=f["nif"],
                             numero=f["numero"], fecha_emision=f["fecha"], fecha_vencimiento=f["vence"],
                             base=base, iva_tipo=f["iva"], iva_cuota=cuota, total=total,
                             **f["esperado"]))
    shutil.copyfile(SALIDA / DUPLICADA["origen"], SALIDA / DUPLICADA["archivo"])
    esperado.append(dict(archivo=DUPLICADA["archivo"], formato="pdf", duplicada_de=DUPLICADA["origen"],
                         **DUPLICADA["esperado"]))
    (SALIDA / "esperado.json").write_text(json.dumps(esperado, ensure_ascii=False, indent=2), encoding="utf-8")
    for e in esperado:
        print(f"{e['archivo']:<40} {e.get('total', ''):>8}  {e['estado']}")


if __name__ == "__main__":
    import sys
    if "--tickets" in sys.argv:
        import tickets_generar
        tickets_generar.generar()
    elif "--contables" in sys.argv:
        # Casos contables de la auditoría (tests/facturas-contables/ + esperado_contable.json)
        import facturas_contables
        facturas_contables.generar()
    else:
        main()
