// Normaliza la extracción de Gemini, asigna el cliente, aplica reglas (cliente >
// global), completa los campos fiscales y valida con cálculos propios (céntimos).
// Si la moneda no es EUR, la entrada es la respuesta del BCE (CSV). Nunca
// incluye contenido de la factura en los mensajes de error.
const archivo = $('Recorrer archivos').first(1).json;
const prep = $('Preparar petición Gemini').first().json;
const g = $('Leer respuesta Gemini').first().json;
if (g._error) return [{ json: { _error: true, orden: archivo.orden, archivo: archivo.archivo, estado: 'error', error: g.error } }];
const d = g.d;

// === COMÚN Ingesta/API: inicio ===
// Bloque idéntico en FACT — Ingesta («Interpretar y validar») y FACT — API
// («PATCH: revalidar y fusionar»). Si cambias algo aquí, cámbialo en ambos.
// Todas las cifras en céntimos enteros. Diseño: docs/diseno-gestoria.md §2.
const num = (x) => {
  if (x === null || x === undefined || x === '') return null;
  let v = x;
  if (typeof v === 'string') {
    v = v.replace(/[^0-9,.\-]/g, '');
    if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
    else v = v.replace(',', '.');
    v = Number(v);
  }
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
};
const cent = (x) => Math.round(x * 100);
const fechaValida = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, dd] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd && y >= 1990;
};
const txtOrNull = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
// Método de pago: primera letra en mayúscula y el resto como venga («tarjeta» → «Tarjeta», «PayPal» igual).
const normalizarMetodoPago = (s) => { const t = txtOrNull(s); return t ? t.charAt(0).toLocaleUpperCase('es-ES') + t.slice(1) : null; };
const SUFIJOS = new Set(['sa', 'sau', 'sl', 'slu', 'sll', 'slne', 'scoop', 'sc', 'cb', 'bv', 'nv', 'ab', 'ltd', 'limited', 'inc', 'llc', 'gmbh', 'ag', 'plc', 'corp', 'corporation', 'spa', 'srl', 'sas', 'sarl', 'oy', 'aps', 'as', 'unipersonal', 'co']);
const normalizarProveedor = (s) => {
  if (!s) return null;
  let t = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const w = t.split(' ').filter(Boolean);
  while (w.length > 1 && SUFIJOS.has(w[w.length - 1])) w.pop();
  return w.join(' ') || null;
};
const r2 = (c) => Math.round(c) / 100; // céntimos -> euros

// --- NIF: normalizado (mayúsculas, sin espacios/guiones/puntos, sin «ES» delante de un NIF español) ---
const PAISES_UE = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'GR', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const normalizarNif = (s) => {
  if (s === null || s === undefined) return null;
  let v = String(s).toUpperCase().replace(/[\s.\-\/]/g, '');
  if (/^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(v)) v = v.slice(2);
  return v || null;
};
// 'ES' (forma de NIF español), 'UE' (prefijo de país UE distinto de ES), 'EXT' (resto: EIN, EU-OSS, otros países) o null.
const origenNif = (s) => {
  const v = normalizarNif(s);
  if (!v) return null;
  if (/^(\d|[A-Z]\d)/.test(v)) return 'ES';
  if (PAISES_UE.has(v.slice(0, 2))) return 'UE';
  return 'EXT';
};
// true/false según el dígito de control (DNI, NIE, CIF y NIF K/L/M); null si no hay NIF o es extranjero.
const validarNif = (s) => {
  const v = normalizarNif(s);
  if (!v) return null;
  if (origenNif(v) !== 'ES') return null;
  if (/^\d{8}[A-Z]$/.test(v)) return LETRAS_DNI[Number(v.slice(0, 8)) % 23] === v[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) return LETRAS_DNI[Number('XYZ'.indexOf(v[0]) + v.slice(1, 8)) % 23] === v[8];
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    let suma = 0;
    v.slice(1, 8).split('').map(Number).forEach((x, i) => {
      if (i % 2 === 0) { const y = x * 2; suma += Math.floor(y / 10) + (y % 10); } else suma += x;
    });
    const ctrl = (10 - (suma % 10)) % 10;
    const letra = 'JABCDEFGHI'[ctrl];
    if ('KLMNPQRSW'.includes(v[0])) return v[8] === letra;
    if ('ABEH'.includes(v[0])) return v[8] === String(ctrl);
    return v[8] === String(ctrl) || v[8] === letra;
  }
  return false;
};

