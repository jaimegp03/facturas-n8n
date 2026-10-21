/* (la vista se guarda aunque la demo esté activa: es solo una preferencia de pantalla) */
/* ================= vistas: Facturas | Mi dinero (hash) ================= */
const MD_SECS = ['resumen', 'ingresos', 'metas', 'deudas', 'renta', 'herramientas'];
const VIS = {vista: 'facturas', sec: 'resumen'};
function leerHash() {
  const h = location.hash, m = h.match(/^#\/(facturas|mi-dinero)(?:\/([a-z]+))?\/?(?:\?[^#]*)?$/);
  if (m) return {vista: m[1], sec: MD_SECS.includes(m[2]) ? m[2] : 'resumen'};
  if (/^#c[1-4]$/.test(h)) return {vista: 'facturas', sec: VIS.sec, ancla: h.slice(1)};
  return null;
}
function etiquetaTodos() {
  const o = $('#selCliente').options[0];
  if (o && o.value === '') o.textContent = VIS.vista === 'mi-dinero' ? 'Personal (por defecto)' : 'Todos los clientes';
}
function aplicarVista(v, sec, ancla) {
  const cambio = v !== VIS.vista, md = v === 'mi-dinero';
  VIS.vista = v; VIS.sec = sec;
  try { localStorage.setItem('facturas.vista', JSON.stringify(v)); } catch {}
  document.body.dataset.vista = md ? 'md' : 'fac';
  $('#sceneFac').hidden = md; $('#sceneMd').hidden = !md;
  if (md) { $('#tabVistaFac').removeAttribute('aria-current'); $('#tabVistaMd').setAttribute('aria-current', 'page'); }
  else { $('#tabVistaMd').removeAttribute('aria-current'); $('#tabVistaFac').setAttribute('aria-current', 'page'); }
  $$('.mdsec').forEach(s => { s.hidden = s.dataset.sec !== sec; });
  $$('#navMd .mdn').forEach(li => {
    const on = li.dataset.sec === sec; li.classList.toggle('active', on);
    const a = $('a', li); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  $('#mdBar').hidden = !(md && (sec === 'resumen' || sec === 'ingresos'));
  const skip = $('.skip'); skip.setAttribute('href', md ? '#mainMd' : '#c2'); skip.textContent = md ? 'Saltar al contenido' : 'Saltar a la lista de facturas';
  document.title = md ? 'Mi dinero · Facturas' : 'Facturas';
  etiquetaTodos();
  document.documentElement.style.setProperty('--top-h', $('#top').offsetHeight + 'px');
  if (md) { scrollTo(0, 0); const a = $('#navMd .mdn.active a'); if (a && narrow()) a.parentElement.parentElement.scrollTo({left: a.parentElement.offsetLeft - 16}); }
  else { capituloActivo(); if (ancla) { const el = document.getElementById(ancla); if (el) el.scrollIntoView(); } else if (cambio) scrollTo(0, 0); }
}
function sincronizarVista() {
  const r = leerHash();
  if (r) return aplicarVista(r.vista, r.sec, r.ancla);
  // sin ruta en la URL: la vista recordada es solo una comodidad
  let guardada = null; try { guardada = JSON.parse(localStorage.getItem('facturas.vista')); } catch {}
  if (guardada === 'mi-dinero') { history.replaceState(null, '', '#/mi-dinero/' + VIS.sec); return aplicarVista('mi-dinero', VIS.sec); }
  aplicarVista(VIS.vista, VIS.sec);
}
addEventListener('hashchange', sincronizarVista);
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-cta]'); if (b) { const t = $('#' + b.dataset.cta); if (t) t.click(); }
});
