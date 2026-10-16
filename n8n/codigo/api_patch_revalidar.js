// PATCH /facturas/:id, /facturas?id=N y /facturas/lote: lista blanca de campos,
// validación de tipos (400/422), recálculo fiscal y revalidación con el bloque
// COMÚN de la Ingesta, y fusión con la fila actual. En lote, cada factura se
// procesa por separado y los errores se devuelven por id.
const v = $('PATCH: validar id').isExecuted ? $('PATCH: validar id').first().json : $('Lote: validar').first().json;
const modo = v.modo;
const filas = $('PATCH: leer factura').all().map((i) => i.json).filter((x) => x && x.id !== undefined && x.id !== null && x.usuario_id === 'default');
const filasCategorias = $('PATCH: leer categorías').all().map((i) => i.json).filter((c) => c && c.nombre);
const categorias = filasCategorias.filter((c) => c.activa !== false).map((c) => c.nombre);
const clientes = $('PATCH: leer clientes').all().map((i) => i.json).filter((c) => c && c.id !== undefined && c.id !== null);
const reglas = $('PATCH: leer reglas').all().map((i) => i.json).filter((r) => r && r.proveedor_norm);
const bcePedido = $('PATCH: preparar cambio').first().json.bce;
const bceCsv = bcePedido ? (($input.first().json || {}).data ?? null) : null;

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

const hoy = $now.setZone('Europe/Madrid').toISODate();
const ahora = $now.setZone('Europe/Madrid').toISO();
const TIPOS = ['puntual', 'suscripcion', 'contrato'];
const PERIODOS = ['semanal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'];
const ESTADOS = ['ok', 'revisar', 'duplicada', 'posible_duplicada'];
const ESTADOS_PAGO = ['pendiente', 'pagada'];
const PERMITIDOS = ['proveedor', 'nif', 'numero', 'fecha_emision', 'fecha_vencimiento', 'base', 'iva_tipo', 'iva_cuota', 'total', 'moneda', 'metodo_pago', 'categoria', 'subcategoria', 'tipo_gasto', 'periodicidad', 'estado',
  'cliente_id', 'tipo_factura', 'rectifica_numero', 'fecha_operacion', 'operacion', 'desglose_iva_json', 'base_exenta', 'irpf_tipo', 'irpf_cuota', 'suplidos', 'cuenta_gasto', 'cuenta_proveedor', 'deducible', 'estado_pago', 'fecha_pago'];
const COLUMNAS = ['usuario_id', 'hash_sha256', 'archivo_ruta', 'archivo_nombre', 'mime', 'proveedor', 'proveedor_norm', 'nif', 'numero', 'fecha_emision', 'fecha_vencimiento', 'lineas_json', 'base', 'iva_tipo', 'iva_cuota', 'total', 'moneda', 'metodo_pago', 'categoria', 'subcategoria', 'tipo_gasto', 'periodicidad', 'confianza', 'motivo', 'estado', 'errores_validacion', 'origen_categoria', 'creado', 'actualizado',
  'cliente_id', 'destinatario_nif', 'tipo_factura', 'rectifica_numero', 'fecha_operacion', 'operacion', 'desglose_iva_json', 'base_exenta', 'cuota_re', 'irpf_tipo', 'irpf_cuota', 'suplidos', 'total_a_pagar', 'cuota_autorrepercutida', 'nif_valido', 'deducible', 'motivo_deducible', 'cuota_deducible', 'cuenta_gasto', 'cuenta_proveedor', 'tipo_cambio', 'total_eur', 'num_recepcion', 'estado_pago', 'fecha_pago', 'movimiento_id'];

// Desglose guardado (o, en filas antiguas, el que sale de base/iva_tipo/iva_cuota).
const desgloseDe = (f) => {
  try {
    const d = JSON.parse(f.desglose_iva_json);
    if (Array.isArray(d)) return d;
  } catch (e) { /* fila antigua */ }
  return f.base === null || f.base === undefined ? [] : [{ base: f.base, tipo_iva: f.iva_tipo, cuota_iva: f.iva_cuota, tipo_re: 0, cuota_re: 0 }];
};

