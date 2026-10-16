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

// === COMÚN Fiscal: inicio ===
// Bloque idéntico en FACT — Fiscal («Fiscal: calcular») y FACT — Exportar Excel («Generar Excel»).
// Si cambias algo aquí, cópialo en los dos (fuente: n8n/codigo/comun_fiscal.js). Céntimos enteros.
// Diseño: docs/diseno-gestoria.md §4. Todas las cifras en EUR: cada importe de la factura (que se guarda
// en su moneda) se convierte con su tipo_cambio, también la cuota autorrepercutida y la deducible.
const FX_VALIDOS = ['ok', 'revisar', 'posible_duplicada'];
const FX_AUTORREP = ['intracomunitaria', 'isp_nacional', 'extracomunitaria'];
const FX_UMBRAL_347 = 300506; // 3.005,06 € (se declara si se supera)
const FX_UE = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'GR', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
const fxCent = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : 0);
const fxEuros = (c) => Math.round(c) / 100;
const fxNif = (s) => {
  if (s === null || s === undefined) return null;
  let v = String(s).toUpperCase().replace(/[\s.\-\/]/g, '');
  if (/^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(v)) v = v.slice(2);
  return v || null;
};
const fxOrigenNif = (s) => {
  const v = fxNif(s);
  if (!v) return null;
  if (/^(\d|[A-Z]\d)/.test(v)) return 'ES';
  return FX_UE.has(v.slice(0, 2)) ? 'UE' : 'EXT';
};
const fxFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fxTrimestreDe = (fecha) => Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1;
const fxPeriodo = (anio, trimestre) => {
  if (!trimestre) return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  const m1 = (trimestre - 1) * 3 + 1;
  const fin = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' }[trimestre];
  return { desde: `${anio}-${String(m1).padStart(2, '0')}-01`, hasta: `${anio}-${fin}` };
};
// EUR por unidad de la moneda de la factura (1 si EUR); null si falta el tipo de cambio.
const fxCambio = (f) => (!f.moneda || f.moneda === 'EUR' ? 1 : (typeof f.tipo_cambio === 'number' && f.tipo_cambio > 0 ? f.tipo_cambio : null));
const fxDesglose = (f) => {
  let d = [];
  try { d = JSON.parse(f.desglose_iva_json || '[]'); } catch (e) { d = []; }
  if (!Array.isArray(d)) d = [];
  d = d.filter((l) => l && typeof l === 'object' && (typeof l.base === 'number' || typeof l.cuota_iva === 'number'));
  if (!d.length && typeof f.base === 'number') { // filas antiguas sin desglose: base/iva_tipo/iva_cuota
    const baseC = fxCent(f.base) - fxCent(f.base_exenta || 0);
    if (baseC !== 0 || fxCent(f.iva_cuota || 0) !== 0) d = [{ base: baseC / 100, tipo_iva: f.iva_tipo || 0, cuota_iva: f.iva_cuota || 0, tipo_re: 0, cuota_re: 0 }];
  }
  return d;
};
// Normaliza una factura a céntimos en EUR. cliente = fila de fact_clientes (prorrata y régimen).
const fxPreparar = (f, cliente) => {
  const tc = fxCambio(f);
  const aE = (x) => (tc === null ? 0 : Math.round(fxCent(x || 0) * tc));
  const deducible = f.deducible || 'na';
  const prorrata = cliente && typeof cliente.prorrata_pct === 'number' && cliente.prorrata_pct >= 0 && cliente.prorrata_pct <= 100 ? cliente.prorrata_pct : 100;
  const pct = deducible === 'si' || deducible === 'parcial' ? prorrata : 0;
  const lineas = fxDesglose(f).map((l) => {
    const cuotaC = aE(l.cuota_iva);
    return { baseC: aE(l.base), tipo: typeof l.tipo_iva === 'number' ? l.tipo_iva : 0, cuotaC, tipoRe: typeof l.tipo_re === 'number' ? l.tipo_re : 0, reC: aE(l.cuota_re), dedC: Math.round((cuotaC * pct) / 100) };
  });
  const operacion = f.operacion || 'interior';
  const autoC = FX_AUTORREP.includes(operacion) ? aE(f.cuota_autorrepercutida) : 0;
  return {
    id: f.id, cliente_id: f.cliente_id, estado: f.estado, fecha: f.fecha_emision, fecha_operacion: fxFecha(f.fecha_operacion) ? f.fecha_operacion : f.fecha_emision,
    numero: f.numero || null, num_recepcion: f.num_recepcion || null, nif: fxNif(f.nif), origen: fxOrigenNif(f.nif), nombre: f.proveedor || '(sin proveedor)',
    tipo_factura: f.tipo_factura || 'completa', operacion, deducible, motivo: f.motivo_deducible || null, pct, categoria: f.categoria || null,
    cuenta_gasto: f.cuenta_gasto || '629', cuenta_proveedor: f.cuenta_proveedor || (String(f.cuenta_gasto || '').startsWith('60') ? '400' : '410'),
    moneda: f.moneda || 'EUR', sinCambio: tc === null, nif_valido: f.nif_valido, lineas, exentaC: aE(f.base_exenta), autoC, autoDedC: Math.round((autoC * pct) / 100),
    irpfTipo: f.irpf_tipo || 0, irpfC: aE(f.irpf_cuota), supC: aE(f.suplidos), totalC: aE(f.total), aPagarC: aE(typeof f.total_a_pagar === 'number' ? f.total_a_pagar : f.total),
    estado_pago: f.estado_pago || 'pendiente', fecha_vencimiento: f.fecha_vencimiento || null, fecha_pago: f.fecha_pago || null,
  };
};
// Retenciones: alquileres (cuenta 621 o categoría «Alquileres») → 115; resto → 111.
const fxModeloRet = (p) => (String(p.cuenta_gasto).startsWith('621') || p.categoria === 'Alquileres' ? '115' : '111');

