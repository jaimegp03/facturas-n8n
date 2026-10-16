/* ================= Mi dinero (fase 2) ================= */
@@BLOQUE@@
window.__miDinero = {calcularMiDinero, simularNomina, validarIngreso, validarPresupuestos}; // expuestas para la prueba que las compara con n8n
function mdDemoIngresos(hoyIso) {
  const m = k => mdMesMas(hoyIso.slice(0, 7), k);
  const f = (id, cliente_id, tipo, concepto, importe, periodicidad, ini, dia) => ({id, cliente_id, tipo, concepto, importe, periodicidad, fecha_inicio:ini, fecha_fin:null, dia_cobro:dia, activo:true, creado:hoyIso});
  return [
    f(1, 1, 'nomina', 'Sueldo (Estudio Norte S.L.)', 2150, 'mensual', m(-14) + '-01', 28),
    f(2, 1, 'otros', 'Alquiler de la habitación', 380, 'mensual', m(-8) + '-01', 5),
    f(3, 1, 'extra', 'Paga de beneficios', 1800, 'anual', m(-5) + '-15', null),
    f(4, 1, 'otros', 'Devolución de la renta', 412.35, 'puntual', m(0) + '-03', null),
    f(5, 2, 'otros', 'Ventas del local (neto de IVA)', 9800, 'mensual', m(-10) + '-01', 1),
    f(6, 2, 'extra', 'Catering de eventos', 1250, 'puntual', m(0) + '-05', null),
    f(7, 2, 'extra', 'Subvención de hostelería', 2400, 'anual', m(-4) + '-10', null)
  ];
}
function mdDemoPres() {
  const p = (cid, l) => l.map(([categoria, limite_mensual]) => ({cliente_id:cid, categoria, limite_mensual, activo:true}));
  return p(1, [['Alimentación y supermercado', 280], ['Restaurantes y comida a domicilio', 90], ['Streaming y música', 25], ['Luz', 70], ['Gas', 40], ['Agua', 25], ['Telefonía e internet', 45],
    ['Transporte y combustible', 100], ['Ropa y calzado', 60], ['Deporte y gimnasio', 45], ['Hogar', 80]])
    .concat(p(2, [['Mercaderías', 2600], ['Alquileres', 1500], ['Servicios profesionales', 400], ['Luz', 450], ['Agua', 80], ['Telefonía e internet', 120], ['Publicidad', 200], ['Reparaciones y mantenimiento', 250], ['Seguros', 150]]))
    .map((x, i) => Object.assign({id:i + 1}, x));
}
function demoMiDinero(D, ruta, met, q, body, fallo) {
  const con = (st, m, det) => { const e = fallo(st, m); e.data = det ? {error:m, detalles:det} : {error:m}; return e; };
  const cats = DEMO_CATS.map(([nombre], i) => ({nombre, orden:i + 1, activa:true}));
  const salI = r => ({id:r.id, cliente_id:r.cliente_id, tipo:r.tipo, concepto:r.concepto, importe:r.importe, periodicidad:r.periodicidad, fecha_inicio:r.fecha_inicio, fecha_fin:r.fecha_fin ?? null, dia_cobro:r.dia_cobro ?? null, activo:r.activo !== false, creado:r.creado || null});
  if (ruta === '/nomina/simular') { const r = simularNomina(body); if (r.status !== 200) throw con(r.status, r.body.error, r.body.detalles); return r.body; }
  if (ruta === '/mi-dinero') {
    const cid = q.get('cliente_id'); if (!cid) throw con(400, '"cliente_id" es obligatorio (GET /clientes).');
    const mes = q.get('mes') || D.hoyIso.slice(0, 7); if (!mdMesValido(mes)) throw con(400, '"mes" debe tener el formato AAAA-MM.');
    const cli = D.clientes.find(c => String(c.id) === cid); if (!cli) throw con(404, 'No existe el cliente.');
    return calcularMiDinero({cliente:cli, mes, hoy:D.hoyIso, ingresos:D.ingresos, presupuestos:D.presupuestos, categorias:cats, facturas:D.facturas});
  }
  if (ruta === '/ingresos') {
    if (met === 'POST') {
      const cli = D.clientes.find(c => String(c.id) === String(body && body.cliente_id)); if (!cli) throw con(404, 'No existe el cliente.');
      const r = validarIngreso(body, null); if (r.errores.length) throw con(422, 'Ingreso no válido.', r.errores);
      const fila = Object.assign({}, r.fila, {id:D.sigIng++, cliente_id:cli.id, creado:new Date().toISOString()}); D.ingresos.push(fila); return {ingreso:salI(fila)};
    }
    if (met === 'PATCH' || met === 'DELETE') {
      const fila = D.ingresos.find(x => String(x.id) === q.get('id')); if (!fila) throw con(404, 'No existe el ingreso.');
      if (met === 'DELETE') { D.ingresos.splice(D.ingresos.indexOf(fila), 1); return {borrado:true, id:fila.id}; }
      const r = validarIngreso(body || {}, fila); if (r.errores.length) throw con(422, 'Ingreso no válido.', r.errores);
      Object.assign(fila, r.fila); return {ingreso:salI(fila)};
    }
    const l = D.ingresos.filter(r => !q.get('cliente_id') || String(r.cliente_id) === q.get('cliente_id')).map(salI); return {items:l, total:l.length};
  }
  if (ruta === '/presupuestos') {
    if (met === 'PUT') {
      const cid = +(body && body.cliente_id) || +q.get('cliente_id'); if (!D.clientes.some(c => c.id === cid)) throw con(404, 'No existe el cliente.');
      const r = validarPresupuestos(body.presupuestos, cats.map(c => c.nombre)); if (r.errores.length) throw con(422, 'Presupuestos no válidos.', r.errores);
      D.presupuestos = D.presupuestos.filter(p => p.cliente_id !== cid).concat(r.filas.map(f => Object.assign({id:D.sigPres++, cliente_id:cid, activo:true}, f)));
      const l = D.presupuestos.filter(p => p.cliente_id === cid).map(p => ({id:p.id, categoria:p.categoria, limite_mensual:p.limite_mensual, activo:true})); return {cliente_id:cid, items:l, total:l.length};
    }
    const cid = q.get('cliente_id'); if (!cid) throw con(400, '"cliente_id" es obligatorio.');
    const l = D.presupuestos.filter(p => String(p.cliente_id) === cid).map(p => ({id:p.id, categoria:p.categoria, limite_mensual:p.limite_mensual, activo:true})); return {cliente_id:+cid, items:l, total:l.length};
  }
  throw con(404, 'Ruta no disponible en la demo: ' + ruta);
}