// --- Desglose de IVA: [{base, tipo_iva, cuota_iva, tipo_re, cuota_re}], una línea por tipo ---
// Las líneas al 0 % sin cuota pasan a base_exenta.
const normalizarDesglose = (arr, baseExenta) => {
  let exentaC = cent(num(baseExenta) || 0);
  const lineas = [];
  for (const l of Array.isArray(arr) ? arr : []) {
    if (!l || typeof l !== 'object') continue;
    const x = { base: num(l.base), tipo_iva: num(l.tipo_iva), cuota_iva: num(l.cuota_iva), tipo_re: num(l.tipo_re) || 0, cuota_re: num(l.cuota_re) || 0 };
    if (x.base === null && x.cuota_iva === null) continue;
    if ((x.tipo_iva === 0 || x.tipo_iva === null) && !x.cuota_iva && !x.cuota_re && x.base !== null) { exentaC += cent(x.base); continue; }
    lineas.push(x);
  }
  return { desglose: lineas, base_exenta: r2(exentaC) };
};
// Campos de compatibilidad: base = Σ bases + exenta; iva_tipo = tipo de la base mayor; iva_cuota = Σ cuotas (sin recargo).
const derivarCompat = (desglose, baseExenta) => {
  const exC = cent(baseExenta || 0);
  if (!desglose.length && !exC) return { base: null, iva_tipo: null, iva_cuota: null, cuota_re: 0 };
  if (desglose.some((l) => l.base === null || l.cuota_iva === null)) {
    return { base: desglose.some((l) => l.base === null) ? null : r2(desglose.reduce((s, l) => s + cent(l.base), exC)), iva_tipo: desglose.length ? desglose[0].tipo_iva : 0, iva_cuota: null, cuota_re: r2(desglose.reduce((s, l) => s + cent(l.cuota_re || 0), 0)) };
  }
  let mayor = null;
  for (const l of desglose) if (!mayor || Math.abs(l.base) > Math.abs(mayor.base)) mayor = l;
  return {
    base: r2(desglose.reduce((s, l) => s + cent(l.base), exC)),
    iva_tipo: mayor ? mayor.tipo_iva : 0,
    iva_cuota: r2(desglose.reduce((s, l) => s + cent(l.cuota_iva), 0)),
    cuota_re: r2(desglose.reduce((s, l) => s + cent(l.cuota_re || 0), 0)),
  };
};

// --- Operación y autorrepercusión ---
const OPERACIONES = ['interior', 'intracomunitaria', 'isp_nacional', 'extracomunitaria', 'importacion', 'exenta'];
const AUTORREPERCUTEN = ['intracomunitaria', 'isp_nacional', 'extracomunitaria'];
// mencion: 'inversion_sujeto_pasivo' | 'reverse_charge' | 'intracomunitaria' | 'exenta' | 'no_sujeta' | 'ninguna' | null
const determinarOperacion = ({ nif, desglose, base_exenta, mencion }) => {
  const sinIva = !desglose.some((l) => cent(l.cuota_iva || 0) !== 0);
  const origen = origenNif(nif);
  if (sinIva && (mencion === 'inversion_sujeto_pasivo' || (mencion === 'reverse_charge' && origen === 'ES'))) return 'isp_nacional';
  if (sinIva && origen === 'UE') return 'intracomunitaria';
  if (sinIva && origen === 'EXT') return 'extracomunitaria';
  if (sinIva && cent(base_exenta || 0) !== 0) return 'exenta';
  return 'interior';
};
const calcularAutorrepercutida = (operacion, baseExenta, tipo) => (AUTORREPERCUTEN.includes(operacion)
  ? r2(Math.round((cent(baseExenta || 0) * (typeof tipo === 'number' && tipo > 0 ? tipo : 21)) / 100))
  : 0);

