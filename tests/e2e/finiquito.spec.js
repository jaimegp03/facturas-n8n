// Calculadora de finiquito de web/index.html (diálogo accesible), sin datos persistentes. Proyecto: npx playwright test --project=finiquito
// Incluye la comparación de la copia JS «COMÚN Finiquito» de la web con POST /finiquito de n8n con los mismos casos (tests/casos_finiquito.json).
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
const CASOS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'casos_finiquito.json'), 'utf8'));

let errores, finiquitoPeticiones;
async function abrirWeb(page, demo) {
  errores = []; finiquitoPeticiones = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (/\/finiquito/.test(r.url()) && r.method() === 'POST') finiquitoPeticiones.push(r.url()); });
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
  await irMD(page, 'herramientas');
}
// el 400 provocado a propósito en el primer test deja un «Failed to load resource» esperado en la consola
test.afterEach(() => { expect(errores.filter(t => !/status of 400/.test(t)), 'errores en consola').toEqual([]); });

async function rellenar(page) {
  await page.locator('#finTipo').selectOption('despido_improcedente');
  await page.locator('#finIni').fill('2018-06-01');
  await page.locator('#finFin').fill('2025-09-30');
  await page.locator('#finSal').fill('36000');
  await page.locator('#finPagas').selectOption('14');
  await page.locator('#finVacDis').fill('12');
  await page.locator('#finIrpf').fill('15');
}

test('abre, calcula contra n8n, Esc cierra y devuelve el foco', async ({ page }) => {
  await abrirWeb(page, false);
  const boton = page.locator('#btnFiniquito');
  await boton.focus();
  await boton.press('Enter');
  const dlg = page.locator('#dlgFiniquito');
  await expect(dlg).toBeVisible();
  await expect(page.locator('#finLegal')).toContainText('Estimación orientativa');
  await rellenar(page);
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finRes table.fin-tbl')).toBeVisible();
  await expect(page.locator('#finRes tr.total')).toContainText('€');
  await expect(page.locator('#finRes')).toContainText('Indemnización');
  expect(finiquitoPeticiones.length).toBe(1);
  await expect(page.locator('#finCopiar')).toBeEnabled();
  // error de validación del servidor (400) visible en el mensaje
  await page.locator('#finFin').fill('2017-01-01');
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finMsg')).toContainText('anterior');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(boton).toBeFocused();
});

test('axe 0 con el diálogo abierto y resultado visible', async ({ page }) => {
  await abrirWeb(page, false);
  await page.locator('#btnFiniquito').click();
  await rellenar(page);
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finRes table.fin-tbl')).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '))).toEqual([]);
});

test('390 px: sin scroll horizontal en la página ni en el diálogo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirWeb(page, false);
  const sinScroll = async () => page.evaluate(() => {
    const d = document.querySelector('#dlgFiniquito');
    return { doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, dlg: !d.open || d.scrollWidth <= d.clientWidth + 1 };
  });
  expect(await sinScroll()).toEqual({ doc: true, dlg: true });
  await page.locator('#btnFiniquito').click();
  await rellenar(page);
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finRes table.fin-tbl')).toBeVisible();
  expect(await sinScroll()).toEqual({ doc: true, dlg: true });
  fs.mkdirSync(path.join(RAIZ, 'tests', 'salida', 'capturas'), { recursive: true });
  await page.screenshot({ path: path.join(RAIZ, 'tests', 'salida', 'capturas', 'finiquito-390.png') });
});

test('modo demo: calcula con la copia JS y no llama a n8n', async ({ page }) => {
  await abrirWeb(page, true);
  await page.locator('#btnFiniquito').click();
  await rellenar(page);
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finRes table.fin-tbl')).toBeVisible();
  expect(finiquitoPeticiones).toEqual([]);
});

test('COMÚN Finiquito: la copia JS de la web = n8n en todos los casos', async ({ page, request }) => {
  await abrirWeb(page, false);
  for (const c of CASOS) {
    const js = await page.evaluate(([e]) => calcularFiniquito(e, '2026-10-15'), [c.e]);
    const r = await request.post(BASE + '/finiquito', { headers: { 'X-API-Key': env.FACT_API_KEY }, data: c.e });
    expect(r.status(), c.n).toBe(200);
    expect(js.status, c.n).toBe(200);
    expect(js.body, c.n).toEqual(await r.json());
  }
  // un 400 también coincide
  const mal = { fecha_inicio: '2025-02-30', fecha_fin: '2025-06-01', tipo_extincion: 'dimision', salario_bruto_anual: 1000 };
  const js = await page.evaluate(([e]) => calcularFiniquito(e, '2026-10-15'), [mal]);
  const r = await request.post(BASE + '/finiquito', { headers: { 'X-API-Key': env.FACT_API_KEY }, data: mal });
  expect(r.status()).toBe(400);
  expect(js.body).toEqual(await r.json());
});
