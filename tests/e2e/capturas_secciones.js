// Capturas de secciones concretas de la web (revisión visual). Uso: node tests/e2e/capturas_secciones.js
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const OUT = path.join(RAIZ, 'tests', 'salida', 'capturas');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [nombre, vp, extra] of [['movil', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['escritorio', { width: 1440, height: 900 }, {}]]) {
    const ctx = await b.newContext({ viewport: vp, ...extra, locale: 'es-ES' });
    await ctx.addInitScript(([base, token, cliente]) => {
      if (window.top !== window || location.protocol !== 'file:') return;
      localStorage.setItem('facturas.base', JSON.stringify(base));
      localStorage.setItem('facturas.token', JSON.stringify(token));
      localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
      localStorage.setItem('facturas.hasta', JSON.stringify('2026-12-31'));
      if (cliente) localStorage.setItem('facturas.cliente', JSON.stringify(cliente));
    }, [(env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook', env.FACT_API_KEY, process.argv[2] || '']);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') console.log('consola:', m.text()); });
    p.on('pageerror', e => console.log('error js:', e.message));
    await p.goto('file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/'));
    await p.waitForTimeout(4000); console.log('lista:', (await p.locator('#list').innerText()).slice(0, 200), '| conexion:', await p.locator('#connTxt').innerText());
    await p.locator('#list .row').first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(1500);
    await p.locator('#top').screenshot({ path: path.join(OUT, `sec-${nombre}-cabecera.png`) });
    await p.locator('#c2').scrollIntoViewIfNeeded();
    await p.locator('#list .row').nth(1).locator('input.sel-fila').check();
    await p.locator('#list .row').nth(2).locator('input.sel-fila').check();
    await p.waitForTimeout(300);
    await p.locator('#c2').screenshot({ path: path.join(OUT, `sec-${nombre}-lista.png`) });
    await p.locator('#list .row').nth(1).locator('input.sel-fila').uncheck();
    await p.locator('#list .row').nth(2).locator('input.sel-fila').uncheck();
    // formulario de corrección abierto (sin guardar)
    const fila = p.locator('#list .row').first();
    await fila.locator('.row-head').click();
    await fila.getByRole('button', { name: /Corregir/ }).click();
    await p.waitForTimeout(400);
    await fila.screenshot({ path: path.join(OUT, `sec-${nombre}-formulario.png`) });
    await fila.getByRole('button', { name: 'Cancelar' }).click();
    await p.locator('#trimestre').scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await p.locator('#trimestre').screenshot({ path: path.join(OUT, `sec-${nombre}-trimestre.png`) });
    await p.locator('#banco').screenshot({ path: path.join(OUT, `sec-${nombre}-banco.png`) });
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(nombre, 'scroll horizontal extra:', ancho);
    await ctx.close();
  }
  await b.close();
})();