// --- Libro registro de facturas recibidas (art. 64.4 RIVA): una fila por tipo de IVA ---
// Base exenta / no sujeta / ISP / intracomunitaria: fila con tipo 0 y la operación como clave
// (y la cuota autorrepercutida en su columna).
const fxFilasLibro = (prep) => {
  const filas = [];
  for (const p of prep) {
    const comun = { id: p.id, cliente_id: p.cliente_id, num_recepcion: p.num_recepcion, fecha_expedicion: p.fecha, fecha_operacion: p.fecha_operacion, numero: p.numero, nif: p.nif, nombre: p.nombre, tipo_factura: p.tipo_factura, operacion: p.operacion };
    const antes = filas.length;
    for (const l of p.lineas) {
      filas.push({ ...comun, baseC: l.baseC, tipo_iva: l.tipo, cuotaC: l.cuotaC, tipo_re: l.tipoRe, reC: l.reC, autoC: 0, dedC: l.dedC, totalC: l.baseC + l.cuotaC + l.reC });
    }
    if (p.exentaC !== 0 || filas.length === antes) {
      filas.push({ ...comun, baseC: p.exentaC, tipo_iva: 0, cuotaC: 0, tipo_re: 0, reC: 0, autoC: p.autoC, dedC: p.autoDedC, totalC: p.exentaC });
    }
  }
  return filas;
};

