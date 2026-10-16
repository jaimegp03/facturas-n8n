// Medidas, accesibilidad y capturas del diseño v2 «Moderna y vibrante», con la demo apagada (datos reales de n8n) y encendida.
// Solo lectura: no modifica datos. Capturas (demo) en docs/rediseno/auditorias/capturas/v2-*.png. Proyecto: --project=v2
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const CAP = path.join(RAIZ, 'docs', 'rediseno', 'auditorias', 'capturas');
fs.mkdirSync(CAP, { recursive: true });
const MEDIDAS = {};

async function abrir(browser, modo, w, h, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-ES', timezoneId: 'Europe/Madrid', ...extra });
  const page = await ctx.newPage();
  const errores = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(([modo, base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (modo === 'demo') localStorage.setItem('facturas.demo', 'true');
    else { localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token)); localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14')); }
  }, [modo, BASE, env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errores };
}
const completas = page => page.evaluate(() => { const vh = innerHeight; return [...document.querySelectorAll('#list .row')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length; });
async function recorrer(page) {            // desplaza la página para que se muestren las tarjetas con entrada animada
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate(v => scrollTo(0, v), y); await page.waitForTimeout(90); }
  await page.waitForTimeout(900); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
}

for (const modo of ['real', 'demo']) {
  test.describe(`v2 · ${modo}`, () => {
    test(`filas visibles, scroll horizontal y consola (${modo})`, async ({ browser }) => {
      const m = MEDIDAS[modo] = {};
      for (const [w, h, min] of [[1440, 900, 10], [1366, 768, 8]]) {
        const { ctx, page, errores } = await abrir(browser, modo, w, h);
        const n = await completas(page);
        const alt = await page.evaluate(() => ({ fila: document.querySelector('#list .row').getBoundingClientRect().height, cab: document.querySelector('#top').offsetHeight - (document.querySelector('#demoStrip').hidden ? 0 : document.querySelector('#demoStrip').offsetHeight), banda: document.querySelector('#bienvenida').getBoundingClientRect().height }));
        m[`filas_${w}x${h}`] = n; m.alturas = alt;
        expect(n, `filas completas a ${w}x${h}`).toBeGreaterThanOrEqual(min);
        expect(alt.fila).toBeLessThanOrEqual(44); expect(alt.cab).toBeLessThanOrEqual(64); expect(alt.banda).toBeLessThanOrEqual(96);
        expect(errores).toEqual([]); await ctx.close();
      }
      const { ctx, page, errores } = await abrir(browser, modo, 390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const sx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      m.scrollX_390 = sx; expect(sx).toBeLessThanOrEqual(0); expect(errores).toEqual([]); await ctx.close();
    });

    test(`axe WCAG 2.1 A/AA (${modo})`, async ({ browser }) => {
      const { ctx, page } = await abrir(browser, modo, 1440, 900);
      await recorrer(page);
      const res = [];
      const pasar = async nombre => { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze(); res.push(...r.violations.map(v => ({ estado: nombre, id: v.id, nodos: v.nodes.map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]).slice(0, 4) }))); };
      await pasar('inicio');
      await page.locator('#list .row .row-head').nth(1).click(); await page.getByRole('button', { name: /Corregir/ }).first().click(); await page.waitForTimeout(300);
      await pasar('edicion');
      await page.keyboard.press('Escape');
      await page.locator('#btnNuevoCliente').click(); await page.waitForTimeout(300); await pasar('dialogo'); await page.locator('#cliCancel').click();
      MEDIDAS[modo] = { ...(MEDIDAS[modo] || {}), axe: res.length };
      expect(res, JSON.stringify(res, null, 1)).toEqual([]);
      await ctx.close();
    });
  });
}

test('0 colores hexadecimales fuera de :root y tamaño del archivo', async () => {
  const f = path.join(RAIZ, 'web', 'index.html'), s = fs.readFileSync(f, 'utf8');
  const sinRoot = s.replace(/:root\{[^}]*\}/, '');
  const hex = [...sinRoot.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)].map(m => m[0]);
  MEDIDAS.hex_fuera_de_root = hex.length; MEDIDAS.bytes = fs.statSync(f).size;
  expect(hex).toEqual([]);
  expect(fs.statSync(f).size).toBeLessThan(390 * 1024);
});

test('capturas con demo activa (1440x900 y 390x844)', async ({ browser }) => {
  // escritorio
  let { ctx, page } = await abrir(browser, 'demo', 1440, 900);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-01-primera.png') });
  await page.locator('#list .row', { hasText: 'Mar y Tierra' }).first().locator('.row-head').hover({ position: { x: 300, y: 12 } });
  await page.waitForTimeout(700);
  await page.locator('#c2').scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector('#c2').scrollIntoView({ block: 'start' })); await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-02-lista-fila-abierta.png') });
  await recorrer(page);
  await page.evaluate(() => document.querySelector('#c3').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-03-graficos.png') });
  await page.locator('#chartMes g.m').nth(8).hover(); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-03b-grafico-tooltip.png') });
  await page.evaluate(() => document.querySelector('#trimestre').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-04-trimestre.png') });
  await page.evaluate(() => document.querySelector('#banco').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-05-banco.png') });
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-1440-06-consejos-y-excel.png') });
  await ctx.close();
  // móvil
  ({ ctx, page } = await abrir(browser, 'demo', 390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
  await page.screenshot({ path: path.join(CAP, 'v2-demo-390-01-primera.png') });
  await page.evaluate(() => document.querySelector('#c2').scrollIntoView({ block: 'start' })); await page.waitForTimeout(500);
  await page.locator('#list .row .row-head').nth(2).tap(); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-390-02-lista-fila-abierta.png') });
  await recorrer(page);
  await page.evaluate(() => document.querySelector('#c3').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-390-03-graficos.png') });
  await page.evaluate(() => document.querySelector('#trimestre').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-390-04-trimestre.png') });
  await page.evaluate(() => document.querySelector('#banco').scrollIntoView({ block: 'start' })); await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(CAP, 'v2-demo-390-05-banco.png') });
  await ctx.close();
});

test.afterAll(() => { fs.writeFileSync(path.join(RAIZ, 'tests', 'salida', 'v2-medidas.json'), JSON.stringify(MEDIDAS, null, 2)); });
