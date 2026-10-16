// GET /fiscal (cliente_id, anio, trimestre), GET /libro-registro y GET /asientos (cliente_id, desde, hasta, formato).
// cliente_id es obligatorio: los modelos y libros son de un cliente (un NIF declarante).
const ruta = $('GET /fiscal').isExecuted ? 'fiscal' : $('GET /libro-registro').isExecuted ? 'libro' : 'asientos';
const e = $input.first().json || {};
const q = e.query && typeof e.query === 'object' ? e.query : {};
const val = (k) => { const v = Array.isArray(q[k]) ? q[k][0] : q[k]; return v === undefined || v === null ? '' : String(v).trim(); };
const errores = [];
const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const PERMITIDOS = { fiscal: ['cliente_id', 'anio', 'trimestre'], libro: ['cliente_id', 'desde', 'hasta', 'formato'], asientos: ['cliente_id', 'desde', 'hasta', 'formato'] }[ruta];
const fuera = Object.keys(q).filter((k) => !PERMITIDOS.includes(k));
if (fuera.length) errores.push(`Parámetros desconocidos: ${fuera.join(', ')}. Admitidos: ${PERMITIDOS.join(', ')}.`);
const ahora = $now.setZone('Europe/Madrid');
const hoy = ahora.toISODate();
let cliente_id = null;
if (!val('cliente_id')) errores.push('"cliente_id" es obligatorio (GET /clientes).');
else if (!/^\d{1,12}$/.test(val('cliente_id'))) errores.push('"cliente_id" debe ser un entero positivo.');
else cliente_id = Number(val('cliente_id'));
const salida = { ruta, cliente_id, hoy, generado: ahora.toISO() };
if (ruta === 'fiscal') {
  const anio = val('anio') || String(ahora.year);
  if (!/^\d{4}$/.test(anio) || Number(anio) < 2000 || Number(anio) > 2100) errores.push('"anio" debe ser un año de 4 cifras (2000-2100).');
  const t = val('trimestre');
  if (t && !/^[1-4]$/.test(t)) errores.push('"trimestre" debe ser 1, 2, 3 o 4 (sin trimestre: año completo).');
  salida.anio = Number(anio);
  salida.trimestre = t ? Number(t) : null;
} else {
  let desde = val('desde');
  let hasta = val('hasta');
  if (desde && !fechaValida(desde)) errores.push('"desde" debe ser una fecha AAAA-MM-DD válida.');
  if (hasta && !fechaValida(hasta)) errores.push('"hasta" debe ser una fecha AAAA-MM-DD válida.');
  if (!hasta) hasta = hoy;
  if (!desde) desde = ahora.minus({ years: 1 }).plus({ days: 1 }).toISODate();
  if (desde > hasta) errores.push('"desde" no puede ser posterior a "hasta".');
  const formatos = ruta === 'libro' ? ['json', 'csv'] : ['csv', 'a3', 'holded'];
  const formato = (val('formato') || formatos[0]).toLowerCase();
  if (!formatos.includes(formato)) errores.push(`"formato" debe ser ${formatos.join(', ')}.`);
  Object.assign(salida, { desde, hasta, formato });
}
if (errores.length) return [{ json: { _error: true, status: 400, body: { error: 'Parámetros no válidos.', detalles: errores } } }];
return [{ json: { _error: false, ...salida } }];
