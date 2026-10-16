// Genera Gastos_AAAA-MM-DD.xlsx con ExcelJS. Las tablas de resumen usan FÓRMULAS
// (SUMIFS/COUNTIFS/SUM sobre la hoja Facturas); los valores calculados aquí en céntimos
// se guardan como resultado en caché de cada fórmula (Excel recalcula al abrir).
const ExcelJS = require('exceljs');
const p = $('Parámetros').first().json;
const { desde, hasta, hoy } = p;
const DIA = 86400000;
const aMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const aFecha = (ms) => new Date(ms).toISOString().slice(0, 10);
// Fechas como número de serie de Excel (días desde 1899-12-30) con formato dd/mm/yyyy: es como Excel
// guarda las fechas. No se usan objetos Date porque el task runner de n8n los crea en otro contexto
// (vm) y ExcelJS no los reconoce (instanceof Date falla) y los escribe como texto.
const aSerial = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? aMs(s) / DIA + 25569 : null);
// Por el mismo motivo, las filas se escriben celda a celda (addRow/values con arrays del sandbox fallan).
const ponerFila = (ws, r, valores) => valores.forEach((v, i) => { if (v !== undefined && v !== null) ws.getRow(r).getCell(i + 1).value = v; });
const fmtFecha = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
const EXCLUIDOS = ['borrada', 'duplicada'];
// Textos legibles solo para mostrar en las hojas (los datos guardan los códigos). Ninguna fórmula filtra por
// tipo ni por estado (SUMIFS/COUNTIFS usan categoría y fecha), así que cambiar estos textos no afecta a los cálculos.
const TIPO_TXT = { puntual: 'Puntual', suscripcion: 'Suscripción', contrato: 'Contrato' };
const ESTADO_TXT = { ok: 'Correcta', revisar: 'Revisar', posible_duplicada: 'Posible duplicada', duplicada: 'Duplicada', borrada: 'Borrada' };
const mayuscula = (s) => { const t = typeof s === 'string' ? s.trim() : ''; return t ? t.charAt(0).toLocaleUpperCase('es-ES') + t.slice(1) : null; };
const txtTipo = (t) => (t ? TIPO_TXT[t] || mayuscula(t) : null);
const txtEstado = (e) => (e ? ESTADO_TXT[e] || mayuscula(e) : null);
const TXT_DEDUCIBLE = { si: 'Sí', no: 'No', parcial: 'Parcial', dudoso: 'Dudoso', na: 'No aplica' };

/*@@COMUN_FISCAL@@*/

// === COMÚN Recurrentes: inicio ===
// Bloque idéntico en FACT — API («Resumen: calcular»), FACT — Asesor de gastos
// («Analizar y proponer») y FACT — Exportar Excel («Generar Excel»).
// Si cambias algo aquí, cópialo en los tres. Céntimos enteros.
// Por cada proveedor_norm con facturas suscripcion/contrato se toma la última
// (fecha_emision; a igualdad, id) y la anterior. coste_anual = importe × periodos/año;
// coste_mensual = coste_anual / 12 redondeado al céntimo; los totales suman esos valores.
const POR_ANIO = { semanal: 52, mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 };
const centimos = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : 0);
const claveProveedor = (f) => f.proveedor_norm || String(f.proveedor || 'desconocido').toLowerCase();
const ordenFecha = (a, b) => (a.fecha_emision === b.fecha_emision ? a.id - b.id : a.fecha_emision < b.fecha_emision ? -1 : 1);
const calcularRecurrentes = (facturas) => {
  const grupos = {};
  for (const f of facturas.filter((x) => x.tipo_gasto === 'suscripcion' || x.tipo_gasto === 'contrato').sort(ordenFecha)) {
    const k = claveProveedor(f);
    (grupos[k] = grupos[k] || []).push(f);
  }
  let mensualC = 0;
  let anualC = 0;
  const items = Object.keys(grupos).map((clave) => {
    const lista = grupos[clave];
    const factura = lista[lista.length - 1];
    const anterior = lista.length > 1 ? lista[lista.length - 2] : null;
    const veces = POR_ANIO[factura.periodicidad] || null;
    const importeC = centimos(factura.total);
    const anual = veces ? importeC * veces : null;
    const mensual = veces ? Math.round(anual / 12) : null;
    if (veces) { anualC += anual; mensualC += mensual; }
    return { clave, factura, anterior, num: lista.length, veces, importeC, mensualC: mensual, anualC: anual };
  });
  return { items, mensualC, anualC };
};
// === COMÚN Recurrentes: fin ===