// --- /fiscal (§4). prepAnio: facturas del cliente y del año (válidas, preparadas) ---
const fxCalcularFiscal = (prepAnio, cliente, anio, trimestre) => {
  const { desde, hasta } = fxPeriodo(anio, trimestre);
  const avisos = [];
  const aviso = (codigo, mensaje, ids) => { if (!ids || ids.length) avisos.push({ codigo, mensaje, ids: ids || [] }); };
  const enPeriodo = prepAnio.filter((p) => p.fecha >= desde && p.fecha <= hasta);
  const sinCambio = enPeriodo.filter((p) => p.sinCambio);
  aviso('sin_tipo_cambio', 'Facturas en otra moneda sin tipo de cambio: no se incluyen en ningún cálculo.', sinCambio.map((p) => p.id));
  const per = enPeriodo.filter((p) => !p.sinCambio);
  aviso('revisar', 'Facturas en «revisar» dentro del periodo: se incluyen, revísalas antes de presentar.', per.filter((p) => p.estado === 'revisar').map((p) => p.id));
  aviso('posible_duplicada', 'Posibles duplicadas dentro del periodo: se incluyen; bórralas si lo son.', per.filter((p) => p.estado === 'posible_duplicada').map((p) => p.id));
  aviso('nif_invalido', 'NIF del proveedor con dígito de control incorrecto: IVA no deducible hasta tener factura corregida.', per.filter((p) => p.nif_valido === false).map((p) => p.id));
  aviso('sin_nif', 'Facturas sin NIF del proveedor (no entran en el 347).', per.filter((p) => !p.nif).map((p) => p.id));
  aviso('sin_numero', 'Facturas sin número (IVA no deducible).', per.filter((p) => !p.numero).map((p) => p.id));
  aviso('dudoso', 'Deducibilidad dudosa (restauración o viajes): no se suma al deducible; decide el contable.', per.filter((p) => p.deducible === 'dudoso').map((p) => p.id));
  const importaciones = per.filter((p) => p.operacion === 'importacion');
  aviso('importacion', 'Importaciones: el IVA se liquida con el DUA (casillas 32-35); no se incluyen.', importaciones.map((p) => p.id));
  const regimen = (cliente && cliente.regimen_iva) || 'particular';
  if (regimen === 'particular') aviso('regimen', 'Cliente particular: sin derecho a deducir; 303, 111, 115, 349 y 347 no le aplican (informativo).', null);
  if (regimen === 'recargo_equivalencia') aviso('regimen', 'Cliente en recargo de equivalencia: no deduce el IVA de sus compras (el recargo es informativo).', null);
  if (regimen === 'simplificado') aviso('regimen', 'Cliente en régimen simplificado: revisa la cuota deducible con el método de módulos.', null);
  if (cliente && typeof cliente.prorrata_pct === 'number' && cliente.prorrata_pct < 100) aviso('prorrata', `Prorrata del ${cliente.prorrata_pct} % aplicada a las cuotas deducibles.`, null);

  // IVA soportado interior por tipo (operaciones interiores y exentas con desglose)
  const interiorMap = {};
  const recargoMap = {};
  let exentasC = 0;
  for (const p of per.filter((x) => !FX_AUTORREP.includes(x.operacion) && x.operacion !== 'importacion')) {
    for (const l of p.lineas) {
      const k = String(l.tipo);
      const t = (interiorMap[k] = interiorMap[k] || { tipo_iva: l.tipo, baseC: 0, cuotaC: 0, baseDedC: 0, dedC: 0 });
      t.baseC += l.baseC; t.cuotaC += l.cuotaC; t.dedC += l.dedC;
      if (l.dedC !== 0) t.baseDedC += l.baseC;
      if (l.reC !== 0 || l.tipoRe) {
        const kr = String(l.tipoRe);
        const r = (recargoMap[kr] = recargoMap[kr] || { tipo_re: l.tipoRe, baseC: 0, cuotaC: 0 });
        r.baseC += l.baseC; r.cuotaC += l.reC;
      }
    }
    exentasC += p.exentaC;
  }
  const interior = Object.values(interiorMap).sort((a, b) => b.tipo_iva - a.tipo_iva)
    .map((t) => ({ tipo_iva: t.tipo_iva, base: fxEuros(t.baseC), cuota: fxEuros(t.cuotaC), base_deducible: fxEuros(t.baseDedC), cuota_deducible: fxEuros(t.dedC) }));
  const recargo = Object.values(recargoMap).sort((a, b) => b.tipo_re - a.tipo_re).map((r) => ({ tipo_re: r.tipo_re, base: fxEuros(r.baseC), cuota: fxEuros(r.cuotaC) }));
  const bloqueAuto = (ops) => {
    const xs = per.filter((p) => ops.includes(p.operacion));
    return {
      base: fxEuros(xs.reduce((s, p) => s + p.exentaC + p.lineas.reduce((a, l) => a + l.baseC, 0), 0)),
      cuota_devengada: fxEuros(xs.reduce((s, p) => s + p.autoC, 0)),
      cuota_deducible: fxEuros(xs.reduce((s, p) => s + p.autoDedC, 0)),
      ids: xs.map((p) => p.id),
    };
  };
  const intracomunitarias = bloqueAuto(['intracomunitaria']);
  const isp = bloqueAuto(['isp_nacional', 'extracomunitaria']);
  const interiorDedC = Object.values(interiorMap).reduce((s, t) => s + t.dedC, 0);
  const totalDedC = interiorDedC + fxCent(intracomunitarias.cuota_deducible) + fxCent(isp.cuota_deducible);
  const no_deducible = per.filter((p) => p.operacion !== 'importacion').map((p) => {
    const ivaC = p.lineas.reduce((s, l) => s + l.cuotaC, 0) + p.autoC;
    const dedC = p.lineas.reduce((s, l) => s + l.dedC, 0) + p.autoDedC;
    return { id: p.id, proveedor: p.nombre, numero: p.numero, deducible: p.deducible, motivo: p.motivo, cuotaC: ivaC - dedC };
  }).filter((x) => x.cuotaC !== 0).map((x) => ({ id: x.id, proveedor: x.proveedor, numero: x.numero, deducible: x.deducible, motivo: x.motivo, cuota: fxEuros(x.cuotaC) }));
  const sumBase = (arr, campo) => arr.reduce((s, t) => s + t[campo], 0);
  const casillas = {
    '10': intracomunitarias.base, '11': intracomunitarias.cuota_devengada, '12': isp.base, '13': isp.cuota_devengada,
    '28': fxEuros(sumBase(Object.values(interiorMap), 'baseDedC') + (fxCent(isp.cuota_deducible) ? fxCent(isp.base) : 0)),
    '29': fxEuros(interiorDedC + fxCent(isp.cuota_deducible)),
    '36': fxCent(intracomunitarias.cuota_deducible) ? intracomunitarias.base : 0, '37': intracomunitarias.cuota_deducible,
  };

  // Retenciones (111 profesionales y otros; 115 alquileres): perceptores = NIF distintos
  const conRet = per.filter((p) => p.irpfC !== 0);
  const modelo = (m) => {
    const xs = conRet.filter((p) => fxModeloRet(p) === m).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
    return {
      num_perceptores: new Set(xs.map((p) => p.nif || `sin-nif:${p.nombre}`)).size,
      base: fxEuros(xs.reduce((s, p) => s + p.lineas.reduce((a, l) => a + l.baseC, 0) + p.exentaC, 0)),
      retencion: fxEuros(xs.reduce((s, p) => s + p.irpfC, 0)),
      detalle: xs.map((p) => ({ id: p.id, fecha: p.fecha, proveedor: p.nombre, nif: p.nif, numero: p.numero, base: fxEuros(p.lineas.reduce((a, l) => a + l.baseC, 0) + p.exentaC), irpf_tipo: p.irpfTipo, retencion: fxEuros(p.irpfC) })),
    };
  };

  // 349: adquisiciones intracomunitarias (clave I) agrupadas por NIF
  const m349 = {};
  for (const p of per.filter((x) => x.operacion === 'intracomunitaria')) {
    const k = p.nif || `sin-nif:${p.nombre}`;
    const g = (m349[k] = m349[k] || { nif: p.nif, nombre: p.nombre, clave: 'I', baseC: 0 });
    g.baseC += p.exentaC + p.lineas.reduce((a, l) => a + l.baseC, 0);
  }
  const modelo_349 = Object.values(m349).map((g) => ({ nif: g.nif, nombre: g.nombre, clave: g.clave, base: fxEuros(g.baseC) })).sort((a, b) => b.base - a.base);

  // 347 anual: por NIF normalizado, IVA incluido, neto de rectificativas; excluye operaciones con
  // retención, intracomunitarias (349), proveedores extranjeros e importaciones; > 3.005,06 €.
  const m347 = {};
  for (const p of prepAnio.filter((x) => !x.sinCambio && x.nif && x.origen === 'ES' && x.irpfC === 0
    && !['intracomunitaria', 'extracomunitaria', 'importacion'].includes(x.operacion)).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id))) {
    const g = (m347[p.nif] = m347[p.nif] || { nif: p.nif, nombre: p.nombre, totalC: 0, tri: [0, 0, 0, 0] });
    g.nombre = p.nombre;
    g.totalC += p.totalC;
    g.tri[fxTrimestreDe(p.fecha) - 1] += p.totalC;
  }
  const modelo_347_anual = regimen === 'particular' ? [] : Object.values(m347).filter((g) => g.totalC > FX_UMBRAL_347)
    .map((g) => ({ nif: g.nif, nombre: g.nombre, total_anual: fxEuros(g.totalC), por_trimestre: g.tri.map(fxEuros) })).sort((a, b) => b.total_anual - a.total_anual);

  return {
    periodo: { anio, trimestre: trimestre || null, desde, hasta },
    num_facturas: per.length,
    iva_303: {
      interior, recargo, intracomunitarias, isp, exentas_no_sujetas: { base: fxEuros(exentasC) },
      total_deducible: fxEuros(totalDedC), no_deducible, casillas_referencia: casillas,
    },
    retenciones: { modelo_111: modelo('111'), modelo_115: modelo('115') },
    modelo_349,
    modelo_347_anual,
    avisos,
  };
};

