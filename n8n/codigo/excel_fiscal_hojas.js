// ================= Modo gestoría (tanda B): hojas fiscales =================
// Datos: facturas ok/revisar/posible_duplicada del periodo (y del cliente si se pide), en EUR con el bloque COMÚN
// Fiscal. Las facturas en otra moneda sin tipo de cambio no entran (igual que en /fiscal).
const fxValidas = crudas.filter((f) => FX_VALIDOS.includes(f.estado) && fxFecha(f.fecha_emision));
const fxPrep = fxValidas.filter((f) => f.fecha_emision >= desde && f.fecha_emision <= hasta).map((f) => fxPreparar(f, clientesPorId[f.cliente_id]))
  .filter((x) => !x.sinCambio);
const cabeceraHoja = (ws, fila, textos) => { textos.forEach((t, i) => { const c = ws.getRow(fila).getCell(i + 1); c.value = t; estiloCabecera(c); }); };
const fechaCelda = (ws, ref, s) => { const v = aSerial(s); if (v !== null) { ws.getCell(ref).value = v; ws.getCell(ref).numFmt = FECHA; } };

// ---- Libro registro (una fila por tipo de IVA) ----
const LR_CAB = ['Nº recepción', 'Fecha expedición', 'Fecha operación', 'Número', 'NIF', 'Nombre', 'Tipo de factura', 'Operación', 'Base imponible', 'Tipo IVA',
  'Cuota IVA', 'Tipo recargo', 'Cuota recargo', 'Cuota autorrepercutida', 'Cuota deducible', 'Total', 'Cliente'];
cabeceraHoja(wsLib, 1, LR_CAB);
const lrFilas = fxFilasLibro(fxPrep).sort((a, b) => String(nombreCliente(a.cliente_id) || '').localeCompare(String(nombreCliente(b.cliente_id) || ''))
  || (a.fecha_expedicion < b.fecha_expedicion ? -1 : a.fecha_expedicion > b.fecha_expedicion ? 1 : String(a.num_recepcion || '').localeCompare(String(b.num_recepcion || '')) || a.id - b.id));
lrFilas.forEach((f, i) => {
  const r = i + 2;
  ponerFila(wsLib, r, [f.num_recepcion, null, null, f.numero, f.nif, f.nombre, FX_TXT_TIPO[f.tipo_factura] || f.tipo_factura, FX_TXT_OPERACION[f.operacion] || f.operacion,
    fxEuros(f.baseC), f.tipo_iva, fxEuros(f.cuotaC), f.tipo_re, fxEuros(f.reC), fxEuros(f.autoC), fxEuros(f.dedC), fxEuros(f.totalC), nombreCliente(f.cliente_id)]);
  fechaCelda(wsLib, `B${r}`, f.fecha_expedicion);
  fechaCelda(wsLib, `C${r}`, f.fecha_operacion);
  ['I', 'K', 'M', 'N', 'O', 'P'].forEach((c) => { wsLib.getCell(`${c}${r}`).numFmt = EUR; });
  estiloFila(wsLib, r, 1, LR_CAB.length, i % 2 === 1);
});
const lrN = lrFilas.length + 1;
const lrTot = lrN + 1;
wsLib.getCell(`A${lrTot}`).value = 'Total';
['I', 'K', 'M', 'N', 'O', 'P'].forEach((c) => {
  const campo = { I: 'baseC', K: 'cuotaC', M: 'reC', N: 'autoC', O: 'dedC', P: 'totalC' }[c];
  wsLib.getCell(`${c}${lrTot}`).value = { formula: lrFilas.length ? `SUM(${c}2:${c}${lrN})` : '0', result: fxEuros(lrFilas.reduce((s, f) => s + f[campo], 0)) };
  wsLib.getCell(`${c}${lrTot}`).numFmt = EUR;
});
estiloTotal(wsLib, lrTot, 1, LR_CAB.length);
wsLib.autoFilter = `A1:${colLetra(LR_CAB.length)}${lrN}`;
wsLib.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsLib, 10, 45);
configurarImpresion(wsLib);
const LR = (col) => `'Libro registro'!$${col}$2:$${col}$${Math.max(2, lrN)}`;