const MDS = {mes: isoLocal(new Date()).slice(0, 7), datos: null, ingresos: [], draft: [], editId: null, borrarId: null};
const dlgNom = $('#dlgNomina'), dlgIng = $('#dlgIngreso');
function mdClienteId() {
  if (S.cliente) return String(S.cliente);
  const l = (S.clientes || []).filter(c => c.activo !== false);
  const p = l.find(c => c.regimen_iva === 'particular') || l[0];
  return p ? String(p.id) : '1';
}
const mdNombreMes = ym => { const [a, m] = ym.split('-'); return ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][+m - 1] + ' ' + a; };
const mdPctTxt = p => p == null ? '—' : fmtNum(p, 1).replace(/,0$/, '') + ' %';
const mdChipEstado = e => e === 'superado' ? '<span class="chip bad">Superado</span>' : e === 'aviso' ? '<span class="chip warn">Aviso</span>' : '<span class="chip ok">En orden</span>';
const SEC_MD = {};   // contador por sección: una respuesta tardía de un mes o cliente anterior no pisa la pantalla
function vigenteMD(k) { const n = (SEC_MD[k] = (SEC_MD[k] || 0) + 1); return () => SEC_MD[k] === n; }
async function cargarMiDinero() {
  const vig = vigenteMD('md');
  const cid = mdClienteId(), c = (S.clientes || []).find(x => String(x.id) === cid);
  $('#mdCliente').textContent = 'Cliente: ' + (c ? c.nombre : 'Personal');
  $('#mdAvisoCli').textContent = c && c.regimen_iva !== 'particular' ? '· Este cliente no es un particular: Mi dinero está pensado para finanzas personales.' : '';
  $('#mdMes').value = MDS.mes;
  const m = $('#mdMsg'); m.className = 'msg';
  try {
    const [d, ing] = await Promise.all([api('/mi-dinero?cliente_id=' + cid + '&mes=' + MDS.mes), api('/ingresos?cliente_id=' + cid)]);
    if (!vig()) return;
    MDS.datos = d; MDS.ingresos = ing.items || []; MDS.draft = d.presupuesto.items.map(i => ({categoria: i.categoria, limite: i.limite_mensual}));
    m.textContent = '';
    mdPintar(); cargarMetas(); cargarResumenMes(); cargarRenta(); cargarDeudas();
  } catch (err) { if (!vig()) return; MDS.datos = null; m.className = 'msg err'; m.textContent = 'No se pudo cargar Mi dinero: ' + err.message; }
}
function mdPintar() {
  const d = MDS.datos; if (!d) return;
  const sinIng = d.ingresos.total === 0 && !MDS.ingresos.length;
  $('#mdVacio').hidden = !sinIng;
  const cmp = d.comparacion_3m;
  $('#mdKpis').innerHTML = [
    ['Ingresos', fmtEur(d.ingresos.total), d.ingresos.num ? `${d.ingresos.num} concepto${d.ingresos.num > 1 ? 's' : ''} en ${mdNombreMes(d.mes)}` : 'Sin ingresos este mes', ''],
    ['Gasto', fmtEur(d.gasto.total), cmp.media_gasto_3m ? `${mdPctTxt(cmp.pct)} frente a la media de 3 meses (${fmtEur(cmp.media_gasto_3m)})` : `${d.gasto.num_facturas} factura${d.gasto.num_facturas === 1 ? '' : 's'}`, ''],
    ['Ahorro del mes', fmtEur(d.balance), d.balance >= 0 ? 'Ingresos menos gasto' : 'Gastas más de lo que ingresas', d.ingresos.total > 0 ? (d.balance >= 0 ? 'pos' : 'neg') : ''],
    ['Tasa de ahorro', mdPctTxt(d.tasa_ahorro_pct), d.tasa_ahorro_pct == null ? 'Necesita ingresos' : 'Objetivo orientativo: 20 %', d.tasa_ahorro_pct == null ? '' : d.tasa_ahorro_pct >= 20 ? 'pos' : d.tasa_ahorro_pct < 0 ? 'neg' : '']
  ].map(([l, v, sub, cls]) => `<div class="md-kpi ${cls}"><div class="l">${esc(l)}</div><div class="v num">${esc(v)}</div><div class="d">${esc(sub)}</div></div>`).join('');
  $('#s5').textContent = d.ingresos.total ? `${fmtEur(d.balance)} de ahorro` : 'Ingresos y presupuestos';
  // ingresos
  const mes = Object.fromEntries(d.ingresos.detalle.map(x => [x.id, x.importe_mes]));
  const PER = {mensual: 'Mensual', anual: 'Anual', puntual: 'Puntual'}, TIP = {nomina: 'Nómina', extra: 'Extra', otros: 'Otros'};
  $('#mdIngresos').innerHTML = MDS.ingresos.length ? `<thead><tr><th scope="col">Concepto</th><th scope="col">Periodicidad</th><th scope="col" class="imp">Importe</th><th scope="col" class="imp">Este mes</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>` +
    MDS.ingresos.map(r => `<tr data-ing="${r.id}"><td class="nombre">${esc(r.concepto)}<br><small class="hint">${esc(TIP[r.tipo] || r.tipo)}${r.activo ? '' : ' · inactivo'}${r.fecha_fin ? ' · hasta ' + esc(fmtFecha(r.fecha_fin)) : ''}${r.dia_cobro ? ' · día ' + r.dia_cobro : ''}</small></td><td>${esc(PER[r.periodicidad] || r.periodicidad)}</td><td class="imp">${fmtEur(r.importe)}</td><td class="imp">${mes[r.id] != null ? fmtEur(mes[r.id]) : '—'}</td><td class="acc"><button class="btn btn-sm btn-ghost" type="button" data-md="editar" data-id="${r.id}" aria-label="Editar ${esc(r.concepto)}">Editar</button><button class="btn btn-sm btn-ghost btn-danger" type="button" data-md="borrar" data-id="${r.id}" aria-label="Borrar ${esc(r.concepto)}">${MDS.borrarId === r.id ? '¿Seguro?' : 'Borrar'}</button></td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td class="hint">Aún no hay ingresos. Usa «Añadir ingreso».</td></tr></tbody>';
  // alertas
  const NIV = {error: ['bad', 'Urgente'], aviso: ['warn', 'Aviso'], info: ['', 'Info']};
  $('#mdAlertas').innerHTML = d.alertas.length ? d.alertas.map(a => `<li><span class="chip ${NIV[a.nivel][0]}">${NIV[a.nivel][1]}</span><span>${esc(a.texto)}</span></li>`).join('') : '<li class="hint">Todo en orden: no hay alertas este mes.</li>';
  mdPintarPres(); mdPintar532(); mdPintarPrev();
}
function mdPintarPres() {
  const d = MDS.datos, guard = Object.fromEntries(d.presupuesto.items.map(i => [i.categoria, i]));
  const cons = Object.fromEntries(d.gasto.por_categoria.map(x => [x.categoria, x.total]));
  const filas = MDS.draft.map((p, i) => {
    const g = guard[p.categoria], est = g ? g.estado : 'info', pct = g && g.pct != null ? Math.min(100, g.pct) : (g && g.estado === 'superado' ? 100 : 0);
    const txt = g ? `${fmtEur(g.consumido)} de ${fmtEur(g.limite_mensual)}` : `${fmtEur(cons[p.categoria] || 0)} gastados`;
    return `<tr data-i="${i}"><th scope="row" class="nombre">${esc(p.categoria)}</th>
      <td><div class="md-barra ${est}" role="progressbar" aria-label="Presupuesto de ${esc(p.categoria)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${esc(txt)}"><i style="width:${pct}%"></i></div></td>
      <td class="imp">${esc(txt)}</td><td>${g ? mdChipEstado(g.estado) : '<span class="chip">Sin guardar</span>'}</td>
      <td class="imp"><label class="sr-only" for="mdLim${i}">Límite mensual de ${esc(p.categoria)} en euros</label><input id="mdLim${i}" type="number" min="0" step="any" inputmode="decimal" data-lim="${i}" value="${esc(p.limite)}"></td>
      <td class="acc"><button class="btn btn-sm btn-ghost btn-danger" type="button" data-md="quitar" data-i="${i}" aria-label="Quitar el presupuesto de ${esc(p.categoria)}">Quitar</button></td></tr>`;
  }).join('');
  $('#mdPres').innerHTML = MDS.draft.length ? `<thead><tr><th scope="col">Categoría</th><th scope="col">Consumo</th><th scope="col" class="imp">Gastado de límite</th><th scope="col">Estado</th><th scope="col" class="imp">Límite mensual</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${filas}</tbody>` :
    '<tbody><tr><td class="hint">Sin presupuestos. Elige una categoría abajo y fija un límite mensual.</td></tr></tbody>';
  const usadas = new Set(MDS.draft.map(p => p.categoria));
  $('#mdPresCat').innerHTML = (S.categorias || []).filter(c => !usadas.has(c)).map(c => `<option>${esc(c)}</option>`).join('');
  const sp = d.presupuesto.sin_presupuesto;
  $('#mdPresMsg').className = 'msg';
  $('#mdPresMsg').textContent = sp.length ? 'Gasto sin presupuesto este mes: ' + sp.map(x => `${x.categoria} (${fmtEur(x.gasto)})`).join(', ') + '.' : '';
}
function mdPintar532() {
  const r = MDS.datos.regla_50_30_20, sin = r.ingresos === 0;
  const fila = (k, tit, ok, okTxt) => { const g = r[k], pct = g.pct_real == null ? 0 : Math.min(100, g.pct_real); const est = g.cumple == null ? 'info' : g.cumple ? '' : 'aviso';
    return `<div class="fila"><b>${tit}</b><div class="barra"><div class="md-barra ${est}" role="progressbar" aria-label="${tit}: reparto real sobre tus ingresos" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${esc(mdPctTxt(g.pct_real))}"><i style="width:${pct}%"></i></div><span class="tick" style="left:${g.pct_objetivo}%" aria-hidden="true"></span></div>
      <span class="hint">${fmtEur(g.real)} · ${mdPctTxt(g.pct_real)} de tus ingresos · objetivo ${ok} ${g.pct_objetivo} % (${fmtEur(g.objetivo)}) · ${g.cumple == null ? 'sin ingresos' : g.cumple ? okTxt : (k === 'ahorro' ? 'por debajo del objetivo' : 'por encima del objetivo')}</span></div>`; };
  $('#md532').innerHTML = fila('necesidades', 'Necesidades', 'hasta', 'dentro del objetivo') + fila('deseos', 'Deseos', 'hasta', 'dentro del objetivo') + fila('ahorro', 'Ahorro', 'al menos', 'objetivo cumplido') +
    (sin ? '<p class="hint">Añade tus ingresos para calcular el reparto.</p>' : '');
}
function mdPintarPrev() {
  const p = MDS.datos.prevision;
  if (!p) { $('#mdPrev').innerHTML = '<p class="hint">La previsión solo está disponible para el mes en curso.</p>'; return; }
  const rec = p.recurrentes_pendientes;
  $('#mdPrev').innerHTML = `<dl class="md-dl"><dt>Gasto hasta hoy</dt><dd>${fmtEur(p.gasto_acumulado)}</dd>
    <dt>Recurrentes que aún no han cargado (${rec.detalle.length})</dt><dd>${fmtEur(rec.total)}</dd>
    <dt>Ritmo variable: ${fmtEur(p.variable_resto.ritmo_diario)}/día × ${p.dias_restantes} días</dt><dd>${fmtEur(p.variable_resto.total)}</dd>
    <dt class="tot">Gasto previsto a fin de mes</dt><dd class="tot">${fmtEur(p.total)}</dd>
    <dt>Balance previsto</dt><dd>${fmtEur(p.balance_previsto)}</dd></dl>
    ${rec.detalle.length ? `<p class="hint" style="margin-top:8px">Pendientes: ${rec.detalle.map(x => `${esc(x.proveedor)} ${fmtEur(x.importe)} (${fmtFecha(x.fecha_esperada)})`).join(' · ')}</p>` : ''}`;
}
// ---- eventos
function mdMover(k) { MDS.mes = mdMesMas(MDS.mes, k); cargarMiDinero(); }
$('#mdMesAnt').addEventListener('click', () => mdMover(-1));
$('#mdMesSig').addEventListener('click', () => mdMover(1));
$('#mdMes').addEventListener('change', e => { if (mdMesValido(e.target.value)) { MDS.mes = e.target.value; cargarMiDinero(); } });
function abrirIngreso(r) {
  MDS.editId = r ? r.id : null; MDS.borrarId = null;
  $('#ingTit').textContent = r ? 'Editar ingreso' : 'Añadir ingreso';
  $('#ingTipo').value = r ? r.tipo : 'nomina'; $('#ingPer').value = r ? r.periodicidad : 'mensual'; $('#ingConcepto').value = r ? r.concepto : '';
  $('#ingImporte').value = r ? r.importe : ''; $('#ingDia').value = r && r.dia_cobro ? r.dia_cobro : ''; $('#ingIni').value = r ? r.fecha_inicio : MDS.mes + '-01';
  $('#ingFin').value = r && r.fecha_fin ? r.fecha_fin : ''; $('#ingActivo').checked = r ? r.activo : true; $('#ingMsg').textContent = '';
  dlgIng.showModal(); $('#ingConcepto').focus();
}
$('#mdAddIngreso').addEventListener('click', () => abrirIngreso(null));
$('#mdAddIngreso2').addEventListener('click', () => abrirIngreso(null));
$('#ingCancel').addEventListener('click', () => dlgIng.close());
$('#ingForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#ingMsg'); m.className = 'msg'; m.textContent = 'Guardando…';
  const cuerpo = {tipo: $('#ingTipo').value, concepto: $('#ingConcepto').value, importe: $('#ingImporte').value, periodicidad: $('#ingPer').value, fecha_inicio: $('#ingIni').value,
    fecha_fin: $('#ingFin').value || null, dia_cobro: $('#ingDia').value || null, activo: $('#ingActivo').checked};
  try {
    if (MDS.editId) await api('/ingresos?id=' + MDS.editId, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo)});
    else await api('/ingresos', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({cliente_id: Number(mdClienteId())}, cuerpo))});
    dlgIng.close(); toast(MDS.editId ? 'Ingreso actualizado' : 'Ingreso añadido'); cargarMiDinero();
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); }
});
$('#mdIngresos').addEventListener('click', async e => {
  const b = e.target.closest('[data-md]'); if (!b) return;
  const id = +b.dataset.id, r = MDS.ingresos.find(x => x.id === id);
  if (b.dataset.md === 'editar') { abrirIngreso(r); return; }
  if (MDS.borrarId !== id) { MDS.borrarId = id; mdPintar(); const nb = $(`[data-md="borrar"][data-id="${id}"]`); if (nb) nb.focus(); return; }
  try { await api('/ingresos?id=' + id, {method: 'DELETE'}); MDS.borrarId = null; toast('Ingreso borrado'); cargarMiDinero(); }
  catch (err) { toast(err.message); }
});
$('#mdPres').addEventListener('input', e => { const i = e.target.dataset.lim; if (i !== undefined) MDS.draft[+i].limite = e.target.value; });
$('#mdPres').addEventListener('click', e => { const b = e.target.closest('[data-md="quitar"]'); if (!b) return; MDS.draft.splice(+b.dataset.i, 1); mdPintarPres(); $('#mdPresCat').focus(); });
$('#mdPresAdd').addEventListener('click', () => {
  const cat = $('#mdPresCat').value, lim = $('#mdPresLim').value;
  if (!cat) return;
  if (lim === '' || Number(lim) < 0) { $('#mdPresMsg').className = 'msg err'; $('#mdPresMsg').textContent = 'Indica un límite mensual igual o mayor que 0.'; $('#mdPresLim').focus(); return; }
  MDS.draft.push({categoria: cat, limite: lim}); $('#mdPresLim').value = ''; mdPintarPres();
});
$('#mdPresGuardar').addEventListener('click', async () => {
  const m = $('#mdPresMsg'); m.className = 'msg'; m.textContent = 'Guardando…';
  try {
    await api('/presupuestos', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({cliente_id: Number(mdClienteId()), presupuestos: MDS.draft.map(p => ({categoria: p.categoria, limite_mensual: p.limite}))})});
    toast('Presupuestos guardados'); await cargarMiDinero();
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); }
});
// ---- simulador de nómina
$('#btnNomina').addEventListener('click', () => { $('#nomMsg').textContent = ''; dlgNom.showModal(); $('#nomBruto').focus(); });
$('#nomCerrar').addEventListener('click', () => dlgNom.close());
$('#nomForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#nomMsg'); m.className = 'msg'; m.textContent = 'Calculando…';
  const n = id => { const v = $(id).value.trim(); return v === '' ? undefined : v; };
  try {
    const r = await api('/nomina/simular', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({bruto_anual: n('#nomBruto'), num_pagas: Number($('#nomPagas').value), pagas_prorrateadas: $('#nomProrr').checked,
      irpf_pct: n('#nomIrpf'), ss_pct: n('#nomSs'), otros_descuentos_mensuales: n('#nomOtros')})});
    m.textContent = '';
    $('#nomRes').innerHTML = `<table class="fin-tbl"><caption>Nómina mensual estimada</caption><thead><tr><th scope="col">Concepto</th><th scope="col" class="imp">Importe</th></tr></thead><tbody>` +
      r.desglose.map(l => `<tr class="${l.tipo === 'total' ? 'total' : ''}"><th scope="row">${esc(l.concepto)}</th><td class="imp">${fmtEur(l.importe)}</td></tr>`).join('') +
      (r.paga_extra ? `<tr class="subtotal"><th scope="row">Cada paga extra (${r.paga_extra.num} al año)<small>Bruto ${fmtEur(r.paga_extra.bruto)}, SS ${fmtEur(r.paga_extra.ss)}, IRPF ${fmtEur(r.paga_extra.irpf)}</small></th><td class="imp">${fmtEur(r.paga_extra.neto)}</td></tr>` : '') +
      `<tr class="total"><th scope="row">Neto anual estimado<small>${mdPctTxt(r.neto_anual_pct_bruto)} del bruto</small></th><td class="imp">${fmtEur(r.neto_anual)}</td></tr></tbody></table><ul class="fin-avisos">${r.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); $('#nomRes').innerHTML = ''; }
});


