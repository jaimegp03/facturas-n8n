// GET /recomendaciones[?cliente_id=N]: última ejecución guardada del asesor (sin llamar a Gemini).
// Con cliente_id, la última de ese cliente; sin él, la última de cualquiera (también las de «todos»).
const q = ($('GET /recomendaciones').first().json || {}).query || {};
const crudo = q.cliente_id === undefined || q.cliente_id === null ? '' : String(Array.isArray(q.cliente_id) ? q.cliente_id[0] : q.cliente_id).trim();
if (crudo && !/^\d{1,12}$/.test(crudo)) return [{ json: { status: 400, body: { error: 'Parámetros no válidos.', detalles: ['"cliente_id" debe ser un entero positivo.'] } } }];
const clienteId = crudo ? Number(crudo) : null;
const filas = $input.all().map((i) => i.json).filter((f) => f && f.id !== undefined && f.id !== null && (clienteId === null || f.cliente_id === clienteId));
if (!filas.length) {
  return [{ json: { status: 404, body: { error: clienteId === null ? 'Todavía no hay recomendaciones guardadas. Lanza POST /asesor.'
    : `Todavía no hay recomendaciones guardadas para el cliente ${clienteId}. Lanza POST /asesor con cliente_id.` } } }];
}
const f = filas.sort((x, y) => y.id - x.id)[0];
let datos;
try { datos = JSON.parse(f.json); } catch (e) { return [{ json: { status: 500, body: { error: 'La última recomendación guardada no es un JSON válido.', id: f.id } } }]; }
return [{ json: { status: 200, body: { ...datos, cliente_id: f.cliente_id ?? datos.cliente_id ?? null, guardado: { id: f.id, fecha: f.fecha } } } }];
