// FACT — Fiscal: /fiscal (JSON), /libro-registro (JSON o CSV) y /asientos (CSV genérico, A3 o Holded).
// Todas las cifras en Code (céntimos, EUR). Diseño: docs/diseno-gestoria.md §4.
/*@@COMUN_FISCAL@@*/

const p = $('Parámetros').first().json;
const clientes = $('Leer clientes').all().map((i) => i.json).filter((c) => c && c.id !== undefined && c.id !== null);
const cliente = clientes.find((c) => c.id === p.cliente_id);
if (!cliente) return [{ json: { fichero: false, status: 404, body: { error: `No existe el cliente ${p.cliente_id} (GET /clientes).` } } }];
const datosCliente = { id: cliente.id, nombre: cliente.nombre, nif: cliente.nif || null, regimen_iva: cliente.regimen_iva, prorrata_pct: cliente.prorrata_pct };
const facturas = $('Leer facturas').all().map((i) => i.json)
  .filter((f) => f && f.id !== undefined && f.id !== null && f.usuario_id === 'default' && f.cliente_id === p.cliente_id
    && FX_VALIDOS.includes(f.estado) && fxFecha(f.fecha_emision));

if (p.ruta === 'fiscal') {
  const prepAnio = facturas.filter((f) => f.fecha_emision.slice(0, 4) === String(p.anio)).map((f) => fxPreparar(f, cliente));
  const r = fxCalcularFiscal(prepAnio, cliente, p.anio, p.trimestre);
  return [{ json: { fichero: false, status: 200, body: { cliente: datosCliente, generado: p.generado, ...r } } }];
}

const prep = facturas.filter((f) => f.fecha_emision >= p.desde && f.fecha_emision <= p.hasta).map((f) => fxPreparar(f, cliente));
const sinCambio = prep.filter((x) => x.sinCambio).map((x) => x.id);
const validas = prep.filter((x) => !x.sinCambio);
const avisos = [];
if (sinCambio.length) avisos.push({ codigo: 'sin_tipo_cambio', mensaje: 'Facturas en otra moneda sin tipo de cambio: no se incluyen.', ids: sinCambio });
const revisar = validas.filter((x) => x.estado === 'revisar').map((x) => x.id);
if (revisar.length) avisos.push({ codigo: 'revisar', mensaje: 'Facturas en «revisar» incluidas: revísalas.', ids: revisar });
const slug = fxSlug(cliente.nombre);
const fichero = async (texto, nombre, estadoFormato, extra) => {
  const buffer = Buffer.from(texto, 'utf8');
  const binario = await this.helpers.prepareBinaryData(buffer, nombre, 'text/csv');
  return [{ json: { fichero: true, status: 200, nombre, mime: 'text/csv; charset=utf-8', bytes: buffer.length, formato_estado: estadoFormato,
    excluidas: (extra && extra.excluidas) || '', avisos: [...avisos.map((a) => a.codigo), ...((extra && extra.avisos) || [])].join(',') }, binary: { data: binario } }];
};

if (p.ruta === 'libro') {
  const filas = fxFilasLibro(validas).sort((a, b) => (a.fecha_expedicion < b.fecha_expedicion ? -1 : a.fecha_expedicion > b.fecha_expedicion ? 1
    : String(a.num_recepcion || '').localeCompare(String(b.num_recepcion || '')) || a.id - b.id));
  if (p.formato === 'json') {
    const suma = (k) => fxEuros(filas.reduce((s, f) => s + f[k], 0));
    return [{ json: { fichero: false, status: 200, body: {
      cliente: datosCliente, desde: p.desde, hasta: p.hasta,
      filas: filas.map((f) => ({ id: f.id, num_recepcion: f.num_recepcion, fecha_expedicion: f.fecha_expedicion, fecha_operacion: f.fecha_operacion, numero: f.numero, nif: f.nif, nombre: f.nombre,
        tipo_factura: f.tipo_factura, operacion: f.operacion, base: fxEuros(f.baseC), tipo_iva: f.tipo_iva, cuota_iva: fxEuros(f.cuotaC), tipo_re: f.tipo_re, cuota_re: fxEuros(f.reC),
        cuota_autorrepercutida: fxEuros(f.autoC), cuota_deducible: fxEuros(f.dedC), total: fxEuros(f.totalC) })),
      totales: { base: suma('baseC'), cuota_iva: suma('cuotaC'), cuota_re: suma('reC'), cuota_autorrepercutida: suma('autoC'), cuota_deducible: suma('dedC'), total: suma('totalC') },
      avisos } } }];
  }
  const cab = ['Nº recepción', 'Fecha expedición', 'Fecha operación', 'Número', 'NIF', 'Nombre', 'Tipo de factura', 'Operación', 'Base imponible', 'Tipo IVA', 'Cuota IVA',
    'Tipo recargo', 'Cuota recargo', 'Cuota autorrepercutida', 'Cuota deducible', 'Total'];
  const csv = fxCsv(cab, filas.map((f) => [f.num_recepcion, fxCsvFecha(f.fecha_expedicion), fxCsvFecha(f.fecha_operacion), f.numero, f.nif, f.nombre,
    FX_TXT_TIPO[f.tipo_factura] || f.tipo_factura, FX_TXT_OPERACION[f.operacion] || f.operacion, fxCsvImporte(f.baseC), fxCsvNum(f.tipo_iva), fxCsvImporte(f.cuotaC),
    fxCsvNum(f.tipo_re), fxCsvImporte(f.reC), fxCsvImporte(f.autoC), fxCsvImporte(f.dedC), fxCsvImporte(f.totalC)]));
  return await fichero(csv, `Libro_recibidas_${slug}_${p.desde}_${p.hasta}.csv`, 'propio');
}

