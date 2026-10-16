// «Mi dinero: procesar»: valida la petición (GET/POST/PATCH/DELETE /ingresos, GET/PUT /presupuestos, GET /mi-dinero) y calcula la respuesta.
// Las escrituras (insertar, actualizar, borrar) las hacen los nodos Data Table siguientes según `accion`.
/*@@COMUN_MI_DINERO@@*/
const RUTAS = ['GET /ingresos', 'POST /ingresos', 'PATCH /ingresos', 'DELETE /ingresos', 'GET /presupuestos', 'PUT /presupuestos', 'GET /mi-dinero', 'GET /metas', 'POST /metas', 'PATCH /metas', 'DELETE /metas', 'POST /metas/aportar', 'GET /resumen-mensual', 'GET /renta', 'GET /deudas', 'POST /deudas', 'PATCH /deudas', 'DELETE /deudas', 'POST /deudas/simular', 'GET /deudas/resumen'];
const ruta = RUTAS.find((r) => $(r).isExecuted);
const e = $(ruta).first().json || {};
const q = e.query && typeof e.query === 'object' ? e.query : {};
const cuerpo = e.body && typeof e.body === 'object' && !Array.isArray(e.body) ? e.body : null;
const filas = (n) => $(n).all().map((i) => i.json).filter((r) => r && r.id !== undefined);
const ingresos = filas('Leer ingresos'); const presupuestos = filas('Leer presupuestos'); const categorias = filas('Leer categorías').filter((c) => c.activa !== false);
const metas = filas('Leer metas'); const deudas = filas('Leer deudas'); const clientes = filas('Leer clientes'); const facturas = filas('Leer facturas');
const ahora = $now.setZone('Europe/Madrid'); const hoy = ahora.toISODate();
const val = (k) => { const v = Array.isArray(q[k]) ? q[k][0] : q[k]; return v === undefined || v === null ? '' : String(v).trim(); };
const sal = (status, body, extra) => [{ json: Object.assign({ status, body, accion: 'none' }, extra || {}) }];
const e400 = (m, d) => sal(400, d ? { error: m, detalles: d } : { error: m });
const COLS = ['cliente_id', 'tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo', 'creado'];
const salidaIng = (r) => ({ id: r.id, cliente_id: r.cliente_id, tipo: r.tipo, concepto: r.concepto, importe: r.importe, periodicidad: r.periodicidad, fecha_inicio: r.fecha_inicio,
  fecha_fin: r.fecha_fin === undefined ? null : r.fecha_fin, dia_cobro: r.dia_cobro === undefined ? null : r.dia_cobro, activo: r.activo !== false, creado: r.creado || null });
const esEntero = (s) => /^\d{1,12}$/.test(String(s));
// cliente_id: de la query o del cuerpo
const cidTxt = val('cliente_id') || (cuerpo && cuerpo.cliente_id !== undefined && cuerpo.cliente_id !== null ? String(cuerpo.cliente_id).trim() : '');

