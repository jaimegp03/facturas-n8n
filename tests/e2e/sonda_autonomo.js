// Sonda de uso real «autónomo» (no es un test): node sonda_autonomo.js <etapa>
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').split(path.sep).join('/');
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const OUT = path.join(RAIZ, 'tests', 'salida', 'autonomo');
const api = async (m, r, b) => { const x = await fetch(BASE + r, { method: m, headers: { 'X-API-Key': env.FACT_API_KEY, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return x.json().catch(() => null); };
const log = (...a) => console.log(...a);
async function abrir(browser, { w = 1440, h = 900, demo = false, cli = '', hash = '', hasta = '2026-12-31', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-ES', timezoneId: 'Europe/Madrid', acceptDownloads: true, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage(); page.errs = []; page.fails = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) page.errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => page.errs.push('PAGEERR ' + String(e).slice(0, 160)));
  page.on('requestfailed', r => { if (!/fonts\./.test(r.url())) page.fails.push(r.method() + ' ' + r.url().slice(0, 100)); });
  page.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400) page.fails.push(r.status() + ' ' + r.request().method() + ' ' + r.url().replace(BASE, '')); });
  await page.addInitScript(([base, token, demo, cli, hasta]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify(hasta));
    if (cli) localStorage.setItem('facturas.cliente', JSON.stringify(cli));
    if (demo) localStorage.setItem('facturas.demo', 'true'); else localStorage.removeItem('facturas.demo');
  }, [BASE, env.FACT_API_KEY, demo, String(cli), hasta]);
  await page.goto(URL_WEB + hash); await page.waitForTimeout(2500);
  return page;
}
const num = s => { const m = String(s).replace(/\s|€/g, '').match(/-?[\d.]+,\d{2}/); return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : null; };
module.exports = { chromium, abrir, api, log, OUT, BASE, num, env };