/* ---- Uso real: sin doble envío y mensajes sin nombres de campo técnicos ---- */
// Un segundo envío idéntico del mismo formulario en menos de 1,2 s se ignora (un doble clic en «Guardar» creaba dos registros);
// si el usuario cambia algún dato y vuelve a enviar (p. ej. recalcular un finiquito), sí se procesa.
document.addEventListener('submit', e => {
  const f = e.target; if (!f || !f.dataset || f.tagName !== 'FORM') return;
  const huella = [...f.elements].map(x => x.type === 'checkbox' ? x.checked : x.value).join('');
  if (f.dataset.enviando === huella) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  f.dataset.enviando = huella; setTimeout(() => { delete f.dataset.enviando; }, 1200);
}, true);
const ETIQ_CAMPO = {nombre: 'Nombre', importe: 'Importe', concepto: 'Concepto', tipo: 'Tipo', periodicidad: 'Periodicidad', importe_objetivo: 'Objetivo',
  importe_ahorrado: 'Ahorrado', fecha_objetivo: 'Fecha objetivo', aportacion_mensual_prevista: 'Aportación mensual prevista', fecha_inicio: 'Fecha de inicio',
  fecha_fin: 'Fecha de fin', dia_cobro: 'Día de cobro', dia_pago: 'Día de pago', capital_inicial: 'Capital inicial', tipo_interes_anual: 'Interés anual',
  plazo_meses: 'Plazo (meses)', amortizado_extra: 'Amortizado extra', cuota_mensual: 'Cuota mensual', salario_bruto_anual: 'Salario bruto anual',
  num_pagas: 'Nº de pagas', bruto_anual: 'Salario bruto anual', irpf_pct: 'IRPF', ss_pct: 'Seguridad Social', limite_mensual: 'Límite mensual', categoria: 'Categoría', activa: 'Activa', activo: 'Activo',
  tipo_extincion: 'Tipo de baja', vacaciones: 'Vacaciones', preaviso: 'Preaviso'};
function humanizarMsg(t) {
  if (!t || !/"[a-z_]+"/.test(t)) return t;
  let r = t.replace(/"([a-z][a-z_]*)"/g, (m, k) => '«' + (ETIQ_CAMPO[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '))) + '»');
  r = r.replace(/ ?Falta «([^»]+)»\./g, (m, k) => (r.split('«' + k + '»').length > 2 ? '' : m));   // «debe ser > 0» ya lo dice: no añadir «Falta»
  return r.replace(/(\d)\.(\d)/g, (m, a, b) => /\b(entre|euros|importe)/.test(r) ? a + ',' + b : m);
}
(function () {
  const obs = new MutationObserver(ms => { for (const m of ms) { const el = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (!el) continue;
    const h = humanizarMsg(el.textContent); if (h !== el.textContent) el.textContent = h; } });
  for (const id of ['finMsg', 'nomMsg', 'ingMsg', 'mtFormMsg', 'deFormMsg', 'dsMsg', 'mtMsg', 'deMsg', 'mdMsg', 'rsMsg', 'rnMsg', 'mdPresMsg'])
    { const el = document.getElementById(id); if (el) obs.observe(el, {childList: true, characterData: true, subtree: true}); }
})();
