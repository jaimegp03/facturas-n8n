/* ---- Metas de ahorro y resumen del mes (fase 4a) ---- */
window.__miDinero.calcularMetas = calcularMetas; window.__miDinero.calcularResumenMensual = calcularResumenMensual;
window.__miDinero.validarMeta = validarMeta; window.__miDinero.aportarMeta = aportarMeta;
function mdDemoMetas(hoyIso) {
  const f = (id, cliente_id, nombre, obj, ah, meses, prev) => ({id, cliente_id, nombre, importe_objetivo:obj, importe_ahorrado:ah, fecha_objetivo:mdSumaMeses(hoyIso, meses), aportacion_mensual_prevista:prev, activa:true, creada:hoyIso});
  return [f(1, 1, 'Vacaciones de verano', 1800, 650, 8, null), f(2, 1, 'Fondo de emergencia', 6000, 2400, 18, 250), f(3, 2, 'Reforma de la cocina', 8000, 1500, 10, null), f(4, 2, 'Fondo para impuestos', 12000, 3000, 6, 800), f(5, 2, 'Horno nuevo', 3500, 3500, 4, null)];
}
function demoMetas(D, ruta, met, q, body, fallo) {
  const con = (st, m, det) => { const e = fallo(st, m); e.data = det ? {error:m, detalles:det} : {error:m}; return e; };
  const cliDe = id => D.clientes.find(c => String(c.id) === String(id));
  const calc = cli => calcularMetas({cliente:cli, hoy:D.hoyIso, ingresos:D.ingresos, facturas:D.facturas, metas:D.metas});
  if (ruta === '/resumen-mensual' || (ruta === '/metas' && met === 'GET')) {
    const cid = q.get('cliente_id'); if (!cid) throw con(400, '"cliente_id" es obligatorio (GET /clientes).');
    const cli = cliDe(cid); if (!cli) throw con(404, 'No existe el cliente.');
    if (ruta === '/metas') return calc(cli);
    const mes = q.get('mes') || D.hoyIso.slice(0, 7); if (!mdMesValido(mes)) throw con(400, '"mes" debe tener el formato AAAA-MM.');
    const cats = DEMO_CATS.map(([nombre], i) => ({nombre, orden:i + 1, activa:true}));
    return calcularResumenMensual({cliente:cli, mes, hoy:D.hoyIso, ingresos:D.ingresos, presupuestos:D.presupuestos, categorias:cats, facturas:D.facturas, metas:D.metas});
  }
  const salida = fila => calc(cliDe(fila.cliente_id)).items.find(m => m.id === fila.id);
  if (ruta === '/metas' && met === 'POST') {
    const cli = cliDe(body && body.cliente_id); if (!cli) throw con(404, 'No existe el cliente.');
    const r = validarMeta(body, null, D.hoyIso); if (r.errores.length) throw con(422, 'Meta no válida.', r.errores);
    const fila = Object.assign({}, r.fila, {id:D.sigMeta++, cliente_id:cli.id, creada:new Date().toISOString()}); D.metas.push(fila); return {meta:salida(fila)};
  }
  const fila = D.metas.find(x => String(x.id) === q.get('id')); if (!fila) throw con(404, 'No existe la meta.');
  if (met === 'DELETE') { D.metas.splice(D.metas.indexOf(fila), 1); return {borrado:true, id:fila.id}; }
  if (ruta === '/metas/aportar') { const r = aportarMeta(fila, body && body.importe); if (r.error) throw con(422, 'Aportación no válida.', [r.error]); fila.importe_ahorrado = r.ahorrado; return {meta:salida(fila), aportado:mdEur(mdCent(mdNumero(body.importe)))}; }
  const r = validarMeta(body || {}, fila, D.hoyIso); if (r.errores.length) throw con(422, 'Meta no válida.', r.errores);
  Object.assign(fila, r.fila); return {meta:salida(fila)};
}
const MTS = {datos: null, resumen: null, borrarId: null, editId: null}, dlgMeta = $('#dlgMeta');
const MT_ESTADO = {conseguida: ['ok', 'Conseguida', 'ok'], en_camino: ['ok', 'En camino', 'ok'], justa: ['warn', 'Justa', 'aviso'], atrasada: ['bad', 'Atrasada', 'superado'], pausada: ['', 'Pausada', 'info']};
async function cargarMetas() {
  const vig = vigenteMD('mt');
  const cid = mdClienteId(), m = $('#mtMsg'); m.className = 'msg';
  try { const r = await api('/metas?cliente_id=' + cid); if (!vig()) return; MTS.datos = r; m.textContent = ''; mtPintar(); }
  catch (err) { if (!vig()) return; MTS.datos = null; m.className = 'msg err'; m.textContent = 'No se pudieron cargar las metas: ' + err.message; }
}
async function cargarResumenMes() {
  const m = $('#rsMsg'), vig = vigenteMD('rs');
  try { const r = await api('/resumen-mensual?cliente_id=' + mdClienteId() + '&mes=' + MDS.mes); if (!vig()) return; MTS.resumen = r; if (m.classList.contains('err')) { m.className = 'msg'; m.textContent = ''; } rsPintar(); }
  catch (err) { if (!vig()) return; MTS.resumen = null; m.className = 'msg err'; m.textContent = 'No se pudo cargar el resumen: ' + err.message; }
}
function mtPintar() {
  const d = MTS.datos; if (!d) return;
  const r = d.resumen;
  $('#mtResumen').textContent = !d.items.length ? '' : r.ahorro_mensual_libre == null ? 'Aún no hay datos de los 3 últimos meses para estimar tu ahorro libre.'
    : 'Tu ahorro libre al mes es de ' + fmtEur(r.ahorro_mensual_libre) + '; entre todas tus metas necesitas ' + fmtEur(r.suma_aportaciones_necesarias) + ' al mes.' + (r.cubre === false ? ' No alcanza para todas a la vez.' : '');
  $('#mtLista').innerHTML = d.items.length ? d.items.map(m => {
    const [chip, txt, barra] = MT_ESTADO[m.estado] || ['', m.estado, 'info'], pct = Math.min(100, m.pct_conseguido || 0);
    const detalle = m.estado === 'conseguida' ? '¡Meta conseguida!' : 'Faltan ' + fmtEur(m.restante) + ' · ' + m.meses_restantes + (m.meses_restantes === 1 ? ' mes' : ' meses') + ' hasta el ' + fmtFecha(m.fecha_objetivo) + ' · necesitas ' + fmtEur(m.aportacion_necesaria) + '/mes'
      + (m.fecha_estimada ? ' · al ritmo actual llegarías el ' + fmtFecha(m.fecha_estimada) : '');
    const borr = MTS.borrarId === m.id;
    return `<article class="mt-card" data-meta="${m.id}" data-estado="${esc(m.estado)}" aria-label="Meta ${esc(m.nombre)}">
      <header><h4>${esc(m.nombre)}</h4><span class="chip ${chip}">${esc(txt)}</span></header>
      <div class="md-barra ${barra}" role="progressbar" aria-label="Progreso de ${esc(m.nombre)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${esc(fmtEur(m.importe_ahorrado) + ' de ' + fmtEur(m.importe_objetivo))}"><i style="width:${pct}%"></i></div>
      <p class="mt-num">${esc(fmtEur(m.importe_ahorrado))} de ${esc(fmtEur(m.importe_objetivo))} · ${esc(mdPctTxt(m.pct_conseguido))}</p>
      <p class="hint">${esc(detalle)}</p>${m.avisos.length ? '<ul class="mt-av">' + m.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : ''}
      <div class="mt-acc"><label class="sr-only" for="mtImp${m.id}">Importe a aportar a ${esc(m.nombre)} en euros (negativo para retirar)</label><input id="mtImp${m.id}" type="number" step="any" inputmode="decimal" placeholder="± €" data-mtimp="${m.id}">
        <button class="btn btn-sm btn-primary" type="button" data-mt="aportar" data-id="${m.id}">Aportar</button>
        <button class="btn btn-sm" type="button" data-mt="editar" data-id="${m.id}" aria-label="Editar la meta ${esc(m.nombre)}">Editar</button>
        <button class="btn btn-sm btn-ghost btn-danger" type="button" data-mt="borrar" data-id="${m.id}" aria-label="${borr ? 'Confirmar el borrado de' : 'Borrar'} la meta ${esc(m.nombre)}">${borr ? '¿Seguro?' : 'Borrar'}</button></div>
    </article>`; }).join('')
    : '<p class="hint mt-vacio">Aún no tienes metas. Crea una (unas vacaciones, un fondo de emergencia…) y verás cuánto ahorrar cada mes para llegar a tiempo.</p><button class="btn btn-sm btn-primary" type="button" data-cta="mtAdd">Crear mi primera meta</button>';
}
function rsPintar() {
  const r = MTS.resumen; if (!r) return;
  const fila = (t, x) => '<tr><th scope="row" class="nombre">' + t + '</th><td class="imp">' + fmtEur(x.actual) + '</td><td class="imp">' + fmtEur(x.mes_anterior) + '</td><td class="imp">' + fmtEur(x.media_3m) + '</td></tr>';
  $('#rsTabla').innerHTML = '<caption class="sr-only">Resumen de ' + esc(mdNombreMes(r.mes)) + '</caption><thead><tr><th scope="col">' + esc(mdNombreMes(r.mes)) + '</th><th scope="col" class="imp">Este mes</th><th scope="col" class="imp">Mes anterior</th><th scope="col" class="imp">Media 3 meses</th></tr></thead><tbody>'
    + fila('Ingresos', r.ingresos) + fila('Gasto', r.gasto) + fila('Ahorro', r.ahorro) + '</tbody>';
  $('#rsTexto').textContent = r.texto;
}
async function mtCopiar() {
  const m = $('#rsMsg'), t = MTS.resumen && MTS.resumen.texto; if (!t) return;
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('aria-hidden', 'true'); document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* sin portapapeles */ } ta.remove(); }
  m.className = 'msg'; m.textContent = 'Resumen copiado al portapapeles.'; toast('Resumen copiado');
}
$('#rsCopiar').addEventListener('click', mtCopiar);
function abrirMeta(m) {
  MTS.editId = m ? m.id : null; $('#mtTit').textContent = m ? 'Editar meta' : 'Nueva meta de ahorro';
  $('#mtNombre').value = m ? m.nombre : ''; $('#mtObjetivo').value = m ? m.importe_objetivo : ''; $('#mtAhorrado').value = m ? m.importe_ahorrado : 0;
  $('#mtFecha').value = m ? m.fecha_objetivo : ''; $('#mtPrev').value = m && m.aportacion_mensual_prevista != null ? m.aportacion_mensual_prevista : ''; $('#mtActiva').checked = m ? m.activa : true;
  $('#mtFormMsg').textContent = ''; dlgMeta.showModal(); $('#mtNombre').focus();
}
$('#mtAdd').addEventListener('click', () => abrirMeta(null));
$('#mtCancel').addEventListener('click', () => dlgMeta.close());
$('#mtForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#mtFormMsg'); m.className = 'msg'; m.textContent = 'Guardando…';
  const cuerpo = {nombre: $('#mtNombre').value, importe_objetivo: $('#mtObjetivo').value, importe_ahorrado: $('#mtAhorrado').value || 0, fecha_objetivo: $('#mtFecha').value,
    aportacion_mensual_prevista: $('#mtPrev').value === '' ? null : $('#mtPrev').value, activa: $('#mtActiva').checked};
  try {
    if (MTS.editId) await api('/metas?id=' + MTS.editId, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo)});
    else await api('/metas', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({cliente_id: Number(mdClienteId())}, cuerpo))});
    dlgMeta.close(); toast(MTS.editId ? 'Meta actualizada' : 'Meta creada'); cargarMetas(); cargarResumenMes();
  } catch (err) { m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); }
});
$('#mtLista').addEventListener('click', async e => {
  const b = e.target.closest('[data-mt]'); if (!b) return;
  const id = +b.dataset.id, m = MTS.datos.items.find(x => x.id === id), msg = $('#mtMsg');
  if (b.dataset.mt === 'editar') { abrirMeta(m); return; }
  if (b.dataset.mt === 'borrar') {
    if (MTS.borrarId !== id) { MTS.borrarId = id; mtPintar(); const nb = $('[data-mt="borrar"][data-id="' + id + '"]'); if (nb) nb.focus(); return; }
    try { await api('/metas?id=' + id, {method: 'DELETE'}); MTS.borrarId = null; toast('Meta borrada'); cargarMetas(); cargarResumenMes(); } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
    return;
  }
  const inp = $('#mtImp' + id); msg.className = 'msg';
  try {
    await api('/metas/aportar?id=' + id, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({importe: inp.value})});
    toast(Number(inp.value) < 0 ? 'Retirada registrada' : 'Aportación registrada'); await cargarMetas(); cargarResumenMes();
    const nb = $('[data-mt="aportar"][data-id="' + id + '"]'); if (nb) nb.focus();
  } catch (err) { msg.className = 'msg err'; msg.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); inp.focus(); }
});