// --- Asientos (§4): una línea por apunte; el 6xx cuadra el asiento (redondeos de céntimo) ---
// debe 6xx (base + IVA no deducible + recargo + suplidos + autorrepercutida no deducible),
// debe 472 (cuota deducible), debe 472 / haber 477 (autorrepercutida), haber 4751 (IRPF),
// haber 400/410 (total a pagar). Si el 6xx calculado y el de cuadre difieren > 0,02 € se excluye.
const fxAsientos = (prep) => {
  const lineas = [];
  const excluidas = [];
  let n = 0;
  const orden = [...prep].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.num_recepcion || '').localeCompare(String(b.num_recepcion || '')) || a.id - b.id));
  for (const p of orden) {
    const ivaC = p.lineas.reduce((s, l) => s + l.cuotaC, 0);
    const ivaDedC = p.lineas.reduce((s, l) => s + l.dedC, 0);
    const reC = p.lineas.reduce((s, l) => s + l.reC, 0);
    const basesC = p.lineas.reduce((s, l) => s + l.baseC, 0) + p.exentaC;
    const haber = [['4751', p.irpfC, 'Retención IRPF'], [p.cuenta_proveedor, p.aPagarC, 'Total a pagar'], ['477', p.autoC, 'IVA autorrepercutido']];
    const haberC = haber.reduce((s, h) => s + h[1], 0);
    const gastoC = haberC - ivaDedC - p.autoDedC;
    const esperadoC = basesC + (ivaC - ivaDedC) + reC + p.supC + (p.autoC - p.autoDedC);
    if (Math.abs(gastoC - esperadoC) > 2) { excluidas.push({ id: p.id, motivo: 'Los importes de la factura no cuadran (revísala).' }); continue; }
    n += 1;
    const concepto = `Fra. ${p.numero || 's/n'} ${p.nombre}`.slice(0, 60);
    const documento = p.numero || p.num_recepcion || String(p.id);
    const base = { asiento: n, fecha: p.fecha, concepto, documento, nif: p.nif, factura_id: p.id };
    const debe = [[p.cuenta_gasto, gastoC], ['472', ivaDedC], ['472', p.autoDedC]];
    for (const [cuenta, c] of debe) if (c !== 0) lineas.push({ ...base, cuenta, debeC: c, haberC: 0 });
    for (const [cuenta, c] of haber) if (c !== 0) lineas.push({ ...base, cuenta, debeC: 0, haberC: c });
  }
  return { lineas, excluidas };
};

