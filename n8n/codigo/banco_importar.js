// POST /banco/importar (multipart: «extracto» = fichero Norma 43 o CSV; «cliente_id»).
// Norma 43 según «Información normalizada de cuenta corriente», AEB, Serie normas y procedimientos bancarios
// nº 43 (junio 2012): registros de 80 posiciones 11 (cabecera de cuenta), 22 (movimiento), 23 (complementarios
// de concepto, hasta 5), 24 (equivalencia de divisa), 33 (final de cuenta) y 88 (fin de fichero).
// CSV genérico: separador «;» o «,», columnas fecha, concepto e importe (o cargo/abono), coma o punto decimal,
// fechas dd/mm/aaaa, dd-mm-aaaa, dd/mm/aa o aaaa-mm-dd. No se registra el contenido del extracto.
const crypto = require('crypto');
const MAX_BYTES = 5 * 1024 * 1024;
const entrada = $input.first();
const cuerpo = entrada.json && entrada.json.body && typeof entrada.json.body === 'object' ? entrada.json.body : {};
const query = entrada.json && entrada.json.query && typeof entrada.json.query === 'object' ? entrada.json.query : {};
const fallo = (status, error, detalles) => [{ json: { ruta: 'importar', _error: true, status, body: detalles ? { error, detalles } : { error } } }];
const crudo = cuerpo.cliente_id ?? query.cliente_id;
const txtCliente = crudo === undefined || crudo === null ? '' : String(Array.isArray(crudo) ? crudo[0] : crudo).trim();
if (!/^\d{1,12}$/.test(txtCliente)) return fallo(400, '"cliente_id" es obligatorio y debe ser un entero positivo (campo multipart o query).');
const cliente_id = Number(txtCliente);
const claves = Object.keys(entrada.binary || {});
const clave = claves.find((k) => k.startsWith('extracto')) || claves[0];
if (!clave) return fallo(400, 'No se ha recibido ningún fichero: envía el extracto en el campo multipart «extracto».');
const buf = await this.helpers.getBinaryDataBuffer(0, clave);
if (!buf.length) return fallo(400, 'El extracto está vacío.');
if (buf.length > MAX_BYTES) return fallo(400, 'El extracto ocupa más de 5 MB.');

// Texto: UTF-8 si es válido; si no, página de códigos 850 (la que pide la norma) o Latin-1.
let texto;
try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) {
  const CP850 = { 0x80: 'Ç', 0x81: 'ü', 0x82: 'é', 0x87: 'ç', 0x90: 'É', 0x9a: 'Ü', 0xa0: 'á', 0xa1: 'í', 0xa2: 'ó', 0xa3: 'ú', 0xa4: 'ñ', 0xa5: 'Ñ', 0xa6: 'ª', 0xa7: 'º', 0xb5: 'Á', 0xd6: 'Í', 0xe0: 'Ó', 0xe9: 'Ú' };
  const esCp850 = buf.includes(0xa5) || buf.includes(0xa4) ? !(buf.includes(0xd1) || buf.includes(0xf1)) : false;
  texto = Array.from(buf).map((b) => (b < 0x80 ? String.fromCharCode(b) : esCp850 && CP850[b] ? CP850[b] : esCp850 ? '?' : String.fromCharCode(b))).join('');
}
texto = texto.replace(/^﻿/, '');
const errores = [];
const avisos = [];
const movimientos = [];
const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
let lineas = texto.split(/\r?\n|\r/).filter((l) => l.trim() !== '');
const esN43 = lineas.length > 0 && /^11\d{18}/.test(lineas[0]) && (lineas.some((l) => l.startsWith('88')) || lineas.some((l) => l.startsWith('33')));
const formato = esN43 ? 'n43' : 'csv';

