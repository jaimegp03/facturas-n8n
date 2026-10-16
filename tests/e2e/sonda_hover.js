const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  let malos = 0;
  for (let i = 0; i < 8; i++) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' })).newPage();
    await p.addInitScript(([base, token]) => { if (window.top !== window || location.protocol !== 'file:') return;
      localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
      localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14')); }, [env.N8N_BASE_URL + '/webhook', env.FACT_API_KEY]);
    await p.goto('file:///' + path.join(RAIZ, 'web', 'index.html').replaceAll(String.fromCharCode(92), '/'));
    await p.locator('#list .row').first().waitFor();
    await p.waitForTimeout(1200);
    const zara = p.locator('#list .row').filter({ hasText: 'Zara' }), nf = p.locator('#list .row').filter({ hasText: 'Netflix' }).filter({ hasText: '15,98' });
    await zara.locator('.row-head').hover(); await p.waitForTimeout(700);
    await nf.locator('.row-head').hover();
    const t0 = Date.now(); let abierto = false;
    for (let k = 0; k < 20 && !abierto; k++) { await p.waitForTimeout(100); abierto = (await nf.getAttribute('class')).includes('open'); }
    if (!abierto) {
      malos++;
      const info = await p.evaluate(() => { const o = [...document.querySelectorAll('#list .row')].map(r => (r.classList.contains('open') ? '▶' : ' ') + r.querySelector('.prov b').innerText.slice(0, 14)); return o.join(' | '); });
      console.log(`#${i} NO abre Netflix tras ${Date.now() - t0} ms · estado: ${info}`);
    } else console.log(`#${i} ok en ${Date.now() - t0} ms`);
    await p.context().close();
  }
  console.log('fallos:', malos, '/ 8'); await b.close();
})();