// --- Deducibilidad (orden del diseño §2). cliente = fila de fact_clientes ---
const DEDUCIBLES = ['si', 'no', 'parcial', 'dudoso', 'na'];
const CATEGORIAS_DUDOSAS = ['Restaurantes y comida a domicilio', 'Viajes'];
const calcularDeducible = (f, cliente, forzado) => {
  const regimen = (cliente && cliente.regimen_iva) || 'particular';
  const prorrata = cliente && typeof cliente.prorrata_pct === 'number' && cliente.prorrata_pct >= 0 && cliente.prorrata_pct <= 100 ? cliente.prorrata_pct : 100;
  const ivaC = f.desglose.reduce((s, l) => s + cent(l.cuota_iva || 0), 0) + cent(f.cuota_autorrepercutida || 0);
  const cuotaCon = (pct) => r2(Math.round((ivaC * pct) / 100));
  const res = (deducible, motivo) => ({
    deducible,
    motivo_deducible: motivo,
    cuota_deducible: deducible === 'si' || deducible === 'parcial' ? cuotaCon(prorrata) : 0,
  });
  if (forzado && DEDUCIBLES.includes(forzado.deducible)) return res(forzado.deducible, forzado.motivo || 'Manual: marcado a mano.');
  if (regimen === 'particular') return res('na', 'El cliente es un particular: no deduce IVA.');
  if (regimen === 'recargo_equivalencia') return res('no', 'Cliente en recargo de equivalencia: no deduce el IVA soportado.');
  if (f.tipo_factura === 'simplificada' && !f.destinatario_nif) return res('no', 'Factura simplificada sin NIF del destinatario.');
  if (f.nif_valido === false) return res('no', 'NIF del proveedor no válido (subsanable: pide una factura corregida).');
  if (!f.numero) return res('no', 'Falta el número de factura (subsanable).');
  if (CATEGORIAS_DUDOSAS.includes(f.categoria)) return res('dudoso', 'Restauración o viajes: deducible solo si está afecto a la actividad.');
  if (ivaC === 0) return res('na', 'Sin IVA soportado ni autorrepercutido.');
  if (prorrata < 100) return res('parcial', `Deducible al ${prorrata} % (prorrata del cliente).`);
  return res('si', AUTORREPERCUTEN.includes(f.operacion) ? 'Deducible: IVA autorrepercutido.' : 'Factura completa con los datos obligatorios.');
};

// --- Reglas y cuentas: regla del cliente > regla global > categoría.cuenta_pgc > 629 ---
const buscarRegla = (reglas, proveedorNorm, clienteId, campo) => {
  if (!proveedorNorm) return null;
  const tiene = (r) => r && r.proveedor_norm === proveedorNorm && txtOrNull(r[campo]);
  return (reglas || []).find((r) => tiene(r) && r.cliente_id === clienteId)
    || (reglas || []).find((r) => tiene(r) && (r.cliente_id === null || r.cliente_id === undefined))
    || null;
};
const resolverCuenta = (proveedorNorm, categoria, clienteId, reglas, categorias) => {
  const regla = buscarRegla(reglas, proveedorNorm, clienteId, 'cuenta_gasto');
  const cat = (categorias || []).find((c) => c && c.nombre === categoria);
  const cuenta = (regla && txtOrNull(regla.cuenta_gasto)) || (cat && txtOrNull(cat.cuenta_pgc)) || '629';
  return { cuenta_gasto: cuenta, cuenta_proveedor: cuentaProveedor(cuenta) };
};
const cuentaProveedor = (cuenta) => (String(cuenta || '').startsWith('60') ? '400' : '410');