// ---- IVA trimestre (303 por tipo con SUMIFS sobre «Libro registro») ----
const trimestres = [];
for (let y = Number(desde.slice(0, 4)), t = fxTrimestreDe(desde); ; ) {
  trimestres.push({ anio: y, t, ...fxPeriodo(y, t) });
  if (y > Number(hasta.slice(0, 4)) || (y === Number(hasta.slice(0, 4)) && t >= fxTrimestreDe(hasta))) break;
  t += 1; if (t > 4) { t = 1; y += 1; }
}
const IVA_CAB = ['Concepto', 'Tipo', 'Base', 'Cuota', 'Cuota deducible', 'Casillas 303 (referencia)'];
cabeceraHoja(wsIva, 1, IVA_CAB);
let ri = 2;
const enTrim = (q) => lrFilas.filter((f) => f.fecha_expedicion >= q.desde && f.fecha_expedicion <= q.hasta);
const sumC = (xs, k) => fxEuros(xs.reduce((s, f) => s + f[k], 0));
const crit = (ri0) => `${LR('B')},">="&$B$${ri0},${LR('B')},"<="&$C$${ri0}`;
for (const q of trimestres) {
  const xs = enTrim(q);
  const filaT = ri;
  wsIva.getCell(`A${ri}`).value = `${q.t}T ${q.anio}`;
  wsIva.getCell(`A${ri}`).font = { bold: true, color: { argb: COLOR_CAB } };
  fechaCelda(wsIva, `B${ri}`, q.desde);
  fechaCelda(wsIva, `C${ri}`, q.hasta);
  wsIva.getCell(`D${ri}`).value = 'desde / hasta (fecha de expedición)';
  wsIva.getCell(`D${ri}`).font = { italic: true, color: { argb: 'FF555555' } };
  ri += 1;
  const primera = ri;
  const tipos = [...new Set(xs.filter((f) => f.operacion === 'interior' && f.tipo_iva > 0).map((f) => f.tipo_iva))].sort((a, b) => b - a);
  const filaSum = (concepto, tipo, cols, casillas, alterna) => {
    wsIva.getCell(`A${ri}`).value = concepto;
    if (tipo !== null) wsIva.getCell(`B${ri}`).value = tipo;
    ['C', 'D', 'E'].forEach((c, i) => { wsIva.getCell(`${c}${ri}`).value = cols[i]; wsIva.getCell(`${c}${ri}`).numFmt = EUR; });
    wsIva.getCell(`F${ri}`).value = casillas;
    estiloFila(wsIva, ri, 1, IVA_CAB.length, alterna);
    ri += 1;
  };
  let n = 0;
  for (const tipo of tipos) {
    const ys = xs.filter((f) => f.operacion === 'interior' && f.tipo_iva === tipo);
    const c = (col, k) => ({ formula: `SUMIFS(${LR(col)},${crit(filaT)},${LR('J')},$B${ri},${LR('H')},"Interior")`, result: sumC(ys, k) });
    filaSum(`IVA soportado interior ${String(tipo).replace('.', ',')} %`, tipo, [c('I', 'baseC'), c('K', 'cuotaC'), c('O', 'dedC')], '28-29', n++ % 2 === 1);
  }
  const op = (nombres, col, k) => {
    const ys = xs.filter((f) => nombres.includes(f.operacion));
    return { formula: nombres.map((o) => `SUMIFS(${LR(col)},${crit(filaT)},${LR('H')},"${FX_TXT_OPERACION[o]}")`).join('+'), result: sumC(ys, k) };
  };
  filaSum('Adquisiciones intracomunitarias (autorrepercusión)', null, [op(['intracomunitaria'], 'I', 'baseC'), op(['intracomunitaria'], 'N', 'autoC'), op(['intracomunitaria'], 'O', 'dedC')], '10-11 / 36-37', n++ % 2 === 1);
  filaSum('Inversión del sujeto pasivo (ISP y servicios extracomunitarios)', null, [op(['isp_nacional', 'extracomunitaria'], 'I', 'baseC'), op(['isp_nacional', 'extracomunitaria'], 'N', 'autoC'), op(['isp_nacional', 'extracomunitaria'], 'O', 'dedC')], '12-13 / 28-29', n++ % 2 === 1);
  const ultima = ri - 1;
  wsIva.getCell(`A${ri}`).value = `Total deducible ${q.t}T ${q.anio}`;
  wsIva.getCell(`E${ri}`).value = { formula: `SUM(E${primera}:E${ultima})`, result: sumC(xs.filter((f) => f.operacion === 'interior' ? f.tipo_iva > 0 : ['intracomunitaria', 'isp_nacional', 'extracomunitaria'].includes(f.operacion)), 'dedC') };
  wsIva.getCell(`E${ri}`).numFmt = EUR;
  estiloTotal(wsIva, ri, 1, IVA_CAB.length);
  ri += 1;
  const tiposRe = [...new Set(xs.filter((f) => f.reC !== 0).map((f) => f.tipo_re))].sort((a, b) => b - a);
  for (const tre of tiposRe) {
    const ys = xs.filter((f) => f.reC !== 0 && f.tipo_re === tre);
    wsIva.getCell(`A${ri}`).value = `Recargo de equivalencia ${String(tre).replace('.', ',')} % (informativo, no deducible)`;
    wsIva.getCell(`B${ri}`).value = tre;
    wsIva.getCell(`C${ri}`).value = { formula: `SUMIFS(${LR('I')},${crit(filaT)},${LR('L')},$B${ri})`, result: sumC(ys, 'baseC') };
    wsIva.getCell(`D${ri}`).value = { formula: `SUMIFS(${LR('M')},${crit(filaT)},${LR('L')},$B${ri})`, result: sumC(ys, 'reC') };
    ['C', 'D'].forEach((c) => { wsIva.getCell(`${c}${ri}`).numFmt = EUR; });
    wsIva.getCell(`A${ri}`).font = { italic: true };
    ri += 1;
  }
  ri += 1;
}
wsIva.getCell(`A${ri}`).value = (p.cliente_id === null || p.cliente_id === undefined)
  ? 'Libro con todos los clientes: el 303 es por cliente; exporta con cliente_id para presentar. Casillas solo de referencia (para revisar).'
  : 'Casillas del modelo 303 solo de referencia (para revisar): el contable presenta con su programa.';
