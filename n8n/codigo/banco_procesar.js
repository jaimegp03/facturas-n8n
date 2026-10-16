// FACT — Banco: importar (dedupe por hash + sugerencias), listar movimientos con sugerencia y conciliar.
// Sugerencia = la mejor factura pendiente del cliente con importe = −total_a_pagar en EUR (±0,01) y fecha del
// movimiento ≥ fecha de emisión; confianza 0,6 + 0,25 si el concepto contiene el proveedor + 0,15 si contiene el número.
const p = $('Importar: leer extracto').isExecuted ? $('Importar: leer extracto').first().json : $('Banco: parámetros').first().json;
const ahora = $now.setZone('Europe/Madrid').toISO();
const clientes = $('Leer clientes').all().map((i) => i.json).filter((c) => c && c.id !== undefined && c.id !== null);
const facturas = $('Leer facturas').all().map((i) => i.json).filter((f) => f && f.id !== undefined && f.id !== null && f.usuario_id === 'default');
const movs = $('Leer movimientos').all().map((i) => i.json).filter((m) => m && m.id !== undefined && m.id !== null);
const res = (status, body, extra) => [{ json: { ruta: p.ruta, status, body, ...(extra || {}) } }];
const cent = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : 0);
const r2 = (c) => Math.round(c) / 100;
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SUFIJOS = new Set(['sa', 'sau', 'sl', 'slu', 'sll', 'slne', 'scoop', 'sc', 'cb', 'bv', 'nv', 'ab', 'ltd', 'limited', 'inc', 'llc', 'gmbh', 'ag', 'plc', 'corp', 'spa', 'srl', 'sas', 'sarl', 'test', 'de', 'del', 'la', 'las', 'los', 'y', 'e', 'hijos']);
const aPagarEur = (f) => {
  const tc = !f.moneda || f.moneda === 'EUR' ? 1 : (typeof f.tipo_cambio === 'number' && f.tipo_cambio > 0 ? f.tipo_cambio : null);
  const v = typeof f.total_a_pagar === 'number' ? f.total_a_pagar : f.total;
  return tc === null || typeof v !== 'number' ? null : Math.round(cent(v) * tc);
};
const totalEur = (f) => (typeof f.total_eur === 'number' ? cent(f.total_eur) : (!f.moneda || f.moneda === 'EUR') && typeof f.total === 'number' ? cent(f.total) : null);
const pendientes = (clienteId, excluirMov) => facturas.filter((f) => f.cliente_id === clienteId && ['ok', 'revisar', 'posible_duplicada'].includes(f.estado)
  && f.estado_pago !== 'pagada' && (f.movimiento_id === null || f.movimiento_id === undefined || f.movimiento_id === excluirMov) && aPagarEur(f) !== null);
const candidatos = (m, lista) => {
  const conc = ' ' + norm(m.concepto) + ' ' + norm(m.referencia) + ' ';
  const concPeg = conc.replace(/\s+/g, '');
  const movC = cent(m.importe);
  return lista.filter((f) => movC !== 0 && Math.abs(movC + aPagarEur(f)) <= 1 && typeof f.fecha_emision === 'string' && m.fecha >= f.fecha_emision).map((f) => {
    const palabras = norm(f.proveedor).split(' ').filter((w) => w.length >= 4 && !SUFIJOS.has(w));
    const porProveedor = palabras.some((w) => conc.includes(' ' + w + ' ') || conc.includes(' ' + w));
    const numero = norm(f.numero).replace(/\s+/g, '');
    const porNumero = numero.length >= 3 && concPeg.includes(numero);
    const confianza = Math.round((0.6 + (porProveedor ? 0.25 : 0) + (porNumero ? 0.15 : 0)) * 100) / 100;
    const ref = f.fecha_vencimiento || f.fecha_emision;
    const dist = Math.abs(Date.parse(m.fecha) - Date.parse(ref));
    return { f, confianza, dist };
  }).sort((a, b) => b.confianza - a.confianza || a.dist - b.dist || a.f.id - b.f.id);
};
// Asignación voraz: cada factura se sugiere a un solo movimiento (los de mayor confianza primero).
const sugerir = (lista) => {
  const usadas = new Set();
  const out = {};
  const todas = [];
  for (const m of lista) for (const c of candidatos(m, pendientes(m.cliente_id, null))) todas.push({ m, ...c });
  todas.sort((a, b) => b.confianza - a.confianza || a.dist - b.dist || (a.m.fecha < b.m.fecha ? -1 : 1));
  for (const t of todas) {
    const k = t.m.id ?? t.m.hash;
    if (out[k] || usadas.has(t.f.id)) continue;
    usadas.add(t.f.id);
    out[k] = { factura_id: t.f.id, proveedor: t.f.proveedor, numero: t.f.numero || null, fecha_emision: t.f.fecha_emision, total: r2(totalEur(t.f) ?? aPagarEur(t.f)), total_a_pagar: r2(aPagarEur(t.f)), confianza: t.confianza };
  }
  return out;
};
const clienteValido = (id) => clientes.find((c) => c.id === id && c.activo !== false);