// Procesa una petición sobre la fila actual. Devuelve {ok, status, error, detalles} o {ok, fila, factura, regla, revalidacion}.
const procesar = (id, cuerpo, enLote) => {
  const malo = (status, error, detalles) => ({ ok: false, status, error, detalles });
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return malo(400, 'El cuerpo debe ser un objeto JSON con los campos a corregir.', []);
  const claves = Object.keys(cuerpo);
  const noPermitidos = claves.filter((k) => !PERMITIDOS.includes(k));
  if (noPermitidos.length) return malo(400, 'Campos no permitidos.', [`No se pueden modificar: ${noPermitidos.join(', ')}. Permitidos: ${PERMITIDOS.join(', ')}.`]);
  if (!claves.length) return malo(400, 'No hay campos que modificar.', []);
  const actual = filas.find((x) => x.id === id);
  if (!actual) return { ok: false, status: 404, error: 'Factura no encontrada.', id };

  const errTipos = [];
  const c = {};
  const comoTexto = (k, { nulo = true, max = 300 } = {}) => {
    const val = cuerpo[k];
    if (val === null || (typeof val === 'string' && !val.trim())) {
      if (nulo) c[k] = null; else errTipos.push(`"${k}" no puede estar vacío.`);
      return;
    }
    if (typeof val !== 'string') { errTipos.push(`"${k}" debe ser texto.`); return; }
    if (val.trim().length > max) { errTipos.push(`"${k}" admite como máximo ${max} caracteres.`); return; }
    c[k] = val.trim();
  };
  const esNumero = (val) => (typeof val === 'number' ? Number.isFinite(val) : typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim()));
  const comoImporte = (k, { nulo = true } = {}) => {
    const val = cuerpo[k];
    if (val === null) { if (nulo) c[k] = null; else errTipos.push(`"${k}" no puede ser nulo.`); return; }
    if (!esNumero(val)) { errTipos.push(`"${k}" debe ser un número (punto decimal).`); return; }
    c[k] = Math.round(Number(val) * 100) / 100;
  };
  const comoFecha = (k, { nulo = true } = {}) => {
    const val = cuerpo[k];
    if (val === null) { if (nulo) c[k] = null; else errTipos.push(`"${k}" no puede ser nulo.`); return; }
    if (!fechaValida(val)) { errTipos.push(`"${k}" debe ser una fecha AAAA-MM-DD válida.`); return; }
    c[k] = val;
  };
  const comoEnum = (k, valores, { nulo = false } = {}) => {
    const val = cuerpo[k];
    if (val === null && nulo) { c[k] = null; return; }
    if (!valores.includes(val)) { errTipos.push(`"${k}" debe ser uno de: ${valores.join(', ')}${nulo ? ' o null' : ''}.`); return; }
    c[k] = val;
  };
  const comoCuenta = (k) => {
    const val = cuerpo[k];
    if (typeof val !== 'string' || !/^\d{3,12}$/.test(val.trim())) { errTipos.push(`"${k}" debe ser una cuenta del PGC (solo dígitos, de 3 a 12).`); return; }
    c[k] = val.trim();
  };

  if ('proveedor' in cuerpo) comoTexto('proveedor', { nulo: false, max: 200 });
  if ('nif' in cuerpo) { comoTexto('nif', { max: 30 }); if (c.nif) c.nif = normalizarNif(c.nif); }
  if ('numero' in cuerpo) comoTexto('numero', { max: 100 });
  if ('fecha_emision' in cuerpo) comoFecha('fecha_emision', { nulo: false });
  if ('fecha_vencimiento' in cuerpo) comoFecha('fecha_vencimiento');
  if ('fecha_operacion' in cuerpo) comoFecha('fecha_operacion');
  for (const k of ['base', 'iva_tipo', 'iva_cuota', 'base_exenta', 'irpf_tipo', 'irpf_cuota', 'suplidos']) if (k in cuerpo) comoImporte(k);
  if ('total' in cuerpo) comoImporte('total', { nulo: false });
  if ('moneda' in cuerpo) {
    const val = cuerpo.moneda;
    if (typeof val !== 'string' || !/^[A-Za-z]{3}$/.test(val.trim())) errTipos.push('"moneda" debe ser un código ISO 4217 de 3 letras (p. ej. EUR).');
    else c.moneda = val.trim().toUpperCase();
  }
  if ('metodo_pago' in cuerpo) { comoTexto('metodo_pago', { max: 50 }); if (c.metodo_pago) c.metodo_pago = normalizarMetodoPago(c.metodo_pago); }
  if ('categoria' in cuerpo) {
    if (typeof cuerpo.categoria !== 'string' || !categorias.includes(cuerpo.categoria)) errTipos.push('"categoria" debe ser una categoría activa de fact_categorias (GET /categorias).');
    else c.categoria = cuerpo.categoria;
  }
  if ('subcategoria' in cuerpo) comoTexto('subcategoria', { max: 100 });
  if ('tipo_gasto' in cuerpo) comoEnum('tipo_gasto', TIPOS);
  if ('periodicidad' in cuerpo) comoEnum('periodicidad', PERIODOS, { nulo: true });
  if ('estado' in cuerpo) {
    if (cuerpo.estado === 'borrada' && !enLote) errTipos.push('"estado" no puede ser "borrada": usa DELETE /facturas/:id.');
    else comoEnum('estado', enLote ? [...ESTADOS, 'borrada'] : ESTADOS);
  }
  if ('cliente_id' in cuerpo) {
    const n = typeof cuerpo.cliente_id === 'number' ? cuerpo.cliente_id : (typeof cuerpo.cliente_id === 'string' && /^\d+$/.test(cuerpo.cliente_id.trim()) ? Number(cuerpo.cliente_id) : NaN);
    if (!clientes.some((x) => x.id === n && x.activo !== false)) errTipos.push('"cliente_id" debe ser el id de un cliente activo (GET /clientes).');
    else c.cliente_id = n;
  }
  if ('tipo_factura' in cuerpo) comoEnum('tipo_factura', TIPOS_FACTURA);
  if ('rectifica_numero' in cuerpo) comoTexto('rectifica_numero', { max: 100 });
  if ('operacion' in cuerpo) comoEnum('operacion', OPERACIONES, { nulo: true });
  if ('desglose_iva_json' in cuerpo) {
    let arr = cuerpo.desglose_iva_json;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = undefined; } }
    if (!Array.isArray(arr) || arr.length > 10) errTipos.push('"desglose_iva_json" debe ser una lista (o su JSON) de hasta 10 líneas {base, tipo_iva, cuota_iva, tipo_re?, cuota_re?}.');
    else {
      const malas = arr.filter((l) => !l || typeof l !== 'object' || !esNumero(l.base) || !esNumero(l.tipo_iva) || !esNumero(l.cuota_iva)
        || (l.tipo_re !== undefined && l.tipo_re !== null && !esNumero(l.tipo_re)) || (l.cuota_re !== undefined && l.cuota_re !== null && !esNumero(l.cuota_re)));
      if (malas.length) errTipos.push('"desglose_iva_json": cada línea necesita base, tipo_iva y cuota_iva numéricos (punto decimal); tipo_re y cuota_re, numéricos o null.');
      else c.desglose = arr.map((l) => ({ base: num(Number(l.base)), tipo_iva: num(Number(l.tipo_iva)), cuota_iva: num(Number(l.cuota_iva)), tipo_re: num(l.tipo_re === null || l.tipo_re === undefined ? 0 : Number(l.tipo_re)), cuota_re: num(l.cuota_re === null || l.cuota_re === undefined ? 0 : Number(l.cuota_re)) }));
    }
  }
  if ('cuenta_gasto' in cuerpo) comoCuenta('cuenta_gasto');
  if ('cuenta_proveedor' in cuerpo) comoCuenta('cuenta_proveedor');
  if ('deducible' in cuerpo) comoEnum('deducible', DEDUCIBLES, { nulo: true });
  if ('estado_pago' in cuerpo) comoEnum('estado_pago', ESTADOS_PAGO);
  if ('fecha_pago' in cuerpo) comoFecha('fecha_pago');
  if (errTipos.length) return malo(422, 'Datos no válidos.', errTipos);

  // --- fusión ---
  const nueva = { ...actual };
  for (const k of Object.keys(c)) if (k !== 'desglose') nueva[k] = c[k];
  if (nueva.tipo_gasto === 'puntual') nueva.periodicidad = null;
  else if ('periodicidad' in c && c.periodicidad === null) errTipos.push('Una suscripción o contrato necesita "periodicidad".');
  if ('proveedor' in c) nueva.proveedor_norm = normalizarProveedor(nueva.proveedor);

  // Desglose: el enviado; o, si se corrigen base/iva_tipo/iva_cuota, el de una sola línea.
  let desglose = desgloseDe(actual);
  let baseExenta = 'base_exenta' in c ? (c.base_exenta || 0) : (num(actual.base_exenta) || 0);
  if (c.desglose) desglose = c.desglose;
  else if ('base' in c || 'iva_tipo' in c || 'iva_cuota' in c) {
    if (desglose.length > 1) errTipos.push('La factura tiene varios tipos de IVA: corrige "desglose_iva_json" en lugar de base/iva_tipo/iva_cuota.');
    else {
      const l = desglose[0] || null;
      const nb = 'base' in c ? c.base : actual.base;
      const nt = 'iva_tipo' in c ? c.iva_tipo : (l ? l.tipo_iva : actual.iva_tipo);
      const nc = 'iva_cuota' in c ? c.iva_cuota : (l ? l.cuota_iva : actual.iva_cuota);
      if ((nt !== null && nt !== 0) || (nc !== null && nc !== 0)) {
        desglose = [{ base: nb === null || nb === undefined ? null : r2(cent(nb) - cent(baseExenta)), tipo_iva: nt, cuota_iva: nc, tipo_re: l ? l.tipo_re : 0, cuota_re: l ? l.cuota_re : 0 }];
      } else { desglose = []; baseExenta = nb === null || nb === undefined ? 0 : nb; }
    }
  }
  if (nueva.estado_pago === 'pendiente' && 'estado_pago' in c && 'fecha_pago' in c && c.fecha_pago) errTipos.push('Una factura pendiente no puede tener "fecha_pago".');
  if (errTipos.length) return malo(422, 'Datos no válidos.', errTipos);

  // Pago: pagada sin fecha => hoy; pendiente => sin fecha; fecha sin estado => pagada.
  if ('estado_pago' in c) {
    if (c.estado_pago === 'pagada' && !('fecha_pago' in c) && !actual.fecha_pago) nueva.fecha_pago = hoy;
    if (c.estado_pago === 'pendiente') nueva.fecha_pago = null;
  } else if ('fecha_pago' in c) nueva.estado_pago = c.fecha_pago ? 'pagada' : 'pendiente';

  // Cliente (y nº de recepción si cambia de cliente)
  const cliente = clientes.find((x) => x.id === nueva.cliente_id) || clientes.find((x) => x.nombre === 'Personal') || null;
  const cambioCliente = 'cliente_id' in c && c.cliente_id !== actual.cliente_id;
  if (cambioCliente) {
    const anio = (fechaValida(nueva.fecha_emision) && nueva.fecha_emision <= hoy ? nueva.fecha_emision : hoy).slice(0, 4);
    nueva.num_recepcion = siguienteRecepcion(filas, nueva.cliente_id, anio);
  }

  // Deducible forzado a mano (se conserva en siguientes correcciones hasta enviar deducible: null).
  let forzado = null;
  if ('deducible' in c) forzado = c.deducible ? { deducible: c.deducible, motivo: 'Manual: marcado a mano.' } : null;
  else if (typeof actual.motivo_deducible === 'string' && actual.motivo_deducible.startsWith('Manual')) forzado = { deducible: actual.deducible, motivo: actual.motivo_deducible };

  // Tipo de cambio: el nuevo del BCE si se pidió; si no, el guardado.
  let tipoCambio = typeof actual.tipo_cambio === 'number' ? actual.tipo_cambio : null;
  if (bcePedido && !enLote) tipoCambio = tipoCambioBce(typeof bceCsv === 'string' ? bceCsv : null, bcePedido.fecha);

  const recalcIrpf = 'irpf_tipo' in c && !('irpf_cuota' in c);
  const fx = completarFiscal({
    nif: nueva.nif, destinatario_nif: nueva.destinatario_nif, numero: nueva.numero, categoria: nueva.categoria,
    tipo_factura: nueva.tipo_factura, desglose, base_exenta: baseExenta, suplidos: nueva.suplidos,
    irpf_tipo: nueva.irpf_tipo, irpf_cuota: recalcIrpf ? null : nueva.irpf_cuota, total: nueva.total,
    moneda: nueva.moneda || 'EUR', tipo_cambio: tipoCambio, operacion: nueva.operacion || null, mencion: null, tipo_autorrepercusion: null,
  }, cliente, forzado);
  for (const k of ['nif', 'destinatario_nif', 'tipo_factura', 'operacion', 'desglose_iva_json', 'base_exenta', 'base', 'iva_tipo', 'iva_cuota', 'cuota_re', 'irpf_tipo', 'irpf_cuota', 'suplidos', 'total', 'total_a_pagar', 'cuota_autorrepercutida', 'nif_valido', 'moneda', 'tipo_cambio', 'total_eur', 'deducible', 'motivo_deducible', 'cuota_deducible']) nueva[k] = fx[k];
  if (!nueva.fecha_operacion || ('fecha_emision' in c && actual.fecha_operacion === actual.fecha_emision && !('fecha_operacion' in c))) nueva.fecha_operacion = nueva.fecha_emision;

  // Cuentas: la enviada; si cambia la categoría o el cliente, regla (cliente > global) > categoría > 629.
  const cambioCategoria = 'categoria' in c && c.categoria !== actual.categoria;
  if ('cuenta_gasto' in c) nueva.cuenta_gasto = c.cuenta_gasto;
  else if (cambioCategoria || cambioCliente || !nueva.cuenta_gasto) nueva.cuenta_gasto = resolverCuenta(nueva.proveedor_norm, nueva.categoria, nueva.cliente_id, reglas, filasCategorias).cuenta_gasto;
  if ('cuenta_proveedor' in c) nueva.cuenta_proveedor = c.cuenta_proveedor;
  else if ('cuenta_gasto' in c || cambioCategoria || cambioCliente || !nueva.cuenta_proveedor) nueva.cuenta_proveedor = cuentaProveedor(nueva.cuenta_gasto);

  // Revalidación (sin el umbral de confianza: la corrección manual sustituye a la lectura).
  const previo = actual.estado;
  let errores = [];
  if (nueva.estado === 'borrada' && 'estado' in c) {
    nueva.errores_validacion = actual.errores_validacion;
  } else {
    errores = validarFactura({ proveedor: nueva.proveedor, total: nueva.total, desglose: fx.desglose, base_exenta: fx.base_exenta, suplidos: fx.suplidos, irpf_cuota: fx.irpf_cuota, tipo_factura: fx.tipo_factura, fecha_emision: nueva.fecha_emision, moneda: fx.moneda, total_eur: fx.total_eur }, hoy);
    if (errores.length) {
      nueva.estado = 'revisar';
      nueva.errores_validacion = errores.join(' | ');
    } else {
      if ('estado' in c) nueva.estado = c.estado;
      else if (previo === 'revisar' || previo === 'borrada') nueva.estado = previo === 'borrada' ? 'borrada' : 'ok';
      const dup = nueva.estado === 'posible_duplicada'
        ? String(actual.errores_validacion || '').split(' | ').filter((m) => m.startsWith('Posible duplicada'))
        : [];
      nueva.errores_validacion = dup.length ? dup.join(' | ') : null;
    }
  }

  if (cambioCategoria || ('subcategoria' in c && c.subcategoria !== actual.subcategoria)) nueva.origen_categoria = 'manual';
  nueva.actualizado = ahora;

  const fila = {};
  for (const k of COLUMNAS) fila[k] = nueva[k] === undefined ? null : nueva[k];

  // Regla aprendida (PATCH de una factura y de un lote): categoría y/o cuenta del proveedor para el cliente.
  let regla = null;
  if (nueva.proveedor_norm && (cambioCategoria || ('cuenta_gasto' in c && c.cuenta_gasto !== actual.cuenta_gasto))) {
    regla = { proveedor_norm: nueva.proveedor_norm, cliente_id: nueva.cliente_id ?? null };
    if (cambioCategoria) { regla.categoria = nueva.categoria; regla.subcategoria = nueva.subcategoria ?? null; }
    if ('cuenta_gasto' in c) regla.cuenta_gasto = c.cuenta_gasto;
    // Suministros (Luz, Gas, Agua, Telefonía e internet): el tipo se decide por el CONTENIDO de la factura, no por el proveedor
    // (Endesa, Iberdrola o Energía XXI venden luz y gas), así que no se aprende regla de categoría; solo la cuenta si se envió.
    if (regla.categoria !== undefined && ['Luz', 'Gas', 'Agua', 'Telefonía e internet'].includes(regla.categoria)) {
      delete regla.categoria; delete regla.subcategoria;
      if (!('cuenta_gasto' in regla)) regla = null;
    }
  }
  // La fila en memoria se actualiza para que el siguiente del lote vea el nº de recepción asignado.
  const idx = filas.indexOf(actual);
  if (idx >= 0) filas[idx] = { ...nueva };
  return { ok: true, id, fila, factura: { ...nueva }, regla, revalidacion: { estado_anterior: previo, estado: nueva.estado, errores } };
};