// --- CSV: «;», decimales con coma, fechas dd/mm/aaaa, UTF-8 con BOM, CRLF ---
const fxCsvCampo = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const fxCsvImporte = (c) => (c === null || c === undefined ? '' : (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + ',' + String(Math.abs(c) % 100).padStart(2, '0'));
const fxCsvNum = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
const fxCsvFecha = (s) => (fxFecha(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '');
const fxCsv = (cabecera, filas) => '﻿' + [cabecera, ...filas].map((f) => f.map(fxCsvCampo).join(';')).join('\r\n') + '\r\n';
const fxSlug = (s) => String(s || 'cliente').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente';
const FX_TXT_OPERACION = { interior: 'Interior', intracomunitaria: 'Intracomunitaria', isp_nacional: 'ISP nacional', extracomunitaria: 'Extracomunitaria', importacion: 'Importación', exenta: 'Exenta' };
const FX_TXT_TIPO = { completa: 'Completa', simplificada: 'Simplificada', simplificada_cualificada: 'Simplificada cualificada', rectificativa: 'Rectificativa' };
// === COMÚN Fiscal: fin ===

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

const buffer = Buffer.from(await wb.xlsx.writeBuffer());
const nombre = `Gastos_${hoy}.xlsx`;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const binario = await this.helpers.prepareBinaryData(buffer, nombre, MIME);
return [{ json: { nombre, mime: MIME, bytes: buffer.length, desde, hasta, num_facturas: periodo.length, total: eur(totalC) }, binary: { data: binario } }];