wsIva.getCell(`A${ri}`).font = { italic: true, color: { argb: 'FF555555' } };
wsIva.autoFilter = 'A1:F1';
wsIva.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsIva, 12, 60, [1], [ri]);
configurarImpresion(wsIva);

// ---- Retenciones (111 profesionales / 115 alquileres) ----
const RET_CAB = ['Fecha', 'Proveedor', 'NIF', 'Nº factura', 'Modelo', 'Base', 'Tipo %', 'Retención', 'Cliente'];
cabeceraHoja(wsRet, 1, RET_CAB);
const retFilas = fxPrep.filter((x) => x.irpfC !== 0).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
retFilas.forEach((x, i) => {
  const r = i + 2;
  ponerFila(wsRet, r, [null, x.nombre, x.nif, x.numero, Number(fxModeloRet(x)), fxEuros(x.lineas.reduce((s, l) => s + l.baseC, 0) + x.exentaC), x.irpfTipo, fxEuros(x.irpfC), nombreCliente(x.cliente_id)]);
  fechaCelda(wsRet, `A${r}`, x.fecha);
  ['F', 'H'].forEach((c) => { wsRet.getCell(`${c}${r}`).numFmt = EUR; });
  estiloFila(wsRet, r, 1, RET_CAB.length, i % 2 === 1);
});
const rtN = retFilas.length + 1;
const rtTot = rtN + 1;
wsRet.getCell(`A${rtTot}`).value = 'Total';
['F', 'H'].forEach((c) => {
  wsRet.getCell(`${c}${rtTot}`).value = { formula: retFilas.length ? `SUM(${c}2:${c}${rtN})` : '0',
    result: fxEuros(retFilas.reduce((s, x) => s + (c === 'F' ? x.lineas.reduce((a, l) => a + l.baseC, 0) + x.exentaC : x.irpfC), 0)) };
  wsRet.getCell(`${c}${rtTot}`).numFmt = EUR;
});
estiloTotal(wsRet, rtTot, 1, RET_CAB.length);
const rtRes = rtTot + 2;
cabeceraHoja(wsRet, rtRes, ['Trimestre', 'Desde', 'Hasta', 'Modelo', 'Nº perceptores', 'Base', 'Retención']);
const RR = (col) => `$${col}$2:$${col}$${Math.max(2, rtN)}`;
let rr = rtRes + 1;
for (const q of trimestres) {
  for (const modelo of ['111', '115']) {
    const ys = retFilas.filter((x) => x.fecha >= q.desde && x.fecha <= q.hasta && fxModeloRet(x) === modelo);
    wsRet.getCell(`A${rr}`).value = `${q.t}T ${q.anio}`;
    fechaCelda(wsRet, `B${rr}`, q.desde);
    fechaCelda(wsRet, `C${rr}`, q.hasta);
    wsRet.getCell(`D${rr}`).value = Number(modelo);
    wsRet.getCell(`E${rr}`).value = new Set(ys.map((x) => `${x.cliente_id}|${x.nif || x.nombre}`)).size;
    const cr = `${RR('A')},">="&$B${rr},${RR('A')},"<="&$C${rr},${RR('E')},$D${rr}`;
    wsRet.getCell(`F${rr}`).value = { formula: `SUMIFS(${RR('F')},${cr})`, result: fxEuros(ys.reduce((s, x) => s + x.lineas.reduce((a, l) => a + l.baseC, 0) + x.exentaC, 0)) };
    wsRet.getCell(`G${rr}`).value = { formula: `SUMIFS(${RR('H')},${cr})`, result: fxEuros(ys.reduce((s, x) => s + x.irpfC, 0)) };
    ['F', 'G'].forEach((c) => { wsRet.getCell(`${c}${rr}`).numFmt = EUR; });
    estiloFila(wsRet, rr, 1, 7, (rr - rtRes) % 2 === 0);
    rr += 1;
  }
}
wsRet.autoFilter = `A1:${colLetra(RET_CAB.length)}${rtN}`;
wsRet.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsRet, 12, 45, [1, rtRes]);
configurarImpresion(wsRet);