if (esN43) {
  if (lineas.length === 1 && lineas[0].length > 80) lineas = lineas[0].match(/.{1,80}/g); // sin saltos de línea
  const CONCEPTOS = { '01': 'Talones - reintegros', '02': 'Abonarés - entregas - ingresos', '03': 'Domiciliados - recibos - letras - pagos por su cuenta', '04': 'Giros - transferencias - traspasos - cheques',
    '05': 'Amortizaciones préstamos, créditos', '06': 'Remesas efectos', '07': 'Suscripciones - div. pasivos - canjes', '08': 'Div. cupones - prima junta - amortizaciones', '09': 'Operaciones de bolsa',
    '10': 'Cheques gasolina', '11': 'Cajero automático', '12': 'Tarjetas de crédito - débito', '13': 'Operaciones extranjero', '14': 'Devoluciones e impagados', '15': 'Nóminas - seguros sociales',
    '16': 'Timbres - corretaje - póliza', '17': 'Intereses - comisiones - custodia - gastos e impuestos', '98': 'Anulaciones - correcciones asiento', '99': 'Varios' };
  const aaMmDd = (s) => { const f = `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`; return fechaValida(f) ? f : null; };
  let cuenta = '';
  let actual = null;
  let cuentaDebe = { n: 0, c: 0 };
  let cuentaHaber = { n: 0, c: 0 };
  let registros = 0;
  const cerrar = () => { if (actual) { movimientos.push(actual); actual = null; } };
  lineas.forEach((l0, i) => {
    const l = l0.replace(/\s+$/, '').padEnd(80, ' ');
    const tipo = l.slice(0, 2);
    const n = i + 1;
    if (tipo !== '88') registros += 1;
    if (tipo === '11') {
      cerrar();
      cuenta = l.slice(2, 20);
      cuentaDebe = { n: 0, c: 0 }; cuentaHaber = { n: 0, c: 0 };
      if (l.slice(47, 50) !== '978') avisos.push(`Cuenta ${cuenta}: divisa ${l.slice(47, 50)} distinta del euro (978); los importes se toman tal cual.`);
    } else if (tipo === '22') {
      cerrar();
      const fecha = aaMmDd(l.slice(10, 16));
      const fechaValor = aaMmDd(l.slice(16, 22));
      const dh = l.slice(27, 28);
      const importe = l.slice(28, 42);
      if (!fecha || !/^\d{14}$/.test(importe) || !['1', '2'].includes(dh)) { errores.push({ linea: n, error: 'Registro 22 con fecha, signo o importe no válido.' }); return; }
      const c = Number(importe) * (dh === '1' ? -1 : 1);
      if (dh === '1') { cuentaDebe.n += 1; cuentaDebe.c += Number(importe); } else { cuentaHaber.n += 1; cuentaHaber.c += Number(importe); }
      const ref2 = l.slice(64, 80).trim();
      const ref1 = l.slice(52, 64).replace(/^0+/, '').trim();
      const doc = l.slice(42, 52).replace(/^0+/, '').trim();
      actual = { cuenta, fecha, fecha_valor: fechaValor, importeC: c, referencia: ref2 || ref1 || doc || null, partes: [], comun: l.slice(22, 24) };
    } else if (tipo === '23') {
      if (!actual) { errores.push({ linea: n, error: 'Registro 23 sin movimiento 22 previo.' }); return; }
      actual.partes.push(l.slice(4, 42) + l.slice(42, 80)); // los dos campos de 38 posiciones son texto continuo
    } else if (tipo === '24') {
      // equivalencia de importe en otra divisa: sin valor contable
    } else if (tipo === '33') {
      cerrar();
      const nD = Number(l.slice(20, 25)); const tD = Number(l.slice(25, 39)); const nH = Number(l.slice(39, 44)); const tH = Number(l.slice(44, 58));
      if (nD !== cuentaDebe.n || tD !== cuentaDebe.c || nH !== cuentaHaber.n || tH !== cuentaHaber.c) avisos.push(`Cuenta ${l.slice(2, 20)}: los totales del registro 33 no coinciden con los movimientos leídos.`);
    } else if (tipo === '88') {
      cerrar();
      const declarado = Number(l.slice(20, 26));
      if (declarado !== registros) avisos.push(`El registro 88 declara ${declarado} registros y el fichero tiene ${registros}.`);
    } else {
      errores.push({ linea: n, error: `Tipo de registro «${tipo}» desconocido.` });
    }
  });
  cerrar();
  movimientos.forEach((m) => {
    m.concepto = m.partes.join(' ').replace(/\s+/g, ' ').trim() || CONCEPTOS[m.comun] || `Concepto común ${m.comun}`;
    delete m.partes; delete m.comun;
  });
} else {
  // ---- CSV genérico ----
  const cab0 = lineas[0] || '';
  const cuenta = (s) => (cab0.match(new RegExp(s === '\t' ? '\t' : '\\' + s, 'g')) || []).length;
  const sep = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const partir = (linea) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < linea.length; i += 1) {
      const ch = linea[i];
      if (q) { if (ch === '"' && linea[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cab = partir(cab0).map(norm);
  const buscar = (...pruebas) => { for (const p of pruebas) { const i = cab.findIndex((h) => p(h)); if (i >= 0) return i; } return -1; };
  const iValor = buscar((h) => h === 'fecha valor' || h === 'f valor' || h === 'valor');
  const iFecha = buscar((h) => h === 'fecha', (h) => h.startsWith('fecha') && !h.includes('valor'), (h) => h === 'date' || h.includes('f operacion'));
  const iConcepto = buscar((h) => h === 'concepto', (h) => h.includes('concepto') || h.includes('descripcion') || h.includes('detalle') || h.includes('movimiento') || h === 'description');
  const iImporte = buscar((h) => h === 'importe', (h) => h.startsWith('importe') || h === 'cantidad' || h === 'amount');
  const iCargo = buscar((h) => h === 'cargo' || h === 'cargos' || h === 'debe');
  const iAbono = buscar((h) => h === 'abono' || h === 'abonos' || h === 'haber');
  const iRef = buscar((h) => h.startsWith('referencia') || h === 'ref');
  const iCuenta = buscar((h) => h === 'cuenta' || h === 'iban');
  if (iFecha < 0 || iConcepto < 0 || (iImporte < 0 && (iCargo < 0 || iAbono < 0))) {
    return fallo(400, 'No se reconoce el extracto: debe ser Norma 43 o un CSV con cabecera y columnas fecha, concepto e importe (o cargo y abono).');
  }
  const leerFecha = (s) => {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return fechaValida(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
    m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (!m) return null;
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const f = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return fechaValida(f) ? f : null;
  };
  const leerImporte = (s) => {
    let t = String(s || '').replace(/[\s€]/g, '').replace(/^\+/, '');
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t.startsWith('-') || t.startsWith('−')) { neg = !neg; t = t.slice(1); }
    if (t.endsWith('-')) { neg = !neg; t = t.slice(0, -1); }
    if (!/^[\d.,]+$/.test(t)) return null;
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (t.includes(',')) t = (t.match(/,/g).length > 1 ? t.replace(/,/g, '') : t.replace(',', '.'));
    else if (/^\d{1,3}(\.\d{3})+$/.test(t) && (sep === ';' || t.split('.').length > 2)) t = t.replace(/\./g, '');
    const v = Number(t);
    return Number.isFinite(v) ? Math.round(v * 100) * (neg ? -1 : 1) : null;
  };
  lineas.slice(1).forEach((l, i) => {
    const n = i + 2;
    const c = partir(l);
    const fecha = leerFecha(c[iFecha]);
    let importeC = iImporte >= 0 ? leerImporte(c[iImporte]) : null;
    if (iImporte < 0) {
      const cargo = leerImporte(c[iCargo]) || 0; const abono = leerImporte(c[iAbono]) || 0;
      importeC = (c[iCargo] || c[iAbono]) ? abono - Math.abs(cargo) : null;
    }
    const concepto = (c[iConcepto] || '').replace(/\s+/g, ' ').trim();
    if (!fecha) { errores.push({ linea: n, error: 'Fecha no válida (dd/mm/aaaa o aaaa-mm-dd).' }); return; }
    if (importeC === null) { errores.push({ linea: n, error: 'Importe no válido.' }); return; }
    movimientos.push({ cuenta: iCuenta >= 0 ? (c[iCuenta] || '').replace(/\s+/g, '') : '', fecha, fecha_valor: iValor >= 0 ? leerFecha(c[iValor]) : null,
      concepto: concepto || '(sin concepto)', importeC, referencia: iRef >= 0 ? (c[iRef] || null) : null });
  });
}
if (!movimientos.length) return fallo(400, 'El extracto no contiene movimientos válidos.', errores.slice(0, 20));
// Hash de deduplicación: cliente|cuenta|fecha|importe|concepto|referencia|ordinal de repetición en el fichero.
const vistos = {};
for (const m of movimientos) {
  const base = [cliente_id, m.cuenta || '', m.fecha, m.importeC, String(m.concepto).toLowerCase().replace(/\s+/g, ' '), m.referencia || ''].join('|');
  vistos[base] = (vistos[base] || 0) + 1;
  m.hash = crypto.createHash('sha256').update(base + '|' + vistos[base]).digest('hex');
}
return [{ json: { ruta: 'importar', _error: false, cliente_id, formato, movimientos, errores: errores.slice(0, 50), avisos } }];
