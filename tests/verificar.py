"""Verifica FACT — Exportar Excel contra /resumen y contra un cálculo independiente.

Uso:
    .venv\\Scripts\\python tests\\verificar.py                 # descarga /exportar (sin Gemini)
    .venv\\Scripts\\python tests\\verificar.py --archivo X.xlsx  # solo revisa un XLSX ya descargado

Descarga GET /exportar?desde=2026-01-01&hasta=2026-10-14, lo guarda en
tests/salida/Gastos_<hoy>.xlsx y lo abre con openpyxl:
- 5 hojas con sus nombres; estilos (relleno y fuente blanca en negrita en cabeceras,
  paneles inmovilizados, autofiltro o Tabla, formatos € y dd/mm/yyyy con fechas reales,
  filas alternas, bordes); fórmulas SUMIFS/SUM (no valores fijos) en Resumen, Por mes y
  Suscripciones; formato condicional; ningún valor de error.
- Presentación: anchos ≥ cabecera + 4 (flecha del filtro; meses de «Por mes» ≥ 12), textos
  legibles (Tipo «Puntual/Suscripción/Contrato», Estado «Correcta/Revisar/Posible duplicada»,
  periodicidad y método de pago con mayúscula inicial) e impresión (A4 horizontal, 1 página de
  ancho, márgenes estrechos, fila de títulos repetida, área de impresión = rango usado).
- Recalcula: LibreOffice no está instalado, así que evalúa las fórmulas con un evaluador
  propio (SUM, SUMIFS, COUNTIFS, COUNT, ROUND, IF, EOMONTH, SUBTOTAL, referencias a otras
  hojas y a la Tabla) sobre los datos de la hoja Facturas, y comprueba también que la caché
  de resultados escrita por ExcelJS coincide con lo evaluado.
- Cuadra total, por categoría, por mes y recurrente (mensual y anual): Excel = /resumen =
  suma independiente desde esperado.json (sin la duplicada).

Lee N8N_BASE_URL y FACT_API_KEY de .env. Nunca imprime el token.
"""
from __future__ import annotations

import re
import shutil
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl
import requests
from openpyxl.utils import column_index_from_string, get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probar_api import cargar_esperado, check, leer_env, resultados  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
DESDE, HASTA = "2026-01-01", "2026-10-14"
HOJAS = ["Resumen", "Facturas", "Por mes", "Suscripciones y contratos", "Recomendaciones",
         "Libro registro", "IVA trimestre", "Retenciones", "347", "Asientos", "Pendientes de pago"]  # 6 últimas: modo gestoría (tanda B)
HOJAS_FISCALES = HOJAS[5:]
COLOR_CAB = "FF0F4C5C"
ERRORES = {"#REF!", "#VALUE!", "#NAME?", "#DIV/0!", "#N/A", "#NUM!", "#NULL!"}
POR_ANIO = {"semanal": 52, "mensual": 12, "bimestral": 6, "trimestral": 4, "semestral": 2, "anual": 1}
EPOCA = date(1899, 12, 30)


def c(x) -> int:
    return round(float(x) * 100)


# =================================================================== evaluador de fórmulas
class ErrorFormula(Exception):
    pass


TOKEN = re.compile(r"""
    (?P<str>"(?:[^"]|"")*")
  | (?P<ref>(?:(?:'[^']+'|[A-Za-z_][\w.]*)!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)
  | (?P<tabla>[A-Za-z_]\w*\[(?:[^\[\]]|\[[^\]]*\])*\])
  | (?P<func>[A-Z][A-Z0-9.]*\()
  | (?P<num>\d+(?:\.\d+)?)
  | (?P<op><=|>=|<>|[-+*/&=<>(),])
  | (?P<esp>\s+)
""", re.X)


def a_serial(v):
    if isinstance(v, datetime):
        v = v.date()
    if isinstance(v, date):
        return (v - EPOCA).days
    return v