const eur = (c) => Math.round(c) / 100;
// Importes en EUROS (total_eur): nunca se suman monedas distintas. Filas antiguas en EUR sin
// total_eur usan el total; una factura en otra moneda sin tipo de cambio no se incluye.
const enEuros = (f) => (typeof f.total_eur === 'number' && Number.isFinite(f.total_eur) ? f.total_eur
  : (!f.moneda || f.moneda === 'EUR') && typeof f.total === 'number' ? f.total : null);
// Tanda A del modo gestoría: todas las cifras del libro en EUR (base y cuota de una factura en otra
// moneda se convierten con su tipo_cambio). cliente_id (opcional) limita el libro a un cliente.
const aEur = (x, f) => (typeof x !== 'number' ? x : (!f.moneda || f.moneda === 'EUR') ? x : Math.round(x * (f.tipo_cambio || 0) * 100) / 100);
const crudas = $('Leer facturas').all().map((i) => i.json)
  .filter((f) => f && f.id !== undefined && f.id !== null && f.usuario_id === 'default' && (p.cliente_id === null || p.cliente_id === undefined || f.cliente_id === p.cliente_id));
const filas = crudas
  .filter((f) => enEuros(f) !== null)
  .map((f) => ({ ...f, base: aEur(f.base, f), iva_cuota: aEur(f.iva_cuota, f), irpf_cuota: aEur(f.irpf_cuota, f), total_a_pagar: aEur(f.total_a_pagar, f), total: enEuros(f), moneda: 'EUR' }));
// Clientes de la gestoría (nombre en las hojas y prorrata/régimen para el cálculo fiscal).
const clientesPorId = {};
for (const it of $('Leer clientes').all()) if (it.json && it.json.id !== undefined && it.json.id !== null) clientesPorId[it.json.id] = it.json;
const nombreCliente = (id) => (clientesPorId[id] ? clientesPorId[id].nombre : null);
const validas = filas.filter((f) => !EXCLUIDOS.includes(f.estado) && typeof f.fecha_emision === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha_emision));
const periodo = validas.filter((f) => f.fecha_emision >= desde && f.fecha_emision <= hasta).sort(ordenFecha);
const totalC = periodo.reduce((s, f) => s + centimos(f.total), 0);
const dias = Math.round((aMs(hasta) - aMs(desde)) / DIA) + 1;
const antHasta = aFecha(aMs(desde) - DIA);
const antDesde = aFecha(aMs(desde) - dias * DIA);
const antC = validas.filter((f) => f.fecha_emision >= antDesde && f.fecha_emision <= antHasta).reduce((s, f) => s + centimos(f.total), 0);
const rec = calcularRecurrentes(periodo);

// Última ejecución del asesor (puede no haber)
let recs = null;
// Con cliente_id, la última recomendación de ese cliente; sin él, la última de cualquiera (igual que GET /recomendaciones).
const filaRec = $('Leer última recomendación').all().map((i) => i.json)
  .filter((f) => f && f.id !== undefined && f.id !== null && (p.cliente_id === null || p.cliente_id === undefined || f.cliente_id === p.cliente_id))
  .sort((a, b) => b.id - a.id)[0];
if (filaRec) { try { recs = JSON.parse(filaRec.json); } catch (e) { recs = null; } }