// ---- 347 (año de «hasta»; por cliente declarante) ----
const anio347 = Number(hasta.slice(0, 4));
const C347_CAB = ['NIF', 'Nombre', '1T', '2T', '3T', '4T', 'Total anual', 'Cliente'];
cabeceraHoja(ws347, 1, C347_CAB);
const ids347 = [...new Set(fxValidas.map((f) => f.cliente_id))].filter((id) => id !== null && id !== undefined).sort((a, b) => a - b);
const filas347 = [];
for (const id of ids347) {
  const cli = clientesPorId[id];
  const prepAnio = fxValidas.filter((f) => f.cliente_id === id && f.fecha_emision.slice(0, 4) === String(anio347)).map((f) => fxPreparar(f, cli));
  for (const g of fxCalcularFiscal(prepAnio, cli, anio347, null).modelo_347_anual) filas347.push({ ...g, cliente: nombreCliente(id) });
}
filas347.forEach((g, i) => {
  const r = i + 2;
  ponerFila(ws347, r, [g.nif, g.nombre, ...g.por_trimestre, null, g.cliente]);
  ws347.getCell(`G${r}`).value = { formula: `SUM(C${r}:F${r})`, result: g.total_anual };
  ['C', 'D', 'E', 'F', 'G'].forEach((c) => { ws347.getCell(`${c}${r}`).numFmt = EUR; });
  estiloFila(ws347, r, 1, C347_CAB.length, i % 2 === 1);
});
const n347 = filas347.length + 1;
ws347.getCell(`A${n347 + 1}`).value = 'Total';
['C', 'D', 'E', 'F', 'G'].forEach((c, k) => {
  ws347.getCell(`${c}${n347 + 1}`).value = { formula: filas347.length ? `SUM(${c}2:${c}${n347})` : '0',
    result: fxEuros(filas347.reduce((s, g) => s + fxCent(k < 4 ? g.por_trimestre[k] : g.total_anual), 0)) };
  ws347.getCell(`${c}${n347 + 1}`).numFmt = EUR;
});
estiloTotal(ws347, n347 + 1, 1, C347_CAB.length);
ws347.getCell(`A${n347 + 3}`).value = `Modelo 347 de ${anio347} (año completo): proveedores con más de 3.005,06 € IVA incluido, por NIF, neto de rectificativas; sin operaciones con retención, intracomunitarias ni extranjeras.`;
ws347.getCell(`A${n347 + 3}`).font = { italic: true, color: { argb: 'FF555555' } };
ws347.autoFilter = `A1:H${n347}`;
ws347.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(ws347, 12, 45, [1], [n347 + 3]);
configurarImpresion(ws347);

