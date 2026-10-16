// Sonda manual del diseño v2: node sonda_v2.js [demo|real] [ancho] [alto]
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '..', '..');
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
(async () => {
  const modo = process.argv[2] || 'demo', w = +(process.argv[3] || 1440), h = +(process.argv[4] || 900);
  const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\./.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(([modo, base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (modo === 'demo') localStorage.setItem('facturas.demo', 'true');
    else { localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token)); localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14')); }
  }, [modo, (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook', env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await page.waitForSelector('#list .row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const vh = innerHeight;
    const rows = [...document.querySelectorAll('#list .row')];
    const completas = rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length;
    const hr = rows[0] && rows[0].querySelector('.row-head').getBoundingClientRect().height;
    return { filas: rows.length, completas, alturaFila: rows[0] && rows[0].getBoundingClientRect().height, hr, scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth, header: document.querySelector('#top').offsetHeight, band: document.querySelector('#bienvenida').getBoundingClientRect().height };
  });
  console.log(JSON.stringify(info), 'errores:', errs);
  const out = path.join(RAIZ, 'tests', 'salida', 'capturas');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `sonda-${modo}-${w}.png`) });
  await b.close();
})();