// ---- Estilos ----
const COLOR_CAB = 'FF0F4C5C';
const COLOR_ALT = 'FFEEF5F7';
const COLOR_TOT = 'FFD9E7EB';
const EUR = '#,##0.00 "€"';
const FECHA = 'dd/mm/yyyy';
const PCT = '0.00%';
const BORDE = { style: 'thin', color: { argb: 'FFB7C9CF' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
const estiloCabecera = (cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CAB } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = BORDES;
};
const estiloFila = (ws, fila, desdeCol, hastaCol, alterna) => {
  for (let c = desdeCol; c <= hastaCol; c += 1) {
    const cell = ws.getRow(fila).getCell(c);
    cell.border = BORDES;
    if (alterna) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ALT } };
  }
};
const estiloTotal = (ws, fila, desdeCol, hastaCol) => {
  for (let c = desdeCol; c <= hastaCol; c += 1) {
    const cell = ws.getRow(fila).getCell(c);
    cell.border = { ...BORDES, top: { style: 'medium', color: { argb: COLOR_CAB } } };
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOT } };
  }
};
const colLetra = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// Ancho = max(contenido mostrado + 2, 12, cabecera + 6), entre min y max (columnas con filtro: la flecha tapaba «Moneda»). La cabecera (negrita, centrada) cuenta
// un 10 % más y los 4 caracteres extra dejan sitio a la flecha del autofiltro/Tabla. Las filas de `omitir` (títulos combinados) no cuentan.
const ajustarAnchos = (ws, min = 8, max = 60, filasCab = [1], omitir = []) => {
  ws.columns.forEach((col) => {
    let ancho = min;
    col.eachCell({ includeEmpty: false }, (cell, fila) => {
      if (omitir.includes(fila)) return;
      if (filasCab.includes(fila)) {
        const t = cell.numFmt === 'mmm yyyy' ? 'ene 2026' : String(cell.value ?? '');
        ancho = Math.max(ancho, 12, t.length + 6, Math.ceil(t.length * 1.1) + 4);
        return;
      }
      const v = cell.value;
      let t;
      if (cell.numFmt === FECHA || cell.numFmt === 'mmm yyyy') t = '00/00/0000';
      else if (v && typeof v === 'object' && 'formula' in v) t = typeof v.result === 'number' ? v.result.toFixed(2) + ' €    ' : String(v.result ?? '');
      else if (typeof v === 'number') t = v.toFixed(2) + ' €  ';
      else t = String(v ?? '');
      const largo = Math.max(...t.split('\n').map((x) => x.length));
      if (!(cell.alignment && cell.alignment.wrapText && largo > max)) ancho = Math.max(ancho, largo + 2);
    });
    col.width = Math.min(max, ancho);
  });
};
// Impresión: A4 horizontal, 1 página de ancho (alto libre), márgenes estrechos, títulos repetidos y
// área de impresión = rango usado. ExcelJS antepone '$' a cada extremo, así que se le pasa «A$1:Q$16»
// para que el nombre definido quede absoluto ($A$1:$Q$16).
const configurarImpresion = (ws, filasTitulo = '1:1') => {
  const ps = ws.pageSetup;
  ps.paperSize = 9;
  ps.orientation = 'landscape';
  ps.fitToPage = true;
  ps.fitToWidth = 1;
  ps.fitToHeight = 0;
  ps.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  ps.printTitlesRow = filasTitulo;
  ps.printArea = `A$1:${colLetra(Math.max(1, ws.columnCount))}$${Math.max(1, ws.rowCount)}`;
};

const wb = new ExcelJS.Workbook();
wb.creator = 'FACT — Exportar Excel';
wb.calcProperties = { fullCalcOnLoad: true };
const wsRes = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: COLOR_CAB } } });
const wsFac = wb.addWorksheet('Facturas');
const wsMes = wb.addWorksheet('Por mes');
const wsSus = wb.addWorksheet('Suscripciones y contratos');
const wsRec = wb.addWorksheet('Recomendaciones');
const wsLib = wb.addWorksheet('Libro registro');
const wsIva = wb.addWorksheet('IVA trimestre');
const wsRet = wb.addWorksheet('Retenciones');
const ws347 = wb.addWorksheet('347');
const wsAsi = wb.addWorksheet('Asientos');
const wsPen = wb.addWorksheet('Pendientes de pago');

