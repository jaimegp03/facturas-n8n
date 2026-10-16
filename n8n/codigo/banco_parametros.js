// GET /banco/movimientos (cliente_id?, estado?) y PATCH /banco/conciliar ({movimiento_id, factura_id|null, estado}).
const ruta = $('GET /banco/movimientos').isExecuted ? 'listar' : 'conciliar';
const e = $input.first().json || {};
const fallo = (status, error, detalles) => [{ json: { ruta, _error: true, status, body: detalles ? { error, detalles } : { error } } }];
const entero = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null);
const ESTADOS = ['pendiente', 'conciliado', 'ignorado'];
if (ruta === 'listar') {
  const q = e.query && typeof e.query === 'object' ? e.query : {};
  const fuera = Object.keys(q).filter((k) => !['cliente_id', 'estado'].includes(k));
  if (fuera.length) return fallo(400, 'Parámetros no válidos.', [`Parámetros desconocidos: ${fuera.join(', ')}. Admitidos: cliente_id, estado.`]);
  const det = [];
  let cliente_id = null;
  if (q.cliente_id !== undefined && String(q.cliente_id).trim() !== '') { cliente_id = entero(String(q.cliente_id)); if (!cliente_id) det.push('"cliente_id" debe ser un entero positivo.'); }
  const estado = q.estado !== undefined && String(q.estado).trim() !== '' ? String(q.estado).trim() : null;
  if (estado && !ESTADOS.includes(estado)) det.push(`"estado" debe ser ${ESTADOS.join(', ')}.`);
  if (det.length) return fallo(400, 'Parámetros no válidos.', det);
  return [{ json: { ruta, _error: false, cliente_id, estado } }];
}
const b = e.body;
if (!b || typeof b !== 'object' || Array.isArray(b)) return fallo(400, 'El cuerpo debe ser un objeto JSON {movimiento_id, factura_id, estado}.');
const fuera = Object.keys(b).filter((k) => !['movimiento_id', 'factura_id', 'estado'].includes(k));
if (fuera.length) return fallo(400, 'Parámetros no válidos.', [`Campos desconocidos: ${fuera.join(', ')}.`]);
const movimiento_id = entero(b.movimiento_id);
if (!movimiento_id) return fallo(400, '"movimiento_id" es obligatorio y debe ser un entero positivo.');
let factura_id = null;
if (b.factura_id !== undefined && b.factura_id !== null) { factura_id = entero(b.factura_id); if (!factura_id) return fallo(400, '"factura_id" debe ser un entero positivo o null.'); }
const estado = b.estado === undefined || b.estado === null ? (factura_id ? 'conciliado' : 'pendiente') : String(b.estado);
if (!ESTADOS.includes(estado)) return fallo(400, `"estado" debe ser ${ESTADOS.join(', ')}.`);
if (estado === 'conciliado' && !factura_id) return fallo(400, 'Para conciliar hay que indicar "factura_id".');
if (estado !== 'conciliado' && factura_id) return fallo(400, `Con estado «${estado}», "factura_id" debe ser null.`);
return [{ json: { ruta, _error: false, movimiento_id, factura_id, estado } }];