// ---- Asientos ----
const AS_CAB = ['Asiento', 'Fecha', 'Cuenta', 'Concepto', 'Debe', 'Haber', 'Documento', 'NIF', 'Cliente'];
cabeceraHoja(wsAsi, 1, AS_CAB);
const asi = fxAsientos(fxPrep);
const cliAsiento = {};
for (const x of fxPrep) cliAsiento[x.id] = nombreCliente(x.cliente_id);
asi.lineas.forEach((l, i) => {
  const r = i + 2;
  ponerFila(wsAsi, r, [l.asiento, null, l.cuenta, l.concepto, fxEuros(l.debeC), fxEuros(l.haberC), l.documento, l.nif, cliAsiento[l.factura_id]]);
  fechaCelda(wsAsi, `B${r}`, l.fecha);
  ['E', 'F'].forEach((c) => { wsAsi.getCell(`${c}${r}`).numFmt = EUR; });
  estiloFila(wsAsi, r, 1, AS_CAB.length, l.asiento % 2 === 0);
});
const asN = asi.lineas.length + 1;
wsAsi.getCell(`A${asN + 1}`).value = 'Total';
['E', 'F'].forEach((c) => {
  wsAsi.getCell(`${c}${asN + 1}`).value = { formula: asi.lineas.length ? `SUM(${c}2:${c}${asN})` : '0', result: fxEuros(asi.lineas.reduce((s, l) => s + (c === 'E' ? l.debeC : l.haberC), 0)) };
  wsAsi.getCell(`${c}${asN + 1}`).numFmt = EUR;
});
estiloTotal(wsAsi, asN + 1, 1, AS_CAB.length);
if (asi.excluidas.length) {
  wsAsi.getCell(`A${asN + 3}`).value = `Facturas sin asiento porque sus importes no cuadran: ${asi.excluidas.map((x) => x.id).join(', ')}.`;
  wsAsi.getCell(`A${asN + 3}`).font = { italic: true, color: { argb: 'FF9C0006' } };
}
wsAsi.autoFilter = `A1:I${asN}`;
wsAsi.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsAsi, 10, 50, [1], [asN + 3]);
configurarImpresion(wsAsi);

// ---- Pendientes de pago (emitidas hasta «hasta», sin pagar; cualquier fecha de emisión) ----
const PEN_CAB = ['Proveedor', 'NIF', 'Nº factura', 'Fecha emisión', 'Vencimiento', 'Días vencida', 'Situación', 'Total a pagar', 'Cliente'];
cabeceraHoja(wsPen, 1, PEN_CAB);
const pend = fxValidas.filter((f) => f.fecha_emision <= hasta && f.estado_pago !== 'pagada').map((f) => fxPreparar(f, clientesPorId[f.cliente_id])).filter((x) => !x.sinCambio)
  .sort((a, b) => String(a.fecha_vencimiento || '9999').localeCompare(String(b.fecha_vencimiento || '9999')) || (a.fecha < b.fecha ? -1 : 1) || a.id - b.id);
pend.forEach((x, i) => {
  const r = i + 2;
  const dias = x.fecha_vencimiento && x.fecha_vencimiento < hoy ? Math.round((aMs(hoy) - aMs(x.fecha_vencimiento)) / DIA) : 0;
  ponerFila(wsPen, r, [x.nombre, x.nif, x.numero, null, null, dias, dias > 0 ? 'Vencida' : 'Pendiente', fxEuros(x.aPagarC), nombreCliente(x.cliente_id)]);
  fechaCelda(wsPen, `D${r}`, x.fecha);
  fechaCelda(wsPen, `E${r}`, x.fecha_vencimiento);
  wsPen.getCell(`H${r}`).numFmt = EUR;
  estiloFila(wsPen, r, 1, PEN_CAB.length, i % 2 === 1);
  if (dias > 0) wsPen.getCell(`G${r}`).font = { bold: true, color: { argb: 'FF9C0006' } };
});
const peN = pend.length + 1;
wsPen.getCell(`A${peN + 1}`).value = 'Total';
wsPen.getCell(`H${peN + 1}`).value = { formula: pend.length ? `SUM(H2:H${peN})` : '0', result: fxEuros(pend.reduce((s, x) => s + x.aPagarC, 0)) };
wsPen.getCell(`H${peN + 1}`).numFmt = EUR;
estiloTotal(wsPen, peN + 1, 1, PEN_CAB.length);
wsPen.autoFilter = `A1:I${peN}`;
wsPen.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }];
ajustarAnchos(wsPen, 12, 45);
configurarImpresion(wsPen);