// ================= Hoja Facturas (Tabla de Excel con filtros y fila de totales) =================
const COLS = [
  { name: 'Fecha emisión', k: (f) => aSerial(f.fecha_emision), fmt: FECHA },
  { name: 'Vencimiento', k: (f) => aSerial(f.fecha_vencimiento), fmt: FECHA },
  { name: 'Proveedor', k: (f) => f.proveedor || null },
  { name: 'NIF', k: (f) => f.nif || null },
  { name: 'Nº factura', k: (f) => f.numero || null },
  { name: 'Categoría', k: (f) => f.categoria || 'Otros' },
  { name: 'Subcategoría', k: (f) => f.subcategoria || null },
  { name: 'Tipo', k: (f) => txtTipo(f.tipo_gasto) },
  { name: 'Periodicidad', k: (f) => mayuscula(f.periodicidad) },
  { name: 'Base', k: (f) => (typeof f.base === 'number' ? f.base : null), fmt: EUR, total: true },
  { name: 'IVA %', k: (f) => (typeof f.iva_tipo === 'number' ? f.iva_tipo : null) },
  { name: 'Cuota IVA', k: (f) => (typeof f.iva_cuota === 'number' ? f.iva_cuota : null), fmt: EUR, total: true },
  { name: 'Total', k: (f) => eur(centimos(f.total)), fmt: EUR, total: true },
  { name: 'Moneda', k: (f) => f.moneda || null },
  { name: 'Método de pago', k: (f) => mayuscula(f.metodo_pago) },
  { name: 'Estado', k: (f) => txtEstado(f.estado) },
  { name: 'Confianza', k: (f) => (typeof f.confianza === 'number' ? f.confianza : null), fmt: '0.00' },
  // Modo gestoría (tanda B): importes en EUR
  { name: 'Cliente', k: (f) => nombreCliente(f.cliente_id) },
  { name: 'Tipo factura', k: (f) => FX_TXT_TIPO[f.tipo_factura] || mayuscula(f.tipo_factura) },
  { name: 'Operación', k: (f) => FX_TXT_OPERACION[f.operacion] || mayuscula(f.operacion) },
  { name: 'Retención', k: (f) => (typeof f.irpf_cuota === 'number' ? f.irpf_cuota : null), fmt: EUR, total: true },
  { name: 'Total a pagar', k: (f) => (typeof f.total_a_pagar === 'number' ? f.total_a_pagar : null), fmt: EUR, total: true },
  { name: 'Deducible', k: (f) => TXT_DEDUCIBLE[f.deducible] || mayuscula(f.deducible) },
  { name: 'Cuenta', k: (f) => f.cuenta_gasto || null },
  { name: 'Estado de pago', k: (f) => (f.estado_pago === 'pagada' ? 'Pagada' : f.estado_pago ? 'Pendiente' : null) },
];
const filasFac = periodo.length ? periodo.map((f) => COLS.map((c) => c.k(f))) : [COLS.map((c, i) => (i === 2 ? '(sin facturas en el periodo)' : null))];
const nFac = filasFac.length;
const F1 = 2;
const FN = nFac + 1; // última fila de datos
const sumaCol = (i) => Math.round(periodo.reduce((s, f) => s + Math.round((COLS[i].k(f) || 0) * 100), 0)) / 100;
wsFac.addTable({
  name: 'TablaFacturas',
  ref: 'A1',
  headerRow: true,
  totalsRow: true,
  style: { theme: 'TableStyleLight1', showRowStripes: false },
  columns: COLS.map((c, i) => (i === 0 ? { name: c.name, filterButton: true, totalsRowLabel: 'Total' }
    : c.total ? { name: c.name, filterButton: true, totalsRowFunction: 'sum', totalsRowResult: sumaCol(i) }
      : { name: c.name, filterButton: true })),
  rows: filasFac,
});
COLS.forEach((c, i) => {
  estiloCabecera(wsFac.getRow(1).getCell(i + 1));
  if (c.fmt) for (let r = F1; r <= FN + 1; r += 1) wsFac.getRow(r).getCell(i + 1).numFmt = c.fmt;
});
for (let r = F1; r <= FN; r += 1) estiloFila(wsFac, r, 1, COLS.length, (r - F1) % 2 === 1);
estiloTotal(wsFac, FN + 1, 1, COLS.length);
wsFac.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsFac, 10, 45);
configurarImpresion(wsFac);
const rango = (col) => `Facturas!$${col}$${F1}:$${col}$${FN}`;
const R_FECHA = rango('A');
const R_CAT = rango('F');
const R_TOTAL = rango('M');