// --- Moneda: tipo_cambio = EUR por 1 unidad (BCE); total_eur = total × tipo_cambio ---
const aplicarCambio = (f, tipoCambio) => {
  if (!f.moneda || f.moneda === 'EUR') return { tipo_cambio: 1, total_eur: f.total };
  if (typeof tipoCambio !== 'number' || !(tipoCambio > 0) || f.total === null) return { tipo_cambio: null, total_eur: null };
  return { tipo_cambio: tipoCambio, total_eur: r2(Math.round(cent(f.total) * tipoCambio)) };
};
// CSV del BCE (format=csvdata): último OBS_VALUE con TIME_PERIOD <= fecha. Devuelve EUR por unidad (1/valor) o null.
const tipoCambioBce = (csv, fecha) => {
  if (typeof csv !== 'string' || !csv.trim()) return null;
  const lineas = csv.trim().split(/\r?\n/);
  const cab = lineas[0].split(',');
  const iT = cab.indexOf('TIME_PERIOD');
  const iV = cab.indexOf('OBS_VALUE');
  if (iT < 0 || iV < 0) return null;
  let mejor = null;
  for (const l of lineas.slice(1)) {
    const c = l.split(',');
    const v = Number(c[iV]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(c[iT]) && c[iT] <= fecha && v > 0 && (!mejor || c[iT] > mejor.t)) mejor = { t: c[iT], v };
  }
  return mejor ? Math.round((1 / mejor.v) * 1e6) / 1e6 : null;
};

