/* ---- Deudas y préstamos (fase 4b) ---- */
window.__miDinero.calcularDeuda = calcularDeuda; window.__miDinero.calcularResumenDeudas = calcularResumenDeudas;
window.__miDinero.simularDeuda = simularDeuda; window.__miDinero.validarDeuda = validarDeuda;
function mdDemoDeudas(hoyIso) {
  const f = (id, cliente_id, nombre, tipo, cap, tae, plazo, meses, extra) => ({id, cliente_id, nombre, tipo, capital_inicial:cap, tipo_interes_anual:tae, plazo_meses:plazo, fecha_inicio:mdSumaMeses(hoyIso, -meses), cuota_mensual:null, dia_pago:null, amortizado_extra:extra, activa:true, creada:hoyIso});
  return [f(1, 1, 'Hipoteca vivienda', 'hipoteca', 120000, 2.9, 300, 36, 0), f(2, 1, 'Préstamo del coche', 'coche', 12000, 4.5, 60, 14, 1000), f(3, 2, 'Préstamo del local', 'prestamo', 40000, 5, 120, 20, 0), f(4, 2, 'Tarjeta de empresa', 'tarjeta', 3000, 18, 24, 6, 0)];
}
function demoDeudas(D, ruta, met, q, body, fallo) {
  const con = (st, m, det) => { const e = fallo(st, m); e.data = det ? {error:m, detalles:det} : {error:m}; return e; };
  const cliDe = id => D.clientes.find(c => String(c.id) === String(id));
  if (ruta === '/deudas/resumen' || (ruta === '/deudas' && met === 'GET')) {
    const cid = q.get('cliente_id'); if (!cid) throw con(400, '"cliente_id" es obligatorio (GET /clientes).');
    const cli = cliDe(cid); if (!cli) throw con(404, 'No existe el cliente.');
    if (ruta === '/deudas/resumen') return calcularResumenDeudas({cliente:cli, hoy:D.hoyIso, ingresos:D.ingresos, deudas:D.deudas});
    const items = D.deudas.filter(d => String(d.cliente_id) === String(cid)).sort((a, b) => a.id - b.id).map(d => calcularDeuda(d, D.hoyIso));
    return {cliente_id:+cid, items, total:items.length};
  }
  if (ruta === '/deudas' && met === 'POST') {
    const cli = cliDe(body && body.cliente_id); if (!cli) throw con(404, 'No existe el cliente.');
    const r = validarDeuda(body, null); if (r.errores.length) throw con(422, 'Deuda no válida.', r.errores);
    const fila = Object.assign({}, r.fila, {id:D.sigDeuda++, cliente_id:cli.id, creada:new Date().toISOString()}); D.deudas.push(fila); return {deuda:calcularDeuda(fila, D.hoyIso)};
  }
  const fila = D.deudas.find(x => String(x.id) === q.get('id')); if (!fila) throw con(404, 'No existe la deuda.');
  if (met === 'DELETE') { D.deudas.splice(D.deudas.indexOf(fila), 1); return {borrado:true, id:fila.id}; }
  if (ruta === '/deudas/simular') { const r = simularDeuda(fila, D.hoyIso, body || {}); if (r.status !== 200) throw con(r.status, r.body.error, r.body.detalles); return r.body; }
  const r = validarDeuda(body || {}, fila); if (r.errores.length) throw con(422, 'Deuda no válida.', r.errores);
  Object.assign(fila, r.fila); return {deuda:calcularDeuda(fila, D.hoyIso)};
}
const DES = {datos: null, resumen: null, borrarId: null, editId: null, simId: null}, dlgDeuda = $('#dlgDeuda'), dlgSim = $('#dlgSimular');
const DE_ESTADO = {vigente: ['ok', 'En curso', 'ok'], liquidada: ['ok', 'Liquidada', 'ok'], inactiva: ['', 'Inactiva', 'info']};
async function cargarDeudas() {
  const vig = vigenteMD('de');
  const cid = mdClienteId(), m = $('#deMsg'); m.className = 'msg';
  try { const [a, r] = await Promise.all([api('/deudas?cliente_id=' + cid), api('/deudas/resumen?cliente_id=' + cid)]); if (!vig()) return; DES.datos = a; DES.resumen = r; m.textContent = ''; dePintar(); }
  catch (err) { if (!vig()) return; DES.datos = null; m.className = 'msg err'; m.textContent = 'No se pudieron cargar las deudas: ' + err.message; }
}
function dePintar() {
  const d = DES.datos, r = DES.resumen; if (!d || !r) return;
  $('#deResumen').textContent = !d.items.length ? '' : 'Capital pendiente: ' + fmtEur(r.capital_pendiente) + ' · intereses por pagar: ' + fmtEur(r.intereses_por_pagar) + ' · cuotas al mes: ' + fmtEur(r.carga_mensual)
    + (r.pct_ingresos == null ? '' : ' (' + mdPctTxt(r.pct_ingresos) + ' de tus ingresos del mes)') + (r.proximos_vencimientos.length ? ' · próximo pago: ' + r.proximos_vencimientos[0].nombre + ' el ' + fmtFecha(r.proximos_vencimientos[0].fecha) + ' (' + fmtEur(r.proximos_vencimientos[0].importe) + ')' : '') + '.';
  $('#deAvisos').innerHTML = r.avisos.map(a => `<li><span class="chip warn">Aviso</span><span>${esc(a)}</span></li>`).join('');
  $('#deLista').innerHTML = d.items.length ? d.items.map(x => {
    const [chip, txt, barra] = DE_ESTADO[x.estado] || ['', x.estado, 'info'], pct = Math.min(100, x.pct_amortizado || 0), borr = DES.borrarId === x.id;
    const detalle = x.estado === 'liquidada' ? 'Deuda liquidada.' : x.meses_restantes == null ? 'Con esta cuota la deuda no se amortiza.' : 'Cuota ' + fmtEur(x.cuota_mensual) + ' · quedan ' + x.meses_restantes + (x.meses_restantes === 1 ? ' mes' : ' meses') + ' (hasta el ' + fmtFecha(x.fecha_fin) + ') · intereses por pagar ' + fmtEur(x.intereses_por_pagar);
    return `<article class="de-card" data-deuda="${x.id}" data-estado="${esc(x.estado)}" aria-label="Deuda ${esc(x.nombre)}">
      <header><h4>${esc(x.nombre)}</h4><span class="chip ${chip}">${esc(txt)}</span></header>
      <div class="md-barra ${barra}" role="progressbar" aria-label="Capital amortizado de ${esc(x.nombre)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${esc(fmtEur(x.capital_amortizado) + ' de ' + fmtEur(x.capital_inicial))}"><i style="width:${pct}%"></i></div>
      <p class="mt-num">Pendiente ${esc(fmtEur(x.capital_pendiente))} de ${esc(fmtEur(x.capital_inicial))} · ${esc(mdPctTxt(x.pct_amortizado))} amortizado</p>
      <p class="hint">${esc(detalle)}</p>${x.avisos.length ? '<ul class="mt-av">' + x.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : ''}
      <div class="mt-acc">
        <button class="btn btn-sm btn-primary" type="button" data-de="simular" data-id="${x.id}" aria-haspopup="dialog" aria-label="Simular una amortización de ${esc(x.nombre)}">Simular</button>
        <button class="btn btn-sm" type="button" data-de="editar" data-id="${x.id}" aria-label="Editar la deuda ${esc(x.nombre)}">Editar</button>
        <button class="btn btn-sm btn-ghost btn-danger" type="button" data-de="borrar" data-id="${x.id}" aria-label="${borr ? 'Confirmar el borrado de' : 'Borrar'} la deuda ${esc(x.nombre)}">${borr ? '¿Seguro?' : 'Borrar'}</button></div>
    </article>`; }).join('')
    : '<p class="hint mt-vacio">No tienes deudas registradas. Añade una hipoteca o un préstamo para ver cuánto te queda, cuánto pagas de intereses y qué pasaría si amortizas más.</p><button class="btn btn-sm btn-primary" type="button" data-cta="deAdd">Añadir una deuda</button>';
}
function abrirDeuda(x) {
  DES.editId = x ? x.id : null; $('#deTit').textContent = x ? 'Editar deuda' : 'Nueva deuda';
  $('#deNombre').value = x ? x.nombre : ''; $('#deTipo').value = x ? x.tipo : 'prestamo'; $('#deCapital').value = x ? x.capital_inicial : ''; $('#deInteres').value = x ? x.tipo_interes_anual : '';
  $('#dePlazo').value = x ? x.plazo_meses : ''; $('#deInicio').value = x ? x.fecha_inicio : ''; $('#deDia').value = x && x.dia_pago != null ? x.dia_pago : '';
  $('#deCuota').value = x && x.cuota_indicada ? x.cuota_mensual : ''; $('#deExtra').value = x ? x.amortizado_extra : 0; $('#deActiva').checked = x ? x.activa : true;
  $('#deFormMsg').textContent = ''; dlgDeuda.showModal(); $('#deNombre').focus();
}
$('#deAdd').addEventListener('click', () => abrirDeuda(null));
$('#deCancel').addEventListener('click', () => dlgDeuda.close());
$('#deForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#deFormMsg'); m.className = 'msg'; m.textContent = 'Guardando…';
  const cuerpo = {nombre: $('#deNombre').value, tipo: $('#deTipo').value, capital_inicial: $('#deCapital').value, tipo_interes_anual: $('#deInteres').value, plazo_meses: $('#dePlazo').value, fecha_inicio: $('#deInicio').value,
    dia_pago: $('#deDia').value === '' ? null : $('#deDia').value, cuota_mensual: $('#deCuota').value === '' ? null : $('#deCuota').value, amortizado_extra: $('#deExtra').value || 0, activa: $('#deActiva').checked};
  try {
    if (DES.editId) await api('/deudas?id=' + DES.editId, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo)});
    else await api('/deudas', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({cliente_id: Number(mdClienteId())}, cuerpo))});
    dlgDeuda.close(); toast(DES.editId ? 'Deuda actualizada' : 'Deuda creada'); cargarDeudas();
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); }
});
$('#deLista').addEventListener('click', async e => {
  const b = e.target.closest('[data-de]'); if (!b) return;
  const id = +b.dataset.id, x = DES.datos.items.find(v => v.id === id), msg = $('#deMsg');
  if (b.dataset.de === 'editar') { abrirDeuda(x); return; }
  if (b.dataset.de === 'simular') { DES.simId = id; $('#dsTit').textContent = 'Simular amortización: ' + x.nombre; $('#dsImporte').value = ''; $('#dsMsg').textContent = ''; $('#dsMsg').className = 'msg'; $('#dsTabla').innerHTML = ''; $('#dsAhorro').textContent = ''; dlgSim.showModal(); $('#dsImporte').focus(); return; }
  if (DES.borrarId !== id) { DES.borrarId = id; dePintar(); const nb = $('[data-de="borrar"][data-id="' + id + '"]'); if (nb) nb.focus(); return; }
  try { await api('/deudas?id=' + id, {method: 'DELETE'}); DES.borrarId = null; toast('Deuda borrada'); cargarDeudas(); } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
});
$('#dsCerrar').addEventListener('click', () => dlgSim.close());
$('#dsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#dsMsg'); m.className = 'msg'; m.textContent = 'Calculando…';
  try {
    const s = await api('/deudas/simular?id=' + DES.simId, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({amortizacion_extra: $('#dsImporte').value, tipo: $('#dsTipo').value})});
    m.textContent = '';
    const f = (t, k, fm) => '<tr><th scope="row" class="nombre">' + t + '</th><td class="imp">' + fm(s.antes[k]) + '</td><td class="imp">' + fm(s.despues[k]) + '</td></tr>', mes = n => n + (n === 1 ? ' mes' : ' meses');
    $('#dsTabla').innerHTML = '<caption class="sr-only">Comparativa antes y después de amortizar</caption><thead><tr><th scope="col"></th><th scope="col" class="imp">Antes</th><th scope="col" class="imp">Después</th></tr></thead><tbody>'
      + f('Capital pendiente', 'capital_pendiente', fmtEur) + f('Cuota mensual', 'cuota_mensual', fmtEur) + f('Plazo restante', 'meses_restantes', mes) + f('Fecha de fin', 'fecha_fin', fmtFecha) + f('Intereses por pagar', 'intereses_por_pagar', fmtEur) + '</tbody>';
    $('#dsAhorro').textContent = 'Ahorrarías ' + fmtEur(s.ahorro_intereses) + ' en intereses' + (s.meses_ahorrados ? ' y terminarías ' + mes(s.meses_ahorrados) + ' antes' : '') + (s.cuota_ahorrada ? '; la cuota bajaría ' + fmtEur(s.cuota_ahorrada) + ' al mes' : '') + '. ' + s.avisos[0];
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); $('#dsTabla').innerHTML = ''; $('#dsAhorro').textContent = ''; }
});
