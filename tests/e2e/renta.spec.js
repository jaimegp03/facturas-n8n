// Tarjeta «Renta» del capítulo 05 Mi dinero de web/index.html (fase 4b). Proyecto: npx playwright test --project=renta
// En vivo contra n8n (cliente particular: crea una meta TEST· y la borra), 390 px, modo demo (sin ninguna petición a n8n) y paridad de la copia JS
// «COMÚN Mi dinero» con GET /metas y GET /resumen-mensual usando el caso que deja tests/probar_metas.py (tests/salida/caso_renta.json).
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { irMD, verTodoMD } = require('./vistas_util');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const CASO = path.join(RAIZ, 'tests', 'salida', 'caso_renta.json');

async function n8n(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, { method: metodo, headers: { 'X-API-Key': env.FACT_API_KEY, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const masMeses = (iso, k) => { const t = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}-${iso.slice(8)}`; };

let errores, peticionesN8n;
async function abrirWeb(page, demo) {
  errores = []; peticionesN8n = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (r.url().startsWith(BASE)) peticionesN8n.push(r.method() + ' ' + r.url()); });
  await page.addInitScript(([base, token, demo]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14'));
    if (demo) localStorage.setItem('facturas.demo', 'true'); else localStorage.removeItem('facturas.demo');
  }, [BASE, env.FACT_API_KEY, !!demo]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#mdKpis .md-kpi')).toHaveCount(4, { timeout: 20_000 });
  await expect(page.locator('#rnKpis .md-kpi')).toHaveCount(4, { timeout: 20_000 });
}
test.afterEach(() => { expect(errores.filter(t => !/status of (400|422)/.test(t)), 'errores en consola').toEqual([]); });
const sinScrollH = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const axe = async page => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '));

async function recorrido(page) {
  await verTodoMD(page);
  await page.locator('#rnP').scrollIntoViewIfNeeded();
  await expect(page.locator('#rnAviso')).toContainText('orientativo');
  await expect(page.locator('#rnCats')).toBeVisible();
  const anios = await page.locator('#rnAnio option').count();
  expect(anios).toBeGreaterThanOrEqual(5);
  // cambiar de año: un año sin datos no rompe nada y vuelve a pintar
  await page.locator('#rnAnio').selectOption(String(Number(await page.locator('#rnAnio').inputValue()) - 4));
  await expect(page.locator('#rnKpis .md-kpi').first()).toContainText('Ingresos');
  await page.locator('#rnAnio').selectOption(String(new Date().getFullYear()));
  await expect(page.locator('#rnCats tbody tr').first()).toBeVisible();
  // copiar
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.locator('#rnCopiar').click();
  await expect(page.locator('#rnMsg')).toContainText('copiado');
  const copiado = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copiado !== null) { expect(copiado).toContain('Resumen orientativo de la renta'); expect(copiado).toContain('Aviso:'); }
  // descargar CSV con BOM UTF-8
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#rnCsv').click()]);
  expect(dl.suggestedFilename()).toMatch(/^Renta_\d{4}_gastos\.csv$/);
  const buf = fs.readFileSync(await dl.path());
  expect([buf[0], buf[1], buf[2]]).toEqual([0xEF, 0xBB, 0xBF]);
  expect(buf.toString('utf8')).toContain('Categoría;Fecha;Proveedor');
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
}

test('en vivo: tarjeta Renta, cambio de año, copiar y descargar CSV', async ({ page }) => {
  await abrirWeb(page, false);
  await recorrido(page);
  expect(peticionesN8n.some(p => /\/renta\?/.test(p))).toBe(true);
});

test('390 px: la tarjeta Renta no desborda', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirWeb(page, true);
  await verTodoMD(page);
  await page.locator('#rnP').scrollIntoViewIfNeeded();
  await expect(page.locator('#rnCats')).toBeVisible();
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
});

test('demo: Renta con datos ficticios y ninguna petición a n8n', async ({ page }) => {
  await abrirWeb(page, true);
  await recorrido(page);
  expect(peticionesN8n, 'peticiones a n8n en modo demo').toEqual([]);
});

test('paridad: la copia JS de la web calcula igual que n8n (renta)', async ({ page }) => {
  test.skip(!fs.existsSync(CASO), 'ejecuta antes tests/probar_renta.py (deja tests/salida/caso_renta.json)');
  const c = JSON.parse(fs.readFileSync(CASO, 'utf8'));
  await abrirWeb(page, false);
  const local = await page.evaluate(e => JSON.parse(JSON.stringify(window.__miDinero.calcularRenta(e))), c);
  expect(local).toEqual(c.esperado);
});
