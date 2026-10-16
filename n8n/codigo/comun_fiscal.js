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
