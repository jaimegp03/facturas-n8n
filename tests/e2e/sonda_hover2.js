const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' })).newPage();
  await p.addInitScript(([base, token]) => { if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14')); }, [env.N8N_BASE_URL + '/webhook', env.FACT_API_KEY]);
  await p.goto('file:///' + path.join(RAIZ, 'web', 'index.html').split(String.fromCharCode(92)).join('/'));
  await p.locator('#list .row').first().waitFor(); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    window.__ev = []; const t0 = performance.now(); const nom = r => r.querySelector('.prov b').innerText.slice(0, 10) + (r.innerText.includes('15,98') ? '*' : '');
    new MutationObserver(ms => ms.forEach(m => { if (m.attributeName === 'class' && m.target.classList.contains('row')) window.__ev.push(`${(performance.now() - t0) | 0}ms ${m.target.classList.contains('open') ? 'ABRE ' : 'cierra'} ${nom(m.target)} scrollY=${scrollY | 0}`); }))
      .observe(document.querySelector('#list'), { attributes: true, subtree: true, attributeFilter: ['class'] });
    document.addEventListener('mousemove', e => window.__ev.push(`${(performance.now() - t0) | 0}ms ratón (${e.clientX},${e.clientY}) sobre ${(e.target.closest('.row') ? nom(e.target.closest('.row')) : '-')}`), true);
  });
  const zara = p.locator('#list .row').filter({ hasText: 'Zara' }), nf = p.locator('#list .row').filter({ hasText: 'Netflix' }).filter({ hasText: '15,98' });
  await zara.locator('.row-head').hover(); await p.waitForTimeout(800);
  await p.evaluate(() => window.__ev.push('--- ahora el objetivo: Netflix 15,98 ---'));
  await nf.locator('.row-head').hover({ timeout: 5000 }).catch(e => console.log('hover:', e.message.split('\n')[0]));
  await p.waitForTimeout(1500);
  console.log((await p.evaluate(() => window.__ev)).join('\n'));
  await b.close();
})();
