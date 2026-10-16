// «Mi dinero: respuesta»: arma la respuesta de las escrituras con las filas ya guardadas.
const p = $('Mi dinero: procesar').first().json;
const sal = (ing) => ({ id: ing.id, cliente_id: ing.cliente_id, tipo: ing.tipo, concepto: ing.concepto, importe: ing.importe, periodicidad: ing.periodicidad, fecha_inicio: ing.fecha_inicio,
  fecha_fin: ing.fecha_fin === undefined ? null : ing.fecha_fin, dia_cobro: ing.dia_cobro === undefined ? null : ing.dia_cobro, activo: ing.activo !== false, creado: ing.creado || null });
if (p.accion === 'insert_ingreso' || p.accion === 'update_ingreso') {
  const r = $input.first().json;
  const fila = r && r.id !== undefined ? r : Object.assign({}, p.fila, { id: p.id });
  return [{ json: { status: p.accion === 'insert_ingreso' ? 201 : 200, body: { ingreso: sal(fila) } } }];
}
if (p.accion === 'insert_meta' || p.accion === 'update_meta') {
  const r = $input.first().json;
  const id = p.id !== undefined ? p.id : (r && r.id);
  return [{ json: { status: p.accion === 'insert_meta' ? 201 : 200, body: Object.assign({ meta: Object.assign({}, p.meta_calc, { id }) }, p.extra_body || {}) } }];
}
if (p.accion === 'insert_deuda' || p.accion === 'update_deuda') {
  const r = $input.first().json;
  const id = p.id !== undefined ? p.id : (r && r.id);
  return [{ json: { status: p.accion === 'insert_deuda' ? 201 : 200, body: { deuda: Object.assign({}, p.deuda_calc, { id }) } } }];
}
if (p.accion === 'put_presupuestos') {
  const l = $input.all().map((i) => i.json).filter((r) => r && r.id !== undefined).map((r) => ({ id: r.id, categoria: r.categoria, limite_mensual: r.limite_mensual, activo: true }));
  return [{ json: { status: 200, body: { cliente_id: p.cliente_id, items: l, total: l.length } } }];
}
return [{ json: { status: p.status, body: p.body } }];
