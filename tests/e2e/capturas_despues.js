const { chromium } = require('C:/ProyectosClaude/facturas/tests/e2e/node_modules/@playwright/test');
const fs = require('fs');
const RAIZ = 'C:/ProyectosClaude/facturas';
const env = Object.fromEntries(fs.readFileSync(RAIZ + '/.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const out = RAIZ + '/docs/rediseno/auditorias/capturas/';
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [n, vp, extra] of [['1440', { width: 1440, height: 900 }, {}], ['390', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const p = await (await b.newContext({ viewport: vp, locale: 'es-ES', ...extra })).newPage();
    await p.addInitScript(([base, token]) => { if (window.top !== window || location.protocol !== 'file:') return;
      localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
      localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-12-31'));
      localStorage.setItem('facturas.cliente', JSON.stringify('2')); }, [env.N8N_BASE_URL + '/webhook', env.FACT_API_KEY]);
    await p.goto('file:///' + RAIZ + '/web/index.html');
    await p.locator('#list .row').first().waitFor(); await p.waitForTimeout(2500);
    await p.screenshot({ path: out + `despues-${n}-01-inicio.png` });
    const filas = await p.evaluate(() => { const l = document.querySelector('#list'); const r = [...l.querySelectorAll('.row')].filter(x => { const b = x.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }); return {visibles: r.length, alto: Math.round(l.querySelector('.row').getBoundingClientRect().height), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth}; });
    console.log(n, JSON.stringify(filas));
    if (n === '1440') {
      await p.locator('#c2').evaluate(e => e.scrollIntoView()); await p.waitForTimeout(500);
      await p.locator('#list .row').nth(3).locator('.row-head').hover(); await p.waitForTimeout(700);
      await p.screenshot({ path: out + 'despues-1440-02-fila-abierta.png' });
      await p.locator('#c3').evaluate(e => e.scrollIntoView()); await p.waitForTimeout(600); await p.screenshot({ path: out + 'despues-1440-03-analiza.png' });
      await p.locator('#c4').evaluate(e => e.scrollIntoView()); await p.waitForTimeout(600); await p.locator('#btnFiscal').click(); await p.waitForTimeout(2500); await p.screenshot({ path: out + 'despues-1440-04-trimestre.png' });
    } else {
      await p.locator('#c2').evaluate(e => e.scrollIntoView()); await p.waitForTimeout(600); await p.screenshot({ path: out + 'despues-390-02-lista.png' });
    }
  }
  await b.close();
})();