if (modo === 'uno') {
  const r = procesar(v.id, v.body, false);
  if (!r.ok) return [{ json: { _error: true, status: r.status, body: r.status === 404 ? { error: r.error, id: r.id } : { error: r.error, detalles: r.detalles } } }];
  return [{ json: { _error: false, modo, id: r.id, fila: r.fila, factura: r.factura, regla: r.regla, revalidacion: r.revalidacion } }];
}

// Lote
const errores_lote = [];
const reglasLote = new Map();
const salida = [];
for (const p of v.peticiones) {
  const r = procesar(p.id, p.cuerpo, true);
  if (!r.ok) errores_lote.push({ id: p.id, error: r.detalles && r.detalles.length ? `${r.error} ${r.detalles.join(' ')}` : r.error });
  else {
    salida.push({ json: { _error: false, modo, id: r.id, fila: r.fila, factura: r.factura, regla: null, revalidacion: r.revalidacion, errores_lote } });
    // Una sola regla por (cliente, proveedor) aunque haya varias facturas del proveedor en el lote.
    if (r.regla) {
      const clave = `${r.regla.cliente_id ?? ''}|${r.regla.proveedor_norm}`;
      reglasLote.set(clave, { ...(reglasLote.get(clave) || {}), ...r.regla });
    }
  }
}
if (!salida.length) return [{ json: { _error: true, status: 200, body: { actualizadas: 0, errores: errores_lote, reglas: 0 } } }];
const reglas_lote = [...reglasLote.values()];
for (const s of salida) s.json.reglas_lote = reglas_lote;
return salida;