// --- Nº de recepción: siguiente correlativo del cliente en el año ---
const siguienteRecepcion = (filas, clienteId, anio) => {
  const pre = `${anio}-`;
  let max = 0;
  for (const f of filas || []) {
    if (f && f.cliente_id === clienteId && typeof f.num_recepcion === 'string' && f.num_recepcion.startsWith(pre)) {
      const n = Number(f.num_recepcion.slice(pre.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return pre + String(max + 1).padStart(6, '0');
};

// --- Completa los campos fiscales derivados de una factura (Ingesta, PATCH y migración) ---
// f: nif, destinatario_nif, numero, categoria, tipo_factura, desglose (array), base_exenta, suplidos,
//    irpf_tipo, irpf_cuota, total, moneda, tipo_cambio, operacion (indicada o null), mencion, tipo_autorrepercusion.
const TIPOS_FACTURA = ['completa', 'simplificada', 'simplificada_cualificada', 'rectificativa'];
const completarFiscal = (f, cliente, forzado) => {
  const nd = normalizarDesglose(f.desglose, f.base_exenta);
  const total = num(f.total);
  const compat = derivarCompat(nd.desglose, nd.base_exenta);
  const tipo_factura = TIPOS_FACTURA.includes(f.tipo_factura) ? f.tipo_factura : 'completa';
  let irpf_cuota = num(f.irpf_cuota);
  const irpf_tipo = num(f.irpf_tipo) || 0;
  if (irpf_cuota === null && irpf_tipo > 0) {
    const baseIrpfC = nd.desglose.reduce((s, l) => s + cent(l.base || 0), 0);
    irpf_cuota = r2(Math.round((baseIrpfC * irpf_tipo) / 100));
  }
  irpf_cuota = Math.abs(irpf_cuota || 0);
  if (total !== null && total < 0) irpf_cuota = -irpf_cuota; // rectificativas: retención negativa
  const nif = normalizarNif(f.nif);
  const destinatario_nif = normalizarNif(f.destinatario_nif);
  const operacion = OPERACIONES.includes(f.operacion) ? f.operacion
    : determinarOperacion({ nif, desglose: nd.desglose, base_exenta: nd.base_exenta, mencion: f.mencion });
  const cuota_autorrepercutida = calcularAutorrepercutida(operacion, nd.base_exenta, num(f.tipo_autorrepercusion));
  const nif_valido = validarNif(nif);
  const moneda = typeof f.moneda === 'string' && /^[A-Z]{3}$/.test(f.moneda) ? f.moneda : 'EUR';
  const cambio = aplicarCambio({ moneda, total }, num(f.tipo_cambio) === null ? null : Number(f.tipo_cambio));
  const base = {
    nif,
    destinatario_nif,
    tipo_factura,
    operacion,
    desglose: nd.desglose,
    desglose_iva_json: JSON.stringify(nd.desglose),
    base_exenta: nd.base_exenta,
    base: compat.base,
    iva_tipo: compat.iva_tipo,
    iva_cuota: compat.iva_cuota,
    cuota_re: compat.cuota_re,
    irpf_tipo,
    irpf_cuota,
    suplidos: num(f.suplidos) || 0,
    total,
    total_a_pagar: total === null ? null : r2(cent(total) - cent(irpf_cuota)),
    cuota_autorrepercutida,
    nif_valido,
    moneda,
    tipo_cambio: cambio.tipo_cambio,
    total_eur: cambio.total_eur,
  };
  const ded = calcularDeducible({ ...base, numero: txtOrNull(f.numero), categoria: f.categoria }, cliente, forzado);
  return { ...base, ...ded };
};

// --- Validación (céntimos). hoy = AAAA-MM-DD en Europe/Madrid. total_a_pagar_leido: el impreso (Ingesta) ---
const validarFactura = (f, hoy) => {
  const errores = [];
  const fmt = (x) => x.toFixed(2);
  if (!f.proveedor) errores.push('No se ha identificado el proveedor.');
  if (f.total === null) errores.push('No se ha encontrado el total.');
  else if (cent(f.total) === 0) errores.push('El total no puede ser 0.');
  else if (f.total < 0 && f.tipo_factura !== 'rectificativa') errores.push(`El total (${fmt(f.total)}) es negativo y la factura no es rectificativa.`);
  const desglose = f.desglose || [];
  const exC = cent(f.base_exenta || 0);
  if (!desglose.length && !exC) {
    errores.push('No se puede comprobar base + IVA = total: falta base imponible y cuota de IVA.');
  } else if (desglose.some((l) => l.base === null || l.cuota_iva === null)) {
    const faltan = [desglose.some((l) => l.base === null) ? 'base imponible' : null, desglose.some((l) => l.cuota_iva === null) ? 'cuota de IVA' : null].filter(Boolean).join(' y ');
    errores.push(`No se puede comprobar base + IVA = total: falta ${faltan}.`);
  } else if (f.total !== null) {
    const baseC = desglose.reduce((s, l) => s + cent(l.base), 0) + exC;
    const ivaC = desglose.reduce((s, l) => s + cent(l.cuota_iva), 0);
    const reC = desglose.reduce((s, l) => s + cent(l.cuota_re || 0), 0);
    const supC = cent(f.suplidos || 0);
    const sumaC = baseC + ivaC + reC + supC;
    const dif = sumaC - cent(f.total);
    if (Math.abs(dif) > 2) {
      if (!reC && !supC) errores.push(`Base (${fmt(baseC / 100)}) + IVA (${fmt(ivaC / 100)}) = ${fmt(sumaC / 100)}, no cuadra con el total (${fmt(f.total)}): diferencia de ${fmt(dif / 100)} €.`);
      else errores.push(`Base (${fmt(baseC / 100)}) + IVA (${fmt(ivaC / 100)}) + recargo (${fmt(reC / 100)}) + suplidos (${fmt(supC / 100)}) = ${fmt(sumaC / 100)}, no cuadra con el total (${fmt(f.total)}): diferencia de ${fmt(dif / 100)} €.`);
    }
  }
  if (f.total !== null && f.total_a_pagar_leido !== null && f.total_a_pagar_leido !== undefined) {
    const esperado = cent(f.total) - cent(f.irpf_cuota || 0);
    const dif = esperado - cent(f.total_a_pagar_leido);
    if (Math.abs(dif) > 2) errores.push(`Total (${fmt(f.total)}) − retención (${fmt(f.irpf_cuota || 0)}) = ${fmt(esperado / 100)}, no cuadra con el total a pagar (${fmt(f.total_a_pagar_leido)}).`);
  }
  if (!f.fecha_emision) errores.push('Fecha de emisión ausente o no válida.');
  else if (f.fecha_emision > hoy) errores.push(`La fecha de emisión (${f.fecha_emision}) es futura.`);
  if (f.moneda && f.moneda !== 'EUR' && (f.total_eur === null || f.total_eur === undefined)) errores.push(`Sin tipo de cambio para ${f.moneda}: no se suma en los totales en euros.`);
  return errores;
};
// === COMÚN Ingesta/API: fin ===

// --- contexto ---
const hoy = $now.setZone('Europe/Madrid').toISODate();
const ahora = $now.setZone('Europe/Madrid').toISO();
const categorias = prep.categorias || [];
const filasCategorias = $('Leer categorías').all().map((i) => i.json).filter((c) => c && c.nombre);
const reglas = $('Leer reglas').all().map((i) => i.json).filter((x) => x && x.proveedor_norm);
const clientes = $('Leer clientes').all().map((i) => i.json).filter((c) => c && c.id !== undefined && c.id !== null);

// --- normalización ---
const proveedor = txtOrNull(d.proveedor);
const proveedor_norm = normalizarProveedor(proveedor);
const numero = txtOrNull(d.numero);
const total = num(d.total);
const fecha_emision = fechaValida(d.fecha_emision) ? d.fecha_emision : null;
const fecha_vencimiento = fechaValida(d.fecha_vencimiento) ? d.fecha_vencimiento : null;
const fecha_operacion = fechaValida(d.fecha_operacion) ? d.fecha_operacion : fecha_emision;
let confianza = num(d.confianza);
confianza = confianza === null ? 0 : Math.min(1, Math.max(0, confianza));
const tipo_gasto = ['puntual', 'suscripcion', 'contrato'].includes(d.tipo_gasto) ? d.tipo_gasto : 'puntual';
const PERIODOS = ['semanal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'];
const periodicidad = tipo_gasto !== 'puntual' && PERIODOS.includes(d.periodicidad) ? d.periodicidad : null;
const lineas = Array.isArray(d.lineas) ? d.lineas.slice(0, 40).map((l) => ({
  descripcion: txtOrNull(l && l.descripcion) || '',
  cantidad: num(l && l.cantidad),
  precio_unitario: num(l && l.precio_unitario),
  importe: num(l && l.importe),
})) : [];

// --- cliente: parámetro cliente_id > NIF del destinatario > «Personal» ---
const destinatario_nif = normalizarNif(txtOrNull(d.destinatario_nif));
const activos = clientes.filter((c) => c.activo !== false);
let cliente = null;
let asignacion = 'personal';
if (archivo.cliente_id) { cliente = clientes.find((c) => c.id === archivo.cliente_id) || null; asignacion = 'parametro'; }
if (!cliente && destinatario_nif) {
  cliente = activos.find((c) => normalizarNif(c.nif) === destinatario_nif) || null;
  if (cliente) asignacion = 'destinatario_nif';
}
if (!cliente) { cliente = clientes.find((c) => c.nombre === 'Personal') || activos.find((c) => c.regimen_iva === 'particular') || null; asignacion = 'personal'; }
const clienteId = cliente ? cliente.id : null;

// --- categoría: la regla (del cliente o global) prevalece sobre el LLM ---
let categoria = categorias.includes(d.categoria) ? d.categoria : 'Otros';
let subcategoria = txtOrNull(d.subcategoria);
let origen_categoria = 'llm';
const reglaCat = buscarRegla(reglas, proveedor_norm, clienteId, 'categoria');
if (reglaCat) {
  categoria = reglaCat.categoria;
  if (txtOrNull(reglaCat.subcategoria)) subcategoria = reglaCat.subcategoria;
  origen_categoria = 'regla';
}

// --- desglose: ticket con IVA incluido sin base ni cuota => base y cuota calculadas aquí a partir del tipo leído ---
// Propina / redondeo (ticket): importe sumado al total que no está en ninguna base de IVA; se trata como suplido para que Σ cuadre.
const propina = Math.max(0, num(d.propina_redondeo) || 0);
const suplidosLeidos = r2(cent(num(d.suplidos) || 0) + cent(propina));
const exentaLeida = num(d.base_exenta) || 0;
const crudo = Array.isArray(d.desglose_iva) ? d.desglose_iva : [];
const calculadas = [];
const desgloseLeido = crudo.map((l) => {
  const x = { base: num(l && l.base), tipo_iva: num(l && l.tipo_iva), cuota_iva: num(l && l.cuota_iva), tipo_re: num(l && l.tipo_re), cuota_re: num(l && l.cuota_re) };
  if (x.base === null && x.cuota_iva === null && x.tipo_iva !== null && x.tipo_iva > 0) {
    let conIva = num(l && l.importe_con_iva);
    if (conIva === null && crudo.length === 1 && total !== null) conIva = r2(cent(total) - cent(exentaLeida) - cent(suplidosLeidos));
    if (conIva !== null) {
      const tre = x.tipo_re || 0;
      const baseC = Math.round((cent(conIva) * 100) / (100 + x.tipo_iva + tre));
      const reC = tre ? Math.round((baseC * tre) / 100) : 0;
      x.base = r2(baseC);
      x.cuota_iva = r2(cent(conIva) - baseC - reC);
      if (tre) x.cuota_re = r2(reC);
      calculadas.push(x.tipo_iva);
    }
  }
  return x;
});

const fx = completarFiscal({
  nif: txtOrNull(d.nif), destinatario_nif, numero, categoria, tipo_factura: d.tipo_factura,
  desglose: desgloseLeido, base_exenta: exentaLeida, suplidos: suplidosLeidos,
  irpf_tipo: d.irpf_tipo, irpf_cuota: d.irpf_cuota, total, moneda: g.moneda, tipo_cambio: null,
  operacion: null, mencion: d.mencion_operacion, tipo_autorrepercusion: d.tipo_iva_autorrepercusion,
}, cliente, null);

// --- tipo de cambio (BCE) si la moneda no es EUR ---
if (fx.moneda !== 'EUR') {
  const resp = $input.first().json || {};
  const tc = tipoCambioBce(typeof resp.data === 'string' ? resp.data : null, g.bce.fecha);
  const c = aplicarCambio({ moneda: fx.moneda, total: fx.total }, tc);
  fx.tipo_cambio = c.tipo_cambio;
  fx.total_eur = c.total_eur;
}
const cuentas = resolverCuenta(proveedor_norm, categoria, clienteId, reglas, filasCategorias);

// --- validación (bloque común) + umbral de confianza (solo Ingesta) ---
const errores = validarFactura({
  proveedor, total: fx.total, desglose: fx.desglose, base_exenta: fx.base_exenta, suplidos: fx.suplidos,
  irpf_cuota: fx.irpf_cuota, total_a_pagar_leido: num(d.total_a_pagar), tipo_factura: fx.tipo_factura,
  fecha_emision, moneda: fx.moneda, total_eur: fx.total_eur,
}, hoy);
if (confianza < 0.75) errores.push(`Confianza de extracción baja (${confianza.toFixed(2)} < 0,75).`);
// Tickets: foto borrosa/torcida con importes ilegibles => revisar con motivo claro
const legibilidad = ['buena', 'dudosa', 'mala'].includes(d.legibilidad) ? d.legibilidad : 'buena';
if (legibilidad === 'mala') errores.push('Imagen borrosa, torcida o cortada: los importes no se leen con seguridad. Revisa el ticket y corrige los datos.');
const hora = typeof d.hora === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(d.hora.trim()) ? d.hora.trim().padStart(5, '0') : null;
let motivoTxt = txtOrNull(d.motivo);
if (propina > 0) motivoTxt = ((motivoTxt || '') + ` Incluye propina/redondeo de ${propina.toFixed(2).replace('.', ',')} €.`).trim();
if (legibilidad === 'dudosa') motivoTxt = ((motivoTxt || '') + ' Imagen de calidad dudosa: conviene comprobar los importes.').trim();

// --- pago: pagada si el documento lo dice o si el método implica cargo inmediato ---
const metodo_pago = normalizarMetodoPago(d.metodo_pago);
const CARGO = ['tarjeta', 'paypal', 'efectivo', 'bizum', 'domiciliación', 'domiciliacion'];
const vencida = fecha_vencimiento && fecha_vencimiento > hoy;
const pagada = d.pagada === true || (CARGO.includes(String(metodo_pago || '').toLowerCase()) && !vencida);

// --- ruta del original: AAAA/MM de la fecha de emisión (o de hoy si no es válida) ---
const fRuta = fecha_emision && fecha_emision <= hoy ? fecha_emision : hoy;
const archivo_ruta = `/home/node/.n8n-files/facturas/${fRuta.slice(0, 4)}/${fRuta.slice(5, 7)}/${archivo.hash}.${archivo.ext}`;

const fila = {
  usuario_id: 'default',
  hash_sha256: archivo.hash,
  archivo_ruta,
  archivo_nombre: archivo.archivo,
  mime: archivo.mime,
  proveedor,
  proveedor_norm,
  nif: fx.nif,
  numero,
  fecha_emision,
  fecha_vencimiento,
  lineas_json: JSON.stringify(lineas),
  base: fx.base,
  iva_tipo: fx.iva_tipo,
  iva_cuota: fx.iva_cuota,
  total: fx.total,
  moneda: fx.moneda,
  metodo_pago,
  categoria,
  subcategoria,
  tipo_gasto,
  periodicidad,
  confianza: Math.round(confianza * 100) / 100,
  motivo: motivoTxt,
  estado: errores.length ? 'revisar' : 'ok',
  errores_validacion: null,
  origen_categoria,
  creado: ahora,
  actualizado: ahora,
  cliente_id: clienteId,
  destinatario_nif: fx.destinatario_nif,
  tipo_factura: fx.tipo_factura,
  rectifica_numero: txtOrNull(d.rectifica_numero),
  fecha_operacion,
  operacion: fx.operacion,
  desglose_iva_json: fx.desglose_iva_json,
  base_exenta: fx.base_exenta,
  cuota_re: fx.cuota_re,
  irpf_tipo: fx.irpf_tipo,
  irpf_cuota: fx.irpf_cuota,
  suplidos: fx.suplidos,
  total_a_pagar: fx.total_a_pagar,
  cuota_autorrepercutida: fx.cuota_autorrepercutida,
  nif_valido: fx.nif_valido,
  deducible: fx.deducible,
  motivo_deducible: fx.motivo_deducible,
  cuota_deducible: fx.cuota_deducible,
  cuenta_gasto: cuentas.cuenta_gasto,
  cuenta_proveedor: cuentas.cuenta_proveedor,
  tipo_cambio: fx.tipo_cambio,
  total_eur: fx.total_eur,
  num_recepcion: null,
  estado_pago: pagada ? 'pagada' : 'pendiente',
  fecha_pago: pagada ? fecha_emision : null,
  movimiento_id: null,
  hora,
};

const extraccion = { modo: prep.modo, modelo: g.modelo, cliente: asignacion };
if (calculadas.length) extraccion.base_calculada = calculadas;
return [{ json: { _error: false, orden: archivo.orden, archivo: archivo.archivo, extraccion, errores, fila } }];
