// Capturas de la vista Facturas y de cada sección de Mi dinero (demo, 1440x900 y 390x844): node capturas_v3.js
const { chromium } = require('@playwright/test');
const path = require('path');
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'rediseno', 'auditorias', 'capturas');
const URL = 'file:///' + path.resolve(__dirname, '..', '..', 'web', 'index.html').replace(/\\/g, '/');
const SECS = ['resumen', 'ingresos', 'metas', 'deudas', 'renta', 'herramientas'];
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [nom, w, h, mov] of [['escritorio', 1440, 900, false], ['movil', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mov, hasTouch: mov, deviceScaleFactor: mov ? 2 : 1, locale: 'es-ES' });
    const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.setItem('facturas.base', JSON.stringify('http://localhost:5678/webhook')); localStorage.setItem('facturas.token', JSON.stringify('demo')); localStorage.setItem('facturas.demo', 'true'); });
    await p.goto(URL + '#/facturas');
    await p.locator('#list .row').first().waitFor();
    await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(OUT, `v3-${nom}-facturas.png`) });
    for (const s of SECS) {
      await p.evaluate(x => { location.hash = '#/mi-dinero/' + x; }, s);
      await p.locator('#md-' + s).waitFor();
      await p.waitForTimeout(700);
      await p.screenshot({ path: path.join(OUT, `v3-${nom}-md-${s}.png`), fullPage: false });
    }
    await ctx.close();
  }
  await b.close();
})();