if (p.ruta === 'importar') {
  if (!clienteValido(p.cliente_id)) return res(404, { error: `No existe el cliente ${p.cliente_id} o no está activo (GET /clientes).` });
  const existentes = new Set(movs.map((m) => m.hash));
  const nuevos = p.movimientos.filter((m) => !existentes.has(m.hash));
  const filas = nuevos.map((m) => ({ cliente_id: p.cliente_id, cuenta: m.cuenta || null, fecha: m.fecha, fecha_valor: m.fecha_valor || null, concepto: m.concepto, importe: r2(m.importeC),
    referencia: m.referencia || null, factura_id: null, estado: 'pendiente', origen: p.formato, hash: m.hash, creado: ahora }));
  const sug = sugerir(filas.map((f) => ({ ...f, id: undefined })));
  return res(200, { formato: p.formato, importados: filas.length, duplicados: p.movimientos.length - filas.length, errores: p.errores, avisos: p.avisos },
    { insertar: filas, sugerencias_por_hash: sug });
}

if (p.ruta === 'listar') {
  const lista = movs.filter((m) => (p.cliente_id === null || m.cliente_id === p.cliente_id) && (!p.estado || m.estado === p.estado))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  const sug = sugerir(lista.filter((m) => m.estado === 'pendiente').sort((a, b) => (a.fecha < b.fecha ? -1 : 1)));
  const items = lista.map((m) => ({ id: m.id, cliente_id: m.cliente_id, cuenta: m.cuenta, fecha: m.fecha, fecha_valor: m.fecha_valor, concepto: m.concepto, importe: m.importe,
    referencia: m.referencia, estado: m.estado, factura_id: m.factura_id ?? null, origen: m.origen, sugerencia: m.estado === 'pendiente' ? sug[m.id] || null : null }));
  return res(200, { items, total: items.length });
}

// ---- conciliar ----
const mov = movs.find((m) => m.id === p.movimiento_id);
if (!mov) return res(404, { error: `No existe el movimiento ${p.movimiento_id}.` });
const fac = p.factura_id ? facturas.find((f) => f.id === p.factura_id) : null;
if (p.factura_id && (!fac || ['borrada', 'duplicada'].includes(fac.estado))) return res(404, { error: `No existe la factura ${p.factura_id} (o está borrada o duplicada).` });
if (fac && fac.cliente_id !== mov.cliente_id) return res(422, { error: 'La factura es de otro cliente que el movimiento.' });
if (fac && fac.movimiento_id !== null && fac.movimiento_id !== undefined && fac.movimiento_id !== mov.id) {
  return res(422, { error: `La factura ${fac.id} ya está conciliada con el movimiento ${fac.movimiento_id}; deshaz esa conciliación antes.` });
}
const cambiosFacturas = [];
let revertida = null;
const anterior = mov.factura_id !== null && mov.factura_id !== undefined ? facturas.find((f) => f.id === mov.factura_id) : null;
if (anterior && (!fac || anterior.id !== fac.id) && anterior.movimiento_id === mov.id) {
  cambiosFacturas.push({ id: anterior.id, fila: { estado_pago: 'pendiente', fecha_pago: null, movimiento_id: null, actualizado: ahora } });
  revertida = anterior.id;
}
if (fac) cambiosFacturas.push({ id: fac.id, fila: { estado_pago: 'pagada', fecha_pago: mov.fecha, movimiento_id: mov.id, actualizado: ahora } });
const filaMov = { factura_id: fac ? fac.id : null, estado: p.estado };
const aviso = fac && Math.abs(cent(mov.importe) + (aPagarEur(fac) ?? 0)) > 1 ? 'El importe del movimiento no coincide con el total a pagar de la factura.' : null;
return res(200, {
  movimiento: { ...mov, ...filaMov },
  factura: fac ? { id: fac.id, estado_pago: 'pagada', fecha_pago: mov.fecha, movimiento_id: mov.id } : null,
  revertida, aviso,
}, { mov_id: mov.id, fila_mov: filaMov, facturas: cambiosFacturas });