class Libro:
    def __init__(self, wb):
        self.wb = wb
        self.cache: dict = {}

    def valor(self, hoja: str, coord: str):
        k = (hoja, coord)
        if k in self.cache:
            return self.cache[k]
        v = self.wb[hoja][coord].value
        if isinstance(v, str) and v.startswith("="):
            v = self.evaluar(v[1:], hoja)
        elif v is None:
            v = None
        else:
            v = a_serial(v)
        self.cache[k] = v
        return v

    def rango(self, hoja: str, ref: str):
        ref = ref.replace("$", "")
        if ":" not in ref:
            return [self.valor(hoja, ref)]
        a, b = ref.split(":")
        ca, fa = re.match(r"([A-Z]+)(\d+)", a).groups()
        cb, fb = re.match(r"([A-Z]+)(\d+)", b).groups()
        out = []
        for f in range(int(fa), int(fb) + 1):
            for col in range(column_index_from_string(ca), column_index_from_string(cb) + 1):
                out.append(self.valor(hoja, f"{get_column_letter(col)}{f}"))
        return out

    def tabla(self, txt: str):
        nombre, resto = txt.split("[", 1)
        col = re.findall(r"\[?([^\[\],#]+)\]?\]$", txt)[0] if "#" in txt else resto[:-1]
        for ws in self.wb.worksheets:
            if nombre in ws.tables:
                t = ws.tables[nombre]
                a, b = t.ref.split(":")
                ca, fa = re.match(r"([A-Z]+)(\d+)", a).groups()
                cb, fb = re.match(r"([A-Z]+)(\d+)", b).groups()
                cab = {ws.cell(int(fa), i).value: i for i in range(column_index_from_string(ca), column_index_from_string(cb) + 1)}
                if col not in cab:
                    raise ErrorFormula(f"#REF! columna {col}")
                fin = int(fb) - (t.totalsRowCount or 0)
                letra = get_column_letter(cab[col])
                return self.rango(ws.title, f"{letra}{int(fa) + 1}:{letra}{fin}")
        raise ErrorFormula(f"#REF! tabla {nombre}")

    # ---- parser recursivo ----
    def evaluar(self, formula: str, hoja: str):
        toks = []
        pos = 0
        while pos < len(formula):
            m = TOKEN.match(formula, pos)
            if not m:
                raise ErrorFormula(f"#NAME? no se entiende: {formula[pos:pos + 15]}")
            pos = m.end()
            if m.lastgroup != "esp":
                toks.append((m.lastgroup, m.group()))
        guardado = (getattr(self, "toks", None), getattr(self, "i", 0), getattr(self, "hoja", None))
        self.toks, self.i, self.hoja = toks, 0, hoja
        v = self._comparacion()
        if self.i != len(self.toks):
            raise ErrorFormula("#VALUE! sobran símbolos")
        self.toks, self.i, self.hoja = guardado
        return v

    def _ver(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def _tomar(self):
        t = self.toks[self.i]
        self.i += 1
        return t

    def _saltar_argumento(self):
        nivel = 0
        while self.i < len(self.toks):
            t = self.toks[self.i][1]
            if t in (",", ")") and nivel == 0:
                return
            nivel += t.endswith("(") - (t == ")")
            self.i += 1

    def _comparacion(self):
        a = self._concat()
        while self._ver()[1] in ("=", "<>", "<", ">", "<=", ">="):
            op = self._tomar()[1]
            b = self._concat()
            a = comparar(a, op, b)
        return a

    def _concat(self):
        a = self._suma()
        while self._ver()[1] == "&":
            self._tomar()
            b = self._suma()
            a = texto(a) + texto(b)
        return a

    def _suma(self):
        a = self._mult()
        while self._ver()[1] in ("+", "-"):
            op = self._tomar()[1]
            b = self._mult()
            a = num(a) + num(b) if op == "+" else num(a) - num(b)
        return a

    def _mult(self):
        a = self._unario()
        while self._ver()[1] in ("*", "/"):
            op = self._tomar()[1]
            b = self._unario()
            if op == "/" and num(b) == 0:
                raise ErrorFormula("#DIV/0!")
            a = num(a) * num(b) if op == "*" else num(a) / num(b)
        return a

    def _unario(self):
        if self._ver()[1] == "-":
            self._tomar()
            return -num(self._unario())
        return self._primario()

    def _primario(self):
        tipo, txt = self._tomar()
        if tipo == "num":
            return float(txt)
        if tipo == "str":
            return txt[1:-1].replace('""', '"')
        if tipo == "op" and txt == "(":
            v = self._comparacion()
            self._tomar()
            return v
        if tipo == "ref":
            hoja = self.hoja
            if "!" in txt:
                hoja, txt = txt.rsplit("!", 1)
                hoja = hoja.strip("'")
            vals = self.rango(hoja, txt)
            return vals if ":" in txt else vals[0]
        if tipo == "tabla":
            return self.tabla(txt)
        if tipo == "func":
            nombre = txt[:-1]
            args = []
            if self._ver()[1] != ")":
                while True:
                    try:  # los errores se guardan como valor: IF solo evalúa la rama elegida
                        args.append(self._comparacion())
                    except ErrorFormula as e:
                        args.append(e)
                        self._saltar_argumento()
                    if self._ver()[1] == ",":
                        self._tomar()
                        continue
                    break
            self._tomar()
            return funcion(nombre, args)
        raise ErrorFormula(f"#VALUE! token {txt}")


def num(v):
    if v is None or v == "":
        return 0.0
    if isinstance(v, list):
        raise ErrorFormula("#VALUE! rango en operación")
    return float(v)


def texto(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return "" if v is None else str(v)


def comparar(a, op, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) or (a in (None, "") and isinstance(b, (int, float))):
        a, b = num(a), num(b)
    else:
        a, b = texto(a).lower(), texto(b).lower()
    return {"=": a == b, "<>": a != b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]


def cumple(v, criterio) -> bool:
    if isinstance(criterio, (int, float)):
        return isinstance(v, (int, float)) and float(v) == float(criterio)
    m = re.match(r"(<=|>=|<>|=|<|>)?(.*)$", str(criterio))
    op, val = m.group(1) or "=", m.group(2)
    try:
        val_n = float(val)
        return isinstance(v, (int, float)) and comparar(float(v), op, val_n)
    except ValueError:
        return comparar(texto(v), op, val)


def funcion(nombre, args):
    if nombre == "IF":
        if isinstance(args[0], ErrorFormula):
            raise args[0]
        elegido = args[1] if args[0] else (args[2] if len(args) > 2 else False)
        if isinstance(elegido, ErrorFormula):
            raise elegido
        return elegido
    for a in args:
        if isinstance(a, ErrorFormula):
            raise a
    plano = lambda xs: [y for x in xs for y in (x if isinstance(x, list) else [x])]  # noqa: E731
    if nombre in ("SUM",):
        return sum(float(x) for x in plano(args) if isinstance(x, (int, float)) and not isinstance(x, bool))
    if nombre == "SUBTOTAL":
        if int(args[0]) not in (9, 109):
            raise ErrorFormula("#VALUE! SUBTOTAL no soportado")
        return funcion("SUM", args[1:])
    if nombre == "COUNT":
        return float(sum(1 for x in plano(args) if isinstance(x, (int, float)) and not isinstance(x, bool)))
    if nombre in ("SUMIFS", "COUNTIFS"):
        suma = args[0] if nombre == "SUMIFS" else None
        pares = args[1:] if nombre == "SUMIFS" else args
        n = len(pares[0])
        total = 0.0
        for i in range(n):
            if all(cumple(pares[k][i], pares[k + 1]) for k in range(0, len(pares), 2)):
                total += (num(suma[i]) if isinstance(suma[i], (int, float)) else 0.0) if suma is not None else 1.0
        return total
    if nombre == "ROUND":
        from decimal import ROUND_HALF_UP, Decimal
        return float(Decimal(repr(num(args[0]))).quantize(Decimal(1).scaleb(-int(num(args[1]))), rounding=ROUND_HALF_UP))
    if nombre == "EOMONTH":
        d = EPOCA + timedelta(days=int(num(args[0])))
        y, m = d.year, d.month + int(num(args[1])) + 1
        while m > 12:
            m -= 12
            y += 1
        return float((date(y, m, 1) - timedelta(days=1) - EPOCA).days)
    raise ErrorFormula(f"#NAME? función {nombre}")


# =================================================================== cálculo independiente
def independiente(esp: list[dict]) -> dict:
    per = [e for e in esp if DESDE <= e["fecha_emision"] <= HASTA]
    por_cat, por_mes, por_cat_mes = defaultdict(int), defaultdict(int), defaultdict(int)
    for e in per:
        por_cat[e["categoria"]] += c(e["total"])
        por_mes[e["fecha_emision"][:7]] += c(e["total"])
        por_cat_mes[(e["categoria"], e["fecha_emision"][:7])] += c(e["total"])
    ult = {}
    for e in sorted(per, key=lambda x: x["fecha_emision"]):
        if e["tipo_gasto"] in ("suscripcion", "contrato"):
            ult[e["nif"] or e["proveedor"]] = e
    anual = sum(c(e["total"]) * POR_ANIO[e["periodicidad"]] for e in ult.values())
    mensual = sum(round(c(e["total"]) * POR_ANIO[e["periodicidad"]] / 12) for e in ult.values())
    return {"total": sum(c(e["total"]) for e in per), "num": len(per), "por_cat": dict(por_cat), "por_mes": dict(por_mes),
            "por_cat_mes": dict(por_cat_mes), "mensual": mensual, "anual": anual}


# =================================================================== comprobaciones
def es_moneda(fmt: str) -> bool:
    return "€" in (fmt or "") and "0.00" in fmt


def cab_ok(cell) -> bool:
    return (cell.fill is not None and cell.fill.fgColor is not None and cell.fill.fgColor.rgb == COLOR_CAB
            and cell.font is not None and cell.font.bold and cell.font.color is not None and cell.font.color.rgb == "FFFFFFFF")


def ancho_col(ws, idx: int) -> float:
    """Ancho de la columna idx (1-based) teniendo en cuenta los grupos <col min max> que escribe ExcelJS."""
    for d in ws.column_dimensions.values():
        if d.min and d.max and d.min <= idx <= d.max and d.width:
            return float(d.width)
    return 8.43


def revisar_presentacion(wb) -> None:
    print("== Presentación: anchos, textos legibles e impresión")
    filas_cab = {"Resumen": [4, 13], "Facturas": [1], "Por mes": [1], "Suscripciones y contratos": [1], "Recomendaciones": [1], **{h: [1] for h in HOJAS_FISCALES}}
    for nombre in HOJAS:
        ws = wb[nombre]
        cortas = []
        for f in filas_cab[nombre]:
            for cl in ws[f]:
                if cl.value is None:
                    continue
                largo = 8 if isinstance(cl.value, datetime) else len(str(cl.value))
                minimo = max(12, largo + 6)
                if ancho_col(ws, cl.column) < minimo:
                    cortas.append(f"{cl.coordinate}={ancho_col(ws, cl.column):g}<{minimo}")
        check(f"{nombre}: ancho >= max(12, cabecera + 6) en todas las columnas", not cortas, ", ".join(cortas[:6]))
        ps, pp = ws.page_setup, ws.sheet_properties.pageSetUpPr
        check(f"{nombre}: impresión horizontal, 1 página de ancho", ps.orientation == "landscape" and pp is not None and pp.fitToPage
              and int(ps.fitToWidth or 1) == 1 and int(ps.fitToHeight) == 0, f"{ps.orientation} fitToPage={pp and pp.fitToPage} {ps.fitToWidth}x{ps.fitToHeight}")
        m = ws.page_margins
        check(f"{nombre}: márgenes estrechos", (m.left, m.right, m.top, m.bottom) == (0.25, 0.25, 0.75, 0.75), f"{m.left},{m.right},{m.top},{m.bottom}")
        check(f"{nombre}: fila de títulos repetida", bool(ws.print_title_rows), str(ws.print_title_rows))
        usado = f"'{nombre}'!$A$1:${get_column_letter(ws.max_column)}${ws.max_row}"
        check(f"{nombre}: área de impresión = rango usado", ws.print_area == usado, f"{ws.print_area} / {usado}")
    ws = wb["Facturas"]
    cab = {cl.value: cl.column for cl in ws[1]}
    col = lambda k: [ws.cell(r, cab[k]).value for r in range(2, ws.max_row) if ws.cell(r, cab[k]).value is not None]  # noqa: E731
    may = lambda v: isinstance(v, str) and v[:1] == v[:1].upper()  # noqa: E731
    check("Facturas: Tipo legible (Puntual/Suscripción/Contrato)", set(col("Tipo")) <= {"Puntual", "Suscripción", "Contrato"} and bool(col("Tipo")), str(sorted(set(col("Tipo")))))
    check("Facturas: Estado legible (Correcta/Revisar/Posible duplicada)", set(col("Estado")) <= {"Correcta", "Revisar", "Posible duplicada"} and bool(col("Estado")), str(sorted(set(col("Estado")))))
    check("Facturas: Periodicidad con mayúscula inicial", bool(col("Periodicidad")) and all(may(v) for v in col("Periodicidad")), str(sorted(set(col("Periodicidad")))))
    check("Facturas: Método de pago con mayúscula inicial", bool(col("Método de pago")) and all(may(v) for v in col("Método de pago")), str(sorted(set(col("Método de pago")))))
    wsus = wb["Suscripciones y contratos"]
    tipos = {wsus.cell(r, 3).value for r in range(2, wsus.max_row) if wsus.cell(r, 3).value}
    pers = {wsus.cell(r, 4).value for r in range(2, wsus.max_row) if wsus.cell(r, 4).value}
    check("Suscripciones: Tipo y Periodicidad legibles", bool(tipos) and tipos <= {"Suscripción", "Contrato"} and all(may(v) for v in pers), f"{sorted(tipos)} {sorted(pers)}")


def revisar_estilos(wb) -> None:
    print("== Estructura y estilos")
    check("11 hojas con los nombres pedidos (5 + 6 fiscales)", wb.sheetnames == HOJAS, str(wb.sheetnames))
    filas_cab = {"Resumen": [4, 13], "Facturas": [1], "Por mes": [1], "Suscripciones y contratos": [1], "Recomendaciones": [1], **{h: [1] for h in HOJAS_FISCALES}}
    for nombre in HOJAS:
        if nombre not in wb.sheetnames:
            continue
        ws = wb[nombre]
        check(f"{nombre}: nombre de hoja válido", len(nombre) <= 31 and not re.search(r"[\[\]:*?/\\]", nombre))
        for f in filas_cab[nombre]:
            celdas = [cl for cl in ws[f] if cl.value is not None]
            check(f"{nombre}: cabecera fila {f} con relleno {COLOR_CAB[2:]} y texto blanco en negrita", bool(celdas) and all(cab_ok(cl) for cl in celdas))
        check(f"{nombre}: paneles inmovilizados", ws.freeze_panes is not None, str(ws.freeze_panes))
        check(f"{nombre}: autofiltro o Tabla", bool(ws.auto_filter.ref) or bool(ws.tables), str(ws.auto_filter.ref or list(ws.tables)))
        anchos = [ancho_col(ws, i) for i in range(1, ws.max_column + 1)]
        check(f"{nombre}: anchos de columna ajustados", all(w and w > 8.43 for w in anchos[:3]), str([round(w or 0, 1) for w in anchos[:6]]))
    ws = wb["Facturas"]
    t = ws.tables.get("TablaFacturas")
    check("Facturas: Tabla de Excel con fila de totales y filtros", t is not None and t.totalsRowCount == 1 and t.autoFilter is not None, t.ref if t else "")
    cab = [cl.value for cl in ws[1]]
    esperadas = ["Fecha emisión", "Vencimiento", "Proveedor", "NIF", "Nº factura", "Categoría", "Subcategoría", "Tipo", "Periodicidad",
                 "Base", "IVA %", "Cuota IVA", "Total", "Moneda", "Método de pago", "Estado", "Confianza",
                 "Cliente", "Tipo factura", "Operación", "Retención", "Total a pagar", "Deducible", "Cuenta", "Estado de pago"]
    check("Facturas: columnas pedidas", cab == esperadas, str(cab))
    fechas = [ws.cell(r, 1) for r in range(2, ws.max_row)]
    check("Facturas: fechas de emisión como fecha real dd/mm/yyyy", all(isinstance(x.value, datetime) and x.number_format == "dd/mm/yyyy" for x in fechas))
    venc = [ws.cell(r, 2) for r in range(2, ws.max_row) if ws.cell(r, 2).value is not None]
    check("Facturas: vencimientos como fecha real dd/mm/yyyy", bool(venc) and all(isinstance(x.value, datetime) and x.number_format == "dd/mm/yyyy" for x in venc))
    check("Facturas: importes con formato €", all(es_moneda(ws.cell(r, 13).number_format) for r in range(2, ws.max_row + 1)), ws.cell(2, 13).number_format)
    check("Facturas: filas alternas con relleno", (ws.cell(3, 3).fill.fgColor.rgb != ws.cell(2, 3).fill.fgColor.rgb), f"{ws.cell(2, 3).fill.fgColor.rgb} / {ws.cell(3, 3).fill.fgColor.rgb}")
    check("Facturas: bordes finos", ws.cell(2, 3).border.left.style == "thin" and ws.cell(2, 3).border.bottom.style == "thin")
    tot = ws.cell(ws.max_row, 13).value
    check("Facturas: fila de totales con SUBTOTAL/SUM", isinstance(tot, str) and re.match(r"=(SUBTOTAL|SUM)\(", tot) is not None, str(tot))

    print("== Fórmulas y formato condicional")
    formulas = {n: [cl.value for row in wb[n].iter_rows() for cl in row if isinstance(cl.value, str) and cl.value.startswith("=")] for n in HOJAS}
    check("Resumen: SUMIFS por categoría", any("SUMIFS(" in f for f in formulas["Resumen"]))
    check("Resumen: SUM en totales", any(f.startswith("=SUM(") for f in formulas["Resumen"]))
    check("Resumen: % con fórmula", any("/$B$" in f for f in formulas["Resumen"]))
    check("Por mes: SUMIFS por rango de fechas del mes", any("SUMIFS(" in f and "EOMONTH" in f for f in formulas["Por mes"]))
    check("Por mes: SUM en totales de fila y columna", sum(1 for f in formulas["Por mes"] if f.startswith("=SUM(")) >= 2)
    check("Suscripciones: coste anual con fórmula (importe × periodos)", any(re.fullmatch(r"=F\d+\*G\d+", f) for f in formulas["Suscripciones y contratos"]))
    check("Suscripciones: SUM en totales", sum(1 for f in formulas["Suscripciones y contratos"] if f.startswith("=SUM(")) >= 2)
    check("Recomendaciones: SUM del ahorro potencial", any(f.startswith("=SUM(") for f in formulas["Recomendaciones"]))
    for nombre, tipo in (("Resumen", "dataBar"), ("Por mes", "colorScale"), ("Suscripciones y contratos", "dataBar")):
        tipos = [r.type for rango in wb[nombre].conditional_formatting for r in rango.rules]
        check(f"{nombre}: formato condicional {tipo}", tipo in tipos, str(tipos))
    cs = [r for rango in wb["Por mes"].conditional_formatting for r in rango.rules if r.type == "colorScale"]
    check("Por mes: escala de 3 colores", bool(cs) and len(cs[0].colorScale.cfvo) == 3)
    check("IVA trimestre: SUMIFS sobre «Libro registro»", any("SUMIFS('Libro registro'" in f for f in formulas["IVA trimestre"]))
    check("Retenciones: SUMIFS por trimestre y modelo", any("SUMIFS(" in f for f in formulas["Retenciones"]))
    for n in ("Libro registro", "Asientos", "Pendientes de pago", "347"):
        check(f"{n}: SUM en la fila de totales (0 si la hoja está vacía)", any(f.startswith("=SUM(") for f in formulas[n]) or (formulas[n] and all(f == "=0" for f in formulas[n])))
    lr = wb["Libro registro"]
    check("Libro registro: fechas de expedición como fecha real dd/mm/yyyy", all(isinstance(lr.cell(r, 2).value, datetime) and lr.cell(r, 2).number_format == "dd/mm/yyyy"
                                                                                    for r in range(2, lr.max_row) if lr.cell(r, 1).value not in (None, "Total")))
    errores = [f"{ws.title}!{cl.coordinate}" for ws in wb.worksheets for row in ws.iter_rows() for cl in row if isinstance(cl.value, str) and cl.value.strip() in ERRORES]
    check("ningún valor de error en celdas", not errores, ", ".join(errores[:5]))


def evaluar_todo(wb, wb_cache) -> Libro:
    print("== Recalculo (evaluador propio; LibreOffice no disponible)")
    lib = Libro(wb)
    fallos, distintos, n = [], [], 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cl in row:
                if isinstance(cl.value, str) and cl.value.startswith("="):
                    n += 1
                    try:
                        v = lib.valor(ws.title, cl.coordinate)
                    except ErrorFormula as e:
                        fallos.append(f"{ws.title}!{cl.coordinate}: {e}")
                        continue
                    cache = wb_cache[ws.title][cl.coordinate].value
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        if not isinstance(cache, (int, float)) or abs(float(cache) - v) > 0.005:
                            distintos.append(f"{ws.title}!{cl.coordinate} {cache} vs {v}")
    check(f"{n} fórmulas evaluadas sin errores", not fallos, "; ".join(fallos[:4]))
    check("resultados en caché de ExcelJS = recalculados", not distintos, "; ".join(distintos[:4]))
    return lib


def cuadrar(wb, lib: Libro, ind: dict, resumen: dict | None, recs: dict | None) -> None:
    print("== Cuadre Excel / API / cálculo independiente")
    wr = wb["Resumen"]
    kpi = {wr.cell(r, 1).value: lib.valor("Resumen", f"B{r}") for r in range(5, 12)}
    total_x = c(kpi["Total gastado"])
    check("total Excel = independiente = 1.029,58 €", total_x == ind["total"] == 102958, f"{total_x / 100:.2f} / {ind['total'] / 100:.2f}")
    if resumen:
        check("total Excel = /resumen", total_x == c(resumen["total"]), f"{resumen['total']}")
        check("nº de facturas Excel = /resumen = independiente", int(kpi["Nº de facturas"]) == resumen["num_facturas"] == ind["num"])
    check("recurrente mensual Excel = 177,41 = independiente", c(kpi["Recurrente mensual"]) == ind["mensual"] == 17741, f"{kpi['Recurrente mensual']:.2f}")
    check("recurrente anual Excel = 2.128,92 = independiente", c(kpi["Recurrente anual"]) == ind["anual"] == 212892, f"{kpi['Recurrente anual']:.2f}")
    if resumen:
        check("recurrente Excel = /resumen", (c(kpi["Recurrente mensual"]), c(kpi["Recurrente anual"])) == (c(resumen["recurrente"]["mensual"]), c(resumen["recurrente"]["anual"])))
        ant = [v for k, v in kpi.items() if str(k).startswith("Periodo anterior")][0]
        check("periodo anterior Excel = /resumen", c(ant) == c(resumen["comparacion_periodo_anterior"]["total"]))
    # por categoría (Resumen)
    cat_x, r = {}, 14
    while wr.cell(r, 1).value not in (None, "Total"):
        cat_x[wr.cell(r, 1).value] = c(lib.valor("Resumen", f"B{r}"))
        r += 1
    check("Resumen: total de la tabla de categorías = total", c(lib.valor("Resumen", f"B{r}")) == ind["total"])
    check("Resumen: % suman 100 %", abs(lib.valor("Resumen", f"D{r}") - 1) < 1e-9)
    check("por categoría Excel = independiente", cat_x == ind["por_cat"], str({k: v for k, v in cat_x.items() if ind["por_cat"].get(k) != v}))
    if resumen:
        check("por categoría Excel = /resumen", cat_x == {x["categoria"]: c(x["total"]) for x in resumen["por_categoria"]})
    # por mes
    wm = wb["Por mes"]
    meses = []
    col = 2
    while wm.cell(1, col).value != "Total":
        d = wm.cell(1, col).value
        meses.append((col, f"{d.year}-{d.month:02d}"))
        col += 1
    fila_tot = max(r for r in range(2, wm.max_row + 1) if wm.cell(r, 1).value == "Total")
    mes_x = {m: c(lib.valor("Por mes", f"{get_column_letter(cl)}{fila_tot}")) for cl, m in meses}
    esperado_mes = {m: ind["por_mes"].get(m, 0) for _, m in meses}
    check("Por mes: meses = todos los del periodo", [m for _, m in meses] == [f"2026-{i:02d}" for i in range(1, 11)])
    check("por mes Excel = independiente", mes_x == esperado_mes, str({k: v for k, v in mes_x.items() if esperado_mes[k] != v}))
    if resumen:
        check("por mes Excel = /resumen", mes_x == {x["mes"]: c(x["total"]) for x in resumen["por_mes"]})
    celdas = {(wm.cell(r, 1).value, m): c(lib.valor("Por mes", f"{get_column_letter(cl)}{r}")) for r in range(2, fila_tot) for cl, m in meses}
    check("matriz categoría × mes = independiente", {k: v for k, v in celdas.items() if v} == ind["por_cat_mes"])
    check("Por mes: total general = total", c(lib.valor("Por mes", f"{get_column_letter(len(meses) + 2)}{fila_tot}")) == ind["total"])
    # recomendaciones
    if recs is not None:
        wrc = wb["Recomendaciones"]
        n = len(recs.get("recomendaciones", []))
        check("Recomendaciones: tantas filas como la última guardada", all(wrc.cell(i + 2, 1).value == x["titulo"] for i, x in enumerate(recs["recomendaciones"])), str(n))
        anual = sum(c(x["ahorro_anual"]) for x in recs["recomendaciones"])
        check("Recomendaciones: total ahorro anual = suma de la última guardada", c(lib.valor("Recomendaciones", f"E{n + 2}")) == anual, f"{anual / 100:.2f}")
    # hojas fiscales (tanda B): cuadres internos con los datos reales
    wl = wb["Libro registro"]
    tl = max(r for r in range(1, wl.max_row + 1) if wl.cell(r, 1).value == "Total")
    base_x = c(lib.valor("Libro registro", f"I{tl}"))
    base_f = sum(c(lib.valor("Facturas", f"J{r}") or 0) for r in range(2, wb["Facturas"].max_row))
    check("Libro registro: Σ base imponible = Σ base de la hoja Facturas", base_x == base_f, f"{base_x / 100:.2f} / {base_f / 100:.2f}")
    wa = wb["Asientos"]
    ta = max(r for r in range(1, wa.max_row + 1) if wa.cell(r, 1).value == "Total")
    check("Asientos: Σ debe = Σ haber", c(lib.valor("Asientos", f"E{ta}")) == c(lib.valor("Asientos", f"F{ta}")) != 0)
    grupos = defaultdict(lambda: [0, 0])
    for r in range(2, ta):
        grupos[wa.cell(r, 1).value][0] += c(wa.cell(r, 5).value or 0)
        grupos[wa.cell(r, 1).value][1] += c(wa.cell(r, 6).value or 0)
    nota = next((str(wa.cell(r, 1).value) for r in range(ta + 1, wa.max_row + 1) if str(wa.cell(r, 1).value or "").startswith("Facturas sin asiento")), "")
    excluidas = re.findall(r"\d+", nota)
    check("Asientos: cada asiento cuadra y hay uno por factura (las que no cuadran, p. ej. la Repsol con el IVA mal sumado, van en la nota)",
          all(d == h for d, h in grupos.values()) and len(grupos) + len(excluidas) == ind["num"], f"{len(grupos)} asientos + {len(excluidas)} excluidas")


def main() -> int:
    env = leer_env()
    base = env["N8N_BASE_URL"].rstrip("/") + "/webhook"
    cab = {"X-API-Key": env["FACT_API_KEY"]}
    hoy = date.today().isoformat()
    salida = RAIZ / "tests" / "salida"
    salida.mkdir(parents=True, exist_ok=True)
    destino = salida / f"Gastos_{hoy}.xlsx"
    resumen = recs = None
    if "--archivo" in sys.argv:
        origen = Path(sys.argv[sys.argv.index("--archivo") + 1])
        if origen.resolve() != destino.resolve():
            shutil.copy(origen, destino)
    else:
        print("== Descarga GET /exportar")
        r = requests.get(base + "/exportar", params={"desde": DESDE, "hasta": HASTA}, headers=cab, timeout=120)
        check("GET /exportar 200", r.status_code == 200, str(r.status_code))
        check("Content-Type XLSX", r.headers.get("Content-Type", "").startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), r.headers.get("Content-Type"))
        cd = r.headers.get("Content-Disposition", "")
        check(f"Content-Disposition attachment; filename=Gastos_{hoy}.xlsx", "attachment" in cd and f'filename="Gastos_{hoy}.xlsx"' in cd, cd)
        check("Access-Control-Expose-Headers incluye Content-Disposition", "content-disposition" in r.headers.get("Access-Control-Expose-Headers", "").lower())
        destino.write_bytes(r.content)
        print(f"     guardado en {destino}")
        r = requests.get(base + "/exportar", params={"desde": "2026-02-30"}, headers=cab, timeout=60)
        check("GET /exportar 400 con fecha inválida", r.status_code == 400, str(r.status_code))
        r = requests.get(base + "/exportar", timeout=60)
        check("GET /exportar 403 sin clave", r.status_code == 403, str(r.status_code))
        r = requests.get(base + "/exportar", params={"desde": DESDE, "hasta": HASTA}, headers={**cab, "Origin": "null"}, timeout=60)
        check("CORS: Access-Control-Allow-Origin para Origin null", r.headers.get("Access-Control-Allow-Origin") == "null", str(r.headers.get("Access-Control-Allow-Origin")))
        resumen = requests.get(base + "/resumen", params={"desde": DESDE, "hasta": HASTA}, headers=cab, timeout=60).json()
        rr = requests.get(base + "/recomendaciones", headers=cab, timeout=60)
        recs = rr.json() if rr.status_code == 200 else {"recomendaciones": []}

    wb = openpyxl.load_workbook(destino)
    wb_cache = openpyxl.load_workbook(destino, data_only=True)
    revisar_estilos(wb)
    revisar_presentacion(wb)
    lib = evaluar_todo(wb, wb_cache)
    cuadrar(wb, lib, independiente(cargar_esperado()), resumen, recs)

    fallos = [x for x in resultados if not x[1]]
    print(f"\nResultado: {len(resultados) - len(fallos)}/{len(resultados)} OK" + (f", {len(fallos)} FALLO" if fallos else ""))
    print("OK" if not fallos else "FALLO")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