// ================= Hoja Suscripciones y contratos =================
const susCab = ['Proveedor', 'Categoría', 'Tipo', 'Periodicidad', 'Última factura', 'Último importe', 'Periodos/año', 'Coste mensual', 'Coste anual'];
ponerFila(wsSus, 1, susCab);
susCab.forEach((_, i) => estiloCabecera(wsSus.getRow(1).getCell(i + 1)));
const susItems = [...rec.items].sort((a, b) => (b.mensualC ?? -1) - (a.mensualC ?? -1) || String(a.factura.proveedor).localeCompare(String(b.factura.proveedor)));
susItems.forEach((it, idx) => {
  const r = idx + 2;
  const f = it.factura;
  ponerFila(wsSus, r, [f.proveedor, f.categoria, txtTipo(f.tipo_gasto), mayuscula(f.periodicidad), aSerial(f.fecha_emision), eur(it.importeC), it.veces]);
  if (it.veces) {
    wsSus.getCell(`H${r}`).value = { formula: `ROUND(F${r}*G${r}/12,2)`, result: eur(it.mensualC) };
    wsSus.getCell(`I${r}`).value = { formula: `F${r}*G${r}`, result: eur(it.anualC) };
  }
  estiloFila(wsSus, r, 1, 9, idx % 2 === 1);
  wsSus.getCell(`E${r}`).numFmt = FECHA;
  ['F', 'H', 'I'].forEach((c) => { wsSus.getCell(`${c}${r}`).numFmt = EUR; });
});
const sN = susItems.length + 1; // última fila de datos (1 si no hay)
const sTot = sN + 1;
wsSus.getCell(`A${sTot}`).value = 'Total';
wsSus.getCell(`H${sTot}`).value = { formula: susItems.length ? `SUM(H2:H${sN})` : '0', result: eur(rec.mensualC) };
wsSus.getCell(`I${sTot}`).value = { formula: susItems.length ? `SUM(I2:I${sN})` : '0', result: eur(rec.anualC) };
estiloTotal(wsSus, sTot, 1, 9);
['H', 'I'].forEach((c) => { wsSus.getCell(`${c}${sTot}`).numFmt = EUR; });
if (susItems.length) {
  wsSus.autoFilter = `A1:I${sN}`;
  wsSus.addConditionalFormatting({ ref: `I2:I${sN}`, rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF2A9D8F' }, gradient: true }] });
}
wsSus.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsSus, 10, 45);
configurarImpresion(wsSus);

// ================= Hoja Por mes (categoría × mes con SUMIFS) =================
const meses = [];
for (let k = desde.slice(0, 7); ; ) {
  meses.push(k);
  if (k >= hasta.slice(0, 7)) break;
  let y = Number(k.slice(0, 4));
  let m = Number(k.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  k = y + '-' + String(m).padStart(2, '0');
}
const porCatMes = {};
for (const f of periodo) {
  const c = f.categoria || 'Otros';
  porCatMes[c] = porCatMes[c] || { total: 0 };
  porCatMes[c][f.fecha_emision.slice(0, 7)] = (porCatMes[c][f.fecha_emision.slice(0, 7)] || 0) + centimos(f.total);
  porCatMes[c].total += centimos(f.total);
}
const categorias = Object.keys(porCatMes).sort((a, b) => porCatMes[b].total - porCatMes[a].total || a.localeCompare(b));
const nM = meses.length;
const cTot = nM + 2; // columna del total por fila
const L = (n) => colLetra(n);
wsMes.getRow(1).getCell(1).value = 'Categoría';
meses.forEach((k, i) => { const cell = wsMes.getRow(1).getCell(i + 2); cell.value = Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1) / DIA + 25569; cell.numFmt = 'mmm yyyy'; });
wsMes.getRow(1).getCell(cTot).value = 'Total';
for (let c = 1; c <= cTot; c += 1) estiloCabecera(wsMes.getRow(1).getCell(c));
categorias.forEach((cat, idx) => {
  const r = idx + 2;
  wsMes.getRow(r).getCell(1).value = cat;
  meses.forEach((k, i) => {
    const col = L(i + 2);
    wsMes.getRow(r).getCell(i + 2).value = {
      formula: `SUMIFS(${R_TOTAL},${R_CAT},$A${r},${R_FECHA},">="&${col}$1,${R_FECHA},"<="&EOMONTH(${col}$1,0))`,
      result: eur(porCatMes[cat][k] || 0),
    };
  });
  wsMes.getRow(r).getCell(cTot).value = { formula: `SUM(B${r}:${L(nM + 1)}${r})`, result: eur(porCatMes[cat].total) };
  estiloFila(wsMes, r, 1, cTot, idx % 2 === 1);
  for (let c = 2; c <= cTot; c += 1) wsMes.getRow(r).getCell(c).numFmt = EUR;
});
const mN = categorias.length + 1;
const mTot = mN + 1;
wsMes.getRow(mTot).getCell(1).value = 'Total';
for (let c = 2; c <= cTot; c += 1) {
  const res = c === cTot ? totalC : periodo.filter((f) => f.fecha_emision.slice(0, 7) === meses[c - 2]).reduce((s, f) => s + centimos(f.total), 0);
  wsMes.getRow(mTot).getCell(c).value = { formula: categorias.length ? `SUM(${L(c)}2:${L(c)}${mN})` : '0', result: eur(res) };
  wsMes.getRow(mTot).getCell(c).numFmt = EUR;
}
estiloTotal(wsMes, mTot, 1, cTot);
if (categorias.length) {
  wsMes.autoFilter = `A1:${L(cTot)}${mN}`;
  wsMes.addConditionalFormatting({ ref: `B2:${L(nM + 1)}${mN}`, rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FFFFE699' }, { argb: 'FFF4A261' }] }] });
}
wsMes.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2', activeCell: 'B2' }];
ajustarAnchos(wsMes, 12, 45);
configurarImpresion(wsMes);

// ================= Hoja Recomendaciones =================
const recCab = ['Título', 'Texto', 'Dato', 'Ahorro mensual', 'Ahorro anual'];
ponerFila(wsRec, 1, recCab);
recCab.forEach((_, i) => estiloCabecera(wsRec.getRow(1).getCell(i + 1)));
const lista = recs && Array.isArray(recs.recomendaciones) ? recs.recomendaciones : [];
lista.forEach((x, idx) => {
  const r = idx + 2;
  ponerFila(wsRec, r, [x.titulo, x.texto, x.dato, Number(x.ahorro_mensual) || 0, Number(x.ahorro_anual) || 0]);
  estiloFila(wsRec, r, 1, 5, idx % 2 === 1);
  ['A', 'B', 'C'].forEach((c) => { wsRec.getCell(`${c}${r}`).alignment = { wrapText: true, vertical: 'top' }; });
  ['D', 'E'].forEach((c) => { wsRec.getCell(`${c}${r}`).numFmt = EUR; wsRec.getCell(`${c}${r}`).alignment = { vertical: 'top' }; });
});
const rN = lista.length + 1;
const rTot = rN + 1;
const sumaAh = (k) => eur(lista.reduce((s, x) => s + Math.round((Number(x[k]) || 0) * 100), 0));
wsRec.getCell(`A${rTot}`).value = 'Total ahorro potencial';
wsRec.getCell(`D${rTot}`).value = { formula: lista.length ? `SUM(D2:D${rN})` : '0', result: sumaAh('ahorro_mensual') };
wsRec.getCell(`E${rTot}`).value = { formula: lista.length ? `SUM(E2:E${rN})` : '0', result: sumaAh('ahorro_anual') };
['D', 'E'].forEach((c) => { wsRec.getCell(`${c}${rTot}`).numFmt = EUR; });
estiloTotal(wsRec, rTot, 1, 5);
wsRec.getCell(`A${rTot + 2}`).value = recs
  ? `Última ejecución del asesor: ${String(recs.generado || '').slice(0, 16).replace('T', ' ')} (periodo ${fmtFecha(recs.desde)} – ${fmtFecha(recs.hasta)}). Las cifras salen de cálculos propios; el texto lo redacta Gemini o una plantilla.`
  : 'Todavía no hay recomendaciones guardadas: lanza POST /asesor.';
wsRec.getCell(`A${rTot + 2}`).font = { italic: true, color: { argb: 'FF555555' } };
wsRec.autoFilter = `A1:E${rN}`;
wsRec.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
[42, 70, 70, 16, 16].forEach((w, i) => { wsRec.getColumn(i + 1).width = Math.max(w, 12, String(recCab[i]).length + 6); });
configurarImpresion(wsRec);

// ================= Hoja Resumen =================
wsRes.mergeCells('A1:D1');
wsRes.getCell('A1').value = 'Resumen de gastos';
wsRes.getCell('A1').font = { bold: true, size: 16, color: { argb: COLOR_CAB } };
wsRes.mergeCells('A2:D2');
wsRes.getCell('A2').value = `Periodo: ${fmtFecha(desde)} – ${fmtFecha(hasta)} · generado el ${fmtFecha(hoy)}. Excluye facturas borradas y duplicadas.`;
wsRes.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };
ponerFila(wsRes, 4, ['Indicador', 'Valor']);
['A4', 'B4'].forEach((a) => estiloCabecera(wsRes.getCell(a)));
const kpis = [
  ['Total gastado', { formula: `SUM(${R_TOTAL})`, result: eur(totalC) }, EUR],
  ['Nº de facturas', { formula: `COUNT(${R_FECHA})`, result: periodo.length }, '0'],
  ['Recurrente mensual', { formula: `'Suscripciones y contratos'!H${sTot}`, result: eur(rec.mensualC) }, EUR],
  ['Recurrente anual', { formula: `'Suscripciones y contratos'!I${sTot}`, result: eur(rec.anualC) }, EUR],
  [`Periodo anterior (${fmtFecha(antDesde)} – ${fmtFecha(antHasta)})`, eur(antC), EUR],
  ['Diferencia con el periodo anterior', { formula: 'B5-B9', result: eur(totalC - antC) }, EUR],
  ['Variación con el periodo anterior', { formula: 'IF(B9=0,"",B10/B9)', result: antC ? (totalC - antC) / antC : '' }, PCT],
];
kpis.forEach(([k, v, fmt], i) => {
  const r = 5 + i;
  wsRes.getCell(`A${r}`).value = k;
  wsRes.getCell(`B${r}`).value = v;
  wsRes.getCell(`B${r}`).numFmt = fmt;
  estiloFila(wsRes, r, 1, 2, i % 2 === 1);
});
const CAB_CAT = 13;
ponerFila(wsRes, CAB_CAT, ['Categoría', 'Importe', 'Nº facturas', '% del total']);
['A', 'B', 'C', 'D'].forEach((c) => estiloCabecera(wsRes.getCell(`${c}${CAB_CAT}`)));
const totCat = CAB_CAT + categorias.length + 1;
categorias.forEach((cat, idx) => {
  const r = CAB_CAT + 1 + idx;
  wsRes.getCell(`A${r}`).value = cat;
  wsRes.getCell(`B${r}`).value = { formula: `SUMIFS(${R_TOTAL},${R_CAT},A${r})`, result: eur(porCatMes[cat].total) };
  wsRes.getCell(`C${r}`).value = { formula: `COUNTIFS(${R_CAT},A${r})`, result: periodo.filter((f) => (f.categoria || 'Otros') === cat).length };
  wsRes.getCell(`D${r}`).value = { formula: `IF($B$${totCat}=0,0,B${r}/$B$${totCat})`, result: totalC ? porCatMes[cat].total / totalC : 0 };
  wsRes.getCell(`B${r}`).numFmt = EUR;
  wsRes.getCell(`D${r}`).numFmt = PCT;
  estiloFila(wsRes, r, 1, 4, idx % 2 === 1);
});
const ultCat = CAB_CAT + categorias.length;
wsRes.getCell(`A${totCat}`).value = 'Total';
wsRes.getCell(`B${totCat}`).value = { formula: categorias.length ? `SUM(B${CAB_CAT + 1}:B${ultCat})` : '0', result: eur(totalC) };
wsRes.getCell(`C${totCat}`).value = { formula: categorias.length ? `SUM(C${CAB_CAT + 1}:C${ultCat})` : '0', result: periodo.length };
wsRes.getCell(`D${totCat}`).value = { formula: categorias.length ? `SUM(D${CAB_CAT + 1}:D${ultCat})` : '0', result: totalC ? 1 : 0 };
wsRes.getCell(`B${totCat}`).numFmt = EUR;
wsRes.getCell(`D${totCat}`).numFmt = PCT;
estiloTotal(wsRes, totCat, 1, 4);
if (categorias.length) {
  wsRes.autoFilter = `A${CAB_CAT}:D${ultCat}`;
  wsRes.addConditionalFormatting({ ref: `B${CAB_CAT + 1}:B${ultCat}`, rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF2A9D8F' }, gradient: true }] });
}
wsRes.views = [{ state: 'frozen', ySplit: 2, xSplit: 0, topLeftCell: 'A3', activeCell: 'A3' }];
ajustarAnchos(wsRes, 12, 60, [4, CAB_CAT], [1, 2]);
wsRes.getColumn(1).width = Math.max(wsRes.getColumn(1).width, 46);
configurarImpresion(wsRes, '1:2');

/*@@EXCEL_FISCAL@@*/

const buffer = Buffer.from(await wb.xlsx.writeBuffer());
const nombre = `Gastos_${hoy}.xlsx`;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const binario = await this.helpers.prepareBinaryData(buffer, nombre, MIME);
return [{ json: { nombre, mime: MIME, bytes: buffer.length, desde, hasta, num_facturas: periodo.length, total: eur(totalC) }, binary: { data: binario } }];
