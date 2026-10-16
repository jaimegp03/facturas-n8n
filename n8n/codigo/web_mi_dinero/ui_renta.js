/* ---- Renta (fase 4b) ---- */
window.__miDinero.calcularRenta = calcularRenta; window.__miDinero.rentaAnioDefecto = rentaAnioDefecto;
function demoRenta(D, q, fallo) {
  const con = (st, m) => { const e = fallo(st, m); e.data = {error:m}; return e; };
  const cid = q.get('cliente_id'); if (!cid) throw con(400, '"cliente_id" es obligatorio (GET /clientes).');
  const cli = D.clientes.find(c => String(c.id) === String(cid)); if (!cli) throw con(404, 'No existe el cliente.');
  const anio = q.get('anio') || String(rentaAnioDefecto(D.hoyIso)); if (!rentaAnioValido(anio)) throw con(400, '"anio" debe tener el formato AAAA.');
  const cats = DEMO_CATS.map(([nombre], i) => ({nombre, orden:i + 1, activa:true}));
  return calcularRenta({cliente:cli, anio, hoy:D.hoyIso, ingresos:D.ingresos, presupuestos:D.presupuestos, categorias:cats, facturas:D.facturas});
}
const RNS = {datos: null};
async function cargarRenta() {
  const vig = vigenteMD('rn');
  const sel = $('#rnAnio'), m = $('#rnMsg');
  if (!sel.options.length) {
    const def = rentaAnioDefecto(isoLocal(new Date())), y = +isoLocal(new Date()).slice(0, 4);
    for (let a = y; a >= y - 5; a--) { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); }
    sel.value = String(def);
  }
  try { const r = await api('/renta?cliente_id=' + mdClienteId() + '&anio=' + sel.value); if (!vig()) return; RNS.datos = r; if (m.classList.contains('err')) { m.className = 'msg'; m.textContent = ''; } rnPintar(); }
  catch (err) { if (!vig()) return; RNS.datos = null; m.className = 'msg err'; m.textContent = 'No se pudo cargar la ayuda para la renta: ' + err.message; }
}
function rnPintar() {
  const d = RNS.datos; if (!d) return;
  const k = [['Ingresos del año', fmtEur(d.ingresos.total), d.ingresos.num + (d.ingresos.num === 1 ? ' concepto' : ' conceptos')],
    ['Gasto del año', fmtEur(d.gasto.total), d.gasto.num_facturas + ' facturas'],
    ['Retenciones en facturas', fmtEur(d.retenciones.irpf_soportado), d.retenciones.num_facturas + ' facturas'],
    ['Por revisar', String(d.conviene_revisar.length), d.conviene_revisar.length === 1 ? 'factura' : 'facturas']];
  $('#rnKpis').innerHTML = k.map(([l, v, s]) => `<div class="md-kpi"><div class="l">${esc(l)}</div><div class="v num">${esc(v)}</div><div class="d">${esc(s)}</div></div>`).join('');
  $('#rnAviso').textContent = d.aviso_legal;
  $('#rnCats').innerHTML = '<caption class="sr-only">Gasto de ' + d.anio + ' por categoría</caption><thead><tr><th scope="col">Categoría</th><th scope="col" class="imp">Facturas</th><th scope="col" class="imp">Total</th><th scope="col" class="imp">% del gasto</th></tr></thead><tbody>'
    + (d.gasto.por_categoria.length ? d.gasto.por_categoria.map(c => '<tr><th scope="row" class="nombre">' + esc(c.categoria) + '</th><td class="imp">' + c.num + '</td><td class="imp">' + fmtEur(c.total) + '</td><td class="imp">' + esc(mdPctTxt(c.pct)) + '</td></tr>').join('')
      : '<tr><td colspan="4" class="hint">No hay facturas en ' + d.anio + '.</td></tr>') + '</tbody>';
  $('#rnDed').innerHTML = d.posibles_deducciones.length ? d.posibles_deducciones.map(x => `<li><span class="chip warn">${esc(x.etiqueta)}</span><span><strong>${esc(x.concepto)}</strong>: ${esc(fmtEur(x.total))} (${x.num}). ${esc(x.nota)}</span></li>`).join('')
    : '<li class="hint">No se ha detectado ningún concepto. Esto no significa que no exista alguno: confírmalo con tu gestor.</li>';
  $('#rnRevisar').innerHTML = d.conviene_revisar.length ? d.conviene_revisar.map(x => `<li><span class="chip bad">Revisar</span><span>${esc(x.proveedor)}${x.numero ? ' · ' + esc(x.numero) : ''} (${esc(fmtFecha(x.fecha))}): ${esc(x.motivos.join(', '))}.</span></li>`).join('')
    : '<li class="hint">Todas las facturas del año están en orden.</li>';
  $('#rnAvisos').innerHTML = d.avisos.map(a => `<li><span class="chip info">Aviso</span><span>${esc(a)}</span></li>`).join('');
}
$('#rnAnio').addEventListener('change', cargarRenta);
$('#rnCopiar').addEventListener('click', async () => {
  const m = $('#rnMsg'), t = RNS.datos && RNS.datos.texto; if (!t) return;
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('aria-hidden', 'true'); document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* sin portapapeles */ } ta.remove(); }
  m.className = 'msg'; m.textContent = 'Resumen de la renta copiado al portapapeles.'; toast('Resumen copiado');
});
$('#rnCsv').addEventListener('click', () => {
  const d = RNS.datos; if (!d) return;
  const url = URL.createObjectURL(new Blob([d.csv], {type: 'text/csv;charset=utf-8'})), a = document.createElement('a');
  a.href = url; a.download = d.csv_nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('CSV descargado');
});