if (ruta === 'GET /ingresos') {
  if (cidTxt && !esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  let l = ingresos; if (cidTxt) l = l.filter((r) => Number(r.cliente_id) === Number(cidTxt));
  l = l.slice().sort((a, b) => a.id - b.id).map(salidaIng);
  return sal(200, { items: l, total: l.length });
}
if (ruta === 'GET /presupuestos') {
  if (!cidTxt) return e400('"cliente_id" es obligatorio.');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const orden = {}; categorias.forEach((c, i) => { orden[c.nombre] = c.orden === undefined || c.orden === null ? 1000 + i : c.orden; });
  const l = presupuestos.filter((p) => Number(p.cliente_id) === Number(cidTxt) && p.activo !== false).sort((a, b) => (orden[a.categoria] ?? 9999) - (orden[b.categoria] ?? 9999))
    .map((p) => ({ id: p.id, categoria: p.categoria, limite_mensual: p.limite_mensual, activo: true }));
  return sal(200, { cliente_id: Number(cidTxt), items: l, total: l.length });
}
if (ruta === 'GET /mi-dinero') {
  const extra = Object.keys(q).filter((k) => !['cliente_id', 'mes'].includes(k));
  if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: cliente_id, mes.`);
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const mes = val('mes') || hoy.slice(0, 7);
  if (!mdMesValido(mes)) return e400('"mes" debe tener el formato AAAA-MM.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  return sal(200, calcularMiDinero({ cliente: cli, mes, hoy, ingresos, presupuestos, categorias, facturas }));
}
if (ruta === 'GET /renta') {
  const extra = Object.keys(q).filter((k) => !['cliente_id', 'anio'].includes(k));
  if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: cliente_id, anio.`);
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const anio = val('anio') || String(rentaAnioDefecto(hoy));
  if (!rentaAnioValido(anio)) return e400('"anio" debe tener el formato AAAA.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  return sal(200, calcularRenta({ cliente: cli, anio, hoy, ingresos, presupuestos, categorias, facturas }));
}
// ---- fase 4b etapa 2: deudas y préstamos ----
if (ruta.includes('/deudas')) {
  const clienteDe = (id) => clientes.find((c) => Number(c.id) === Number(id));
  const nuevaFila = (r, base) => { const fila = {}; DEUDA_COLS.forEach((c) => { fila[c] = r[c] === undefined ? (base && base[c] !== undefined ? base[c] : null) : r[c]; }); return fila; };
  const salidaDeuda = (fila, id) => calcularDeuda(Object.assign({}, fila, { id }), hoy);
  if (ruta === 'GET /deudas' || ruta === 'GET /deudas/resumen') {
    const extra = Object.keys(q).filter((k) => k !== 'cliente_id');
    if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitido: cliente_id.`);
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (ruta === 'GET /deudas/resumen') return sal(200, calcularResumenDeudas({ cliente: cli, hoy, ingresos, deudas }));
    const items = deudas.filter((d) => Number(d.cliente_id) === Number(cidTxt)).sort((a, b) => a.id - b.id).map((d) => calcularDeuda(d, hoy));
    return sal(200, { cliente_id: Number(cidTxt), items, total: items.length });
  }
  if (ruta === 'POST /deudas') {
    if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const ok = DEUDA_COLS.filter((c) => c !== 'creada');
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
    const r = validarDeuda(cuerpo, null);
    if (r.errores.length) return sal(422, { error: 'Deuda no válida.', detalles: r.errores });
    const fila = nuevaFila(Object.assign({}, r.fila, { cliente_id: Number(cidTxt), creada: ahora.toISO() }));
    return sal(201, null, { accion: 'insert_deuda', fila, deuda_calc: salidaDeuda(fila, 0) });
  }
  const idTxt = val('id');
  if (!idTxt) return e400('Falta el parámetro "id".');
  if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
  const actual = deudas.find((r) => Number(r.id) === Number(idTxt));
  if (!actual) return sal(404, { error: 'No existe la deuda.' });
  if (ruta === 'DELETE /deudas') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_deuda', id: actual.id });
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (ruta === 'POST /deudas/simular') {
    const fuera = Object.keys(cuerpo).filter((k) => !['amortizacion_extra', 'tipo'].includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, ['Admitidos: amortizacion_extra, tipo.']);
    const r = simularDeuda(actual, hoy, cuerpo);
    return sal(r.status, r.body);
  }
  const okP = DEUDA_COLS.filter((c) => c !== 'creada' && c !== 'cliente_id');
  const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
  if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
  const rp = validarDeuda(cuerpo, actual);
  if (rp.errores.length) return sal(422, { error: 'Deuda no válida.', detalles: rp.errores });
  const fila = nuevaFila(rp.fila, actual);
  return sal(200, null, { accion: 'update_deuda', id: actual.id, fila, deuda_calc: salidaDeuda(fila, actual.id) });
}
// ---- fase 4a: metas de ahorro y resumen mensual ----
if (ruta.includes('metas') || ruta === 'GET /resumen-mensual') {
  const clienteDe = (id) => clientes.find((c) => Number(c.id) === Number(id));
  const nuevaFila = (r, base) => { const fila = {}; MD_META_COLS.forEach((c) => { fila[c] = r[c] === undefined ? (base && base[c] !== undefined ? base[c] : null) : r[c]; }); return fila; };
  const salidaMeta = (fila, id) => { const cli = clienteDe(fila.cliente_id) || { id: fila.cliente_id, nombre: '' };
    const lista = metas.filter((m) => Number(m.id) !== Number(id)).concat([Object.assign({}, fila, { id })]);
    return calcularMetas({ cliente: cli, hoy, ingresos, facturas, metas: lista }).items.find((m) => Number(m.id) === Number(id)); };
  if (ruta === 'GET /metas' || ruta === 'GET /resumen-mensual') {
    const permitidos = ruta === 'GET /metas' ? ['cliente_id'] : ['cliente_id', 'mes'];
    const extra = Object.keys(q).filter((k) => !permitidos.includes(k));
    if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: ${permitidos.join(', ')}.`);
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const mes = val('mes') || hoy.slice(0, 7);
    if (ruta === 'GET /resumen-mensual' && !mdMesValido(mes)) return e400('"mes" debe tener el formato AAAA-MM.');
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (ruta === 'GET /metas') return sal(200, calcularMetas({ cliente: cli, hoy, ingresos, facturas, metas }));
    return sal(200, calcularResumenMensual({ cliente: cli, mes, hoy, ingresos, presupuestos, categorias, facturas, metas }));
  }
  if (ruta === 'POST /metas') {
    if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const ok = MD_META_COLS.filter((c) => c !== 'creada');
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
    const r = validarMeta(cuerpo, null, hoy);
    if (r.errores.length) return sal(422, { error: 'Meta no válida.', detalles: r.errores });
    const fila = nuevaFila(Object.assign({}, r.fila, { cliente_id: Number(cidTxt), creada: ahora.toISO() }));
    return sal(201, null, { accion: 'insert_meta', fila, meta_calc: salidaMeta(fila, 0) });
  }
  const idTxt = val('id');
  if (!idTxt) return e400('Falta el parámetro "id".');
  if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
  const actual = metas.find((r) => Number(r.id) === Number(idTxt));
  if (!actual) return sal(404, { error: 'No existe la meta.' });
  if (ruta === 'DELETE /metas') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_meta', id: actual.id });
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (ruta === 'POST /metas/aportar') {
    const fuera = Object.keys(cuerpo).filter((k) => k !== 'importe');
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, ['Admitido: importe.']);
    const r = aportarMeta(actual, cuerpo.importe);
    if (r.error) return sal(422, { error: 'Aportación no válida.', detalles: [r.error] });
    const fila = nuevaFila(Object.assign({}, actual, { importe_ahorrado: r.ahorrado }));
    return sal(200, null, { accion: 'update_meta', id: actual.id, fila, meta_calc: salidaMeta(fila, actual.id), extra_body: { aportado: mdEur(mdCent(mdNumero(cuerpo.importe))) } });
  }
  const okP = MD_META_COLS.filter((c) => c !== 'creada' && c !== 'cliente_id');
  const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
  if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
  const rp = validarMeta(cuerpo, actual, hoy);
  if (rp.errores.length) return sal(422, { error: 'Meta no válida.', detalles: rp.errores });
  const fila = nuevaFila(rp.fila, actual);
  return sal(200, null, { accion: 'update_meta', id: actual.id, fila, meta_calc: salidaMeta(fila, actual.id) });
}
// ---- escrituras ----
if (ruta === 'PUT /presupuestos' || ruta === 'POST /ingresos') {
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
  const cid = Number(cidTxt);
  if (ruta === 'POST /ingresos') {
    const ok = ['cliente_id', 'tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo'];
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const r = validarIngreso(cuerpo, null);
    if (r.errores.length) return sal(422, { error: 'Ingreso no válido.', detalles: r.errores });
    const fila = {}; COLS.forEach((c) => { fila[c] = r.fila[c] === undefined ? null : r.fila[c]; });
    fila.cliente_id = cid; fila.creado = ahora.toISO();
    return sal(201, null, { accion: 'insert_ingreso', fila });
  }
  const ok = ['cliente_id', 'presupuestos'];
  const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
  if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
  const r = validarPresupuestos(cuerpo.presupuestos, categorias.map((c) => c.nombre));
  if (r.errores.length) return sal(422, { error: 'Presupuestos no válidos.', detalles: r.errores });
  return sal(200, null, { accion: 'put_presupuestos', cliente_id: cid, filas: r.filas.map((f) => Object.assign({ cliente_id: cid }, f, { activo: true })) });
}
// PATCH / DELETE /ingresos?id=N
const idTxt = val('id');
if (!idTxt) return e400('Falta el parámetro "id".');
if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
const actual = ingresos.find((r) => Number(r.id) === Number(idTxt));
if (!actual) return sal(404, { error: 'No existe el ingreso.' });
if (ruta === 'DELETE /ingresos') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_ingreso', id: actual.id });
if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
const okP = ['tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo'];
const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
const rp = validarIngreso(cuerpo, actual);
if (rp.errores.length) return sal(422, { error: 'Ingreso no válido.', detalles: rp.errores });
const fila = {}; COLS.forEach((c) => { fila[c] = rp.fila[c] === undefined ? null : rp.fila[c]; });
return sal(200, null, { accion: 'update_ingreso', id: actual.id, fila });