// ---- /asientos ----
if (p.formato === 'holded') {
  // Plantilla de importación de facturas de compra de Holded (columnas del centro de ayuda oficial:
  // https://help.holded.com/es/articles/7903146-importar-tus-facturas-de-compra). Una fila por tipo de IVA.
  const cab = ['Núm. factura', 'Fecha dd/mm/yyyy', 'Fecha de vencimiento dd/mm/yyyy', 'Fecha contable dd/mm/yyyy', 'Descripción', 'Nombre del contacto', 'NIF',
    'Dirección', 'Población', 'Código postal', 'Provincia', 'País', 'Concepto', 'Descripción del producto', 'SKU', 'Precio unidad', 'Unidades', 'Descuento %',
    'IVA %', 'Retención %', 'Inv. Suj. Pasivo (1/0)', 'Operación', 'Cantidad cobrada', 'Fecha de cobro', 'Cuenta de pago', 'Tags separados por -',
    'Nombre cuenta de gasto', 'Núm. cuenta de gasto', 'Moneda', 'Cambio de moneda'];
  const OPS = { interior: 'general', exenta: 'general', intracomunitaria: 'intracomunitaria', isp_nacional: 'inversion_sujeto_pasivo', extracomunitaria: 'extracomunitaria', importacion: 'importacion' };
  const filas = [];
  const extraAvisos = new Set();
  const orden = [...validas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
  for (const x of orden) {
    const lineas = x.lineas.map((l) => ({ concepto: `Base IVA ${String(l.tipo).replace('.', ',')} %`, baseC: l.baseC, clave: `p_iva_${String(l.tipo).replace('.', '_')}` }));
    if (x.lineas.some((l) => l.reC !== 0)) extraAvisos.add('recargo_no_exportado');
    if (x.exentaC !== 0 || !lineas.length) lineas.push({ concepto: x.operacion === 'interior' || x.operacion === 'exenta' ? 'Base exenta o no sujeta' : `Base ${FX_TXT_OPERACION[x.operacion] || x.operacion}`, baseC: x.exentaC, clave: 'p_iva_0' });
    if (x.supC !== 0) lineas.push({ concepto: 'Suplidos', baseC: x.supC, clave: 'p_iva_0' });
    const pagada = x.estado_pago === 'pagada';
    lineas.forEach((l, i) => {
      filas.push([x.numero || x.num_recepcion || String(x.id), fxCsvFecha(x.fecha), fxCsvFecha(x.fecha_vencimiento || x.fecha), fxCsvFecha(x.fecha), x.categoria, x.nombre, x.nif,
        '', '', '', '', '', l.concepto, '', '', fxCsvImporte(l.baseC), '1', '', l.clave, x.irpfC !== 0 && l.concepto !== 'Suplidos' ? fxCsvNum(x.irpfTipo) : '',
        FX_AUTORREP.includes(x.operacion) ? '1' : '0', OPS[x.operacion] || 'general', i === 0 ? fxCsvImporte(pagada ? x.aPagarC : 0) : '', i === 0 && pagada ? fxCsvFecha(x.fecha_pago) : '',
        '', 'fact-n8n', '', x.cuenta_gasto, 'EUR', '']);
    });
  }
  return await fichero(fxCsv(cab, filas), `Compras_Holded_${slug}_${p.desde}_${p.hasta}.csv`, 'columnas oficiales Holded; claves de impuesto, retencion y separador a validar', { avisos: [...extraAvisos] });
}
const { lineas, excluidas } = fxAsientos(validas);
const filas = lineas.map((l) => [l.asiento, fxCsvFecha(l.fecha), l.cuenta, l.concepto, fxCsvImporte(l.debeC), fxCsvImporte(l.haberC), l.documento, l.nif]);
if (p.formato === 'a3') {
  // Plantilla A3 NO verificada (la documentación oficial está tras el acceso de a3responde): «a validar».
  const cab = ['Fecha', 'Nº asiento', 'Subcuenta', 'Concepto', 'Importe Debe', 'Importe Haber', 'Nº documento', 'NIF'];
  const filasA3 = lineas.map((l) => [fxCsvFecha(l.fecha), l.asiento, l.cuenta, l.concepto, fxCsvImporte(l.debeC), fxCsvImporte(l.haberC), l.documento, l.nif]);
  return await fichero(fxCsv(cab, filasA3), `Asientos_A3_A-VALIDAR_${slug}_${p.desde}_${p.hasta}.csv`, 'a validar', { excluidas: excluidas.map((x) => x.id).join(',') });
}
const cab = ['Asiento', 'Fecha', 'Cuenta', 'Concepto', 'Debe', 'Haber', 'Documento', 'NIF'];
return await fichero(fxCsv(cab, filas), `Asientos_${slug}_${p.desde}_${p.hasta}.csv`, 'propio', { excluidas: excluidas.map((x) => x.id).join(',') });
