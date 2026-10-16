// Mide el comportamiento de la lista al scroll y al hover (demo, sin n8n).
// uso: node medir_scroll.js <index.html> <salida.json>
const { chromium } = require('@playwright/test');
const path = require('path'), fs = require('fs');
const web = path.resolve(process.argv[2] && require.main === module ? process.argv[2] : path.join(__dirname, '..', '..', 'web', 'index.html')), salida = path.resolve(process.argv[3] || path.join(__dirname, '..', 'salida', 'scroll-medida.json'));
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
async function una(b, vw, vh) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'es-ES' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem('facturas.demo', 'true'); });
  await p.goto('file:///' + web.split(String.fromCharCode(92)).join('/'));
  await p.locator('#list .row').first().waitFor(); await p.waitForTimeout(1500);
  const filas = await p.locator('#list .row').count();
  await p.evaluate(() => {
    const L = window.__m = { cambios: 0, scrollProg: 0, ls: 0, lt: 0, ltMax: 0, frames: 0, bajadas: 0, ultimoY: scrollY, dirWheel: 1 };
    const sb = window.scrollBy.bind(window), st = window.scrollTo.bind(window);
    window.scrollBy = (...a) => { L.scrollProg++; return sb(...a); }; window.scrollTo = (...a) => { L.scrollProg++; return st(...a); };
    new MutationObserver(ms => ms.forEach(m => { if (m.target.classList && m.target.classList.contains('row') && m.attributeName === 'class') { const o = (m.oldValue || '').includes('open'), n = m.target.classList.contains('open'); if (o !== n) L.cambios++; } }))
      .observe(document.querySelector('#list'), { attributes: true, subtree: true, attributeOldValue: true, attributeFilter: ['class'] });
    try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) L.ls += e.value; })).observe({ type: 'layout-shift', buffered: false }); } catch {}
    try { new PerformanceObserver(l => l.getEntries().forEach(e => { L.lt += e.duration; L.ltMax = Math.max(L.ltMax, e.duration); })).observe({ type: 'longtask' }); } catch {}
    const tick = () => { L.frames++; if (scrollY < L.ultimoY - 0.5 && window.__dir > 0) L.bajadas++; L.ultimoY = scrollY; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  // llevar la lista a la vista
  await p.evaluate(() => document.querySelector('#list').scrollIntoView({ block: 'start' })); await p.waitForTimeout(400);
  await p.evaluate(() => { window.__ev = []; const f = (n) => e => window.__ev.push([Math.round(performance.now() - (window.__t0||0)), n, scrollY|0]); addEventListener('scroll', f('scroll'), true); document.addEventListener('mousemove', e => window.__ev.push([Math.round(performance.now() - (window.__t0||0)), 'move', e.clientX|0, e.clientY|0]), true); new MutationObserver(ms => ms.forEach(m => { if (m.target.classList.contains('row')) window.__ev.push([Math.round(performance.now() - (window.__t0||0)), 'cls', m.target.dataset.id, m.target.classList.contains('open')]); })).observe(document.querySelector('#list'), {attributes:true, subtree:true, attributeFilter:['class']}); });
  const res = { filas, viewport: [vw, vh] };
  // filas completas visibles
  res.filasCompletas = await p.evaluate(() => [...document.querySelectorAll('#list .row')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }).length);
  const fase = async temblor => {
    await p.mouse.move(vw * 0.35, vh * 0.5); await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('#list').scrollIntoView({ block: 'start' })); await p.waitForTimeout(300);
    await p.evaluate(() => { const L = window.__m; L.cambios = 0; L.scrollProg = 0; L.ls = 0; L.lt = 0; L.ltMax = 0; L.frames = 0; L.bajadas = 0; L.ultimoY = scrollY; window.__dir = 1; });
    const t0 = Date.now(); let dir = 1, n = 0;
    while (Date.now() - t0 < 3000) {
      await p.mouse.wheel(0, 120 * dir); await p.waitForTimeout(30); n++;
      if (temblor && n % 4 === 0) await p.mouse.move(vw * 0.35 + (n % 8 ? 2 : 0), vh * 0.5 + (n % 8 ? 0 : 1));
      const y = await p.evaluate(() => { const b = document.querySelector('#list').getBoundingClientRect(); return [b.bottom, b.top]; }); if (y[0] < 450) dir = -1; if (y[1] > 0) dir = 1;
      await p.evaluate(d => { window.__dir = 0; setTimeout(() => window.__dir = d, 400); }, dir);
    }
    await p.waitForTimeout(600);
    return await p.evaluate(() => { const L = window.__m; return { filasAbiertasCerradas: L.cambios, scrollProgramatico: L.scrollProg, saltosAtras: L.bajadas, layoutShift: +L.ls.toFixed(4), longTaskMs: Math.round(L.lt), longTaskMax: Math.round(L.ltMax), fps: Math.round(L.frames / 3.6) }; });
  };
  res.rueda = await fase(false);
  res.ruedaConTemblor = await fase(true);
  await p.evaluate(() => document.querySelector('#list').scrollIntoView({ block: 'start' })); await p.evaluate(() => scrollBy(0, 300)); await p.waitForTimeout(300);
  // 2) puntería: 30 intentos aleatorios (15 tras un scroll de rueda)
  const apuntar = async (n, conRueda, arriba) => {
  let aciertos = 0, fallos = [], last = null;
    if (arriba) { await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(300); }
  for (let i = 0; i < n; i++) {
    if (false) await p.evaluate(() => { window.__ev = []; window.__t0 = performance.now(); });
    if (conRueda && i % 2) { await p.mouse.wheel(0, (rnd() < .5 ? -1 : 1) * (100 + rnd() * 200)); await p.waitForTimeout(rnd() < .5 ? 20 : 120); }
    const objetivo = await p.evaluate(rnd => { const rs = [...document.querySelectorAll('#list .row')].map(r => r.querySelector('.row-head')).filter(h => { const b = h.getBoundingClientRect(); return b.top > 60 && b.bottom < innerHeight - 10; }); if (!rs.length) return null; const h = rs[Math.floor(rnd * rs.length)], b = h.getBoundingClientRect(); return { x: b.left + b.width * (0.2 + 0.3 * rnd), y: b.top + b.height / 2, id: h.closest('.row').dataset.id }; }, rnd());
    if (!objetivo) { fallos.push({ i, sinObjetivo: true }); continue; }
    if (last && Math.hypot(objetivo.x - last[0], objetivo.y - last[1]) < 16) objetivo.x += 20;   // un movimiento real, no temblor
    last = [objetivo.x, objetivo.y];
    await p.mouse.move(objetivo.x + (rnd() - .5) * 60, objetivo.y + (rnd() - .5) * 120, { steps: 2 });
    await p.mouse.move(objetivo.x, objetivo.y, { steps: 4 });
    await p.waitForTimeout(250);
    const r = await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y), fila = el && el.closest('.row'); const ab = [...document.querySelectorAll('#list .row.open')].map(r => r.dataset.id); return { bajo: fila ? fila.dataset.id : null, abiertas: ab }; }, [objetivo.x, objetivo.y]);
    if (r.abiertas.length === 1 && r.abiertas[0] === r.bajo) aciertos++; else fallos.push({ i, objetivo: objetivo.id, ...r, ev: await p.evaluate(() => window.__ev) });
  }
    return { intentos: n, aciertos, fallos: fallos.slice(0, 5) };
  };
  res.punteria = await apuntar(30, true, false);
  res.punteriaArriba = await apuntar(30, false, true);
  await ctx.close(); return res;
}
module.exports = { una };
if (require.main === module) (async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const out = {};
  for (const [w, h] of [[1440, 900], [1366, 768]]) out[`${w}x${h}`] = await una(b, w, h);
  await b.close(); fs.writeFileSync(salida, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
})();
