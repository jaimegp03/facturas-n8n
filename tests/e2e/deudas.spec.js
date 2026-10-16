// Tarjeta «Deudas y préstamos» del capítulo 05 Mi dinero de web/index.html (fase 4b, etapa 2). Proyecto: npx playwright test --project=deudas
// En vivo contra n8n (cliente particular: crea una meta TEST· y la borra), 390 px, modo demo (sin ninguna petición a n8n) y paridad de la copia JS
// «COMÚN Mi dinero» con GET /metas y GET /resumen-mensual usando el caso que deja tests/probar_metas.py (tests/salida/caso_deudas.json).
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
const CASO = path.join(RAIZ, 'tests', 'salida', 'caso_deudas.json');

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
  await expect(page.locator('#deLista')).not.toBeEmpty({ timeout: 20_000 });
}
test.afterEach(() => { expect(errores.filter(t => !/status of (400|422)/.test(t)), 'errores en consola').toEqual([]); });
const sinScrollH = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const axe = async page => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '));

async function recorrido(page, nombre) {
  await verTodoMD(page);
  await page.locator('#dePanel').scrollIntoViewIfNeeded();
  await page.locator('#deAdd').click();
  await expect(page.locator('#dlgDeuda')).toBeVisible();
  await page.locator('#deForm button[type=submit]').click();
  await expect(page.locator('#deFormMsg')).toContainText(/nombre/i);                       // validación visible
  await page.locator('#deNombre').fill(nombre);
  await page.locator('#deTipo').selectOption('prestamo');
  await page.locator('#deCapital').fill('12000');
  await page.locator('#deInteres').fill('6');
  await page.locator('#dePlazo').fill('48');
  await page.locator('#deInicio').fill(masMeses(hoyMadrid(), -6));
  await page.locator('#deForm button[type=submit]').click();
  await expect(page.locator('#dlgDeuda')).toBeHidden();
  const card = page.locator('.de-card', { hasText: nombre });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-estado', 'vigente');
  await expect(card).toContainText('281,82');                                              // cuota francesa de 12.000 € al 6 % a 48 meses
  expect(Number(await card.locator('[role=progressbar]').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  // simular: error de validación y comparativa antes/después
  await card.getByRole('button', { name: /Simular/ }).click();
  await expect(page.locator('#dlgSimular')).toBeVisible();
  await page.locator('#dsForm button[type=submit]').click();
  await expect(page.locator('#dsMsg')).toContainText('mayor que 0');
  await page.locator('#dsImporte').fill('3000');
  await page.locator('#dsTipo').selectOption('reducir_cuota');
  await page.locator('#dsForm button[type=submit]').click();
  await expect(page.locator('#dsTabla tbody tr')).toHaveCount(5);
  await expect(page.locator('#dsAhorro')).toContainText('Ahorrarías');
  await expect(page.locator('#dsAhorro')).toContainText('cuota bajaría');
  expect(await axe(page)).toEqual([]);
  await page.locator('#dsCerrar').click();
  await expect(page.locator('#dlgSimular')).toBeHidden();
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
  // editar y borrar con confirmación en dos clics
  await card.getByRole('button', { name: /Editar/ }).click();
  await page.locator('#deNombre').fill(nombre + ' ed');
  await page.locator('#deForm button[type=submit]').click();
  const card2 = page.locator('.de-card', { hasText: nombre + ' ed' });
  await expect(card2).toBeVisible();
  await card2.getByRole('button', { name: /Borrar/ }).click();
  await expect(card2.getByRole('button', { name: /Confirmar el borrado/ })).toContainText('¿Seguro?');
  await card2.getByRole('button', { name: /Confirmar el borrado/ }).click();
  await expect(page.locator('.de-card', { hasText: nombre })).toHaveCount(0);
}

test('en vivo: crear deuda, simular amortización, editar y borrar', async ({ page }) => {
  test.setTimeout(150_000);
  const clientes = (await n8n('GET', '/clientes')).json.items;
  const cli = clientes.find(c => c.regimen_iva === 'particular') || clientes[0];
  const orig = new Set((await n8n('GET', '/deudas?cliente_id=' + cli.id)).json.items.map(m => m.id));
  try {
    await abrirWeb(page, false);
    await recorrido(page, 'TEST·Deuda web');
    expect(peticionesN8n.some(p => /\/deudas\?/.test(p))).toBe(true);
  } finally {
    for (const m of (await n8n('GET', '/deudas?cliente_id=' + cli.id)).json.items) if (!orig.has(m.id)) await n8n('DELETE', '/deudas?id=' + m.id);
  }
});

test('390 px: deudas y diálogos no desbordan', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirWeb(page, true);
  await verTodoMD(page);
  await page.locator('#dePanel').scrollIntoViewIfNeeded();
  await expect(page.locator('.de-card').first()).toBeVisible();
  await sinScrollH(page);
  await page.locator('#deAdd').click();
  expect(await page.locator('#dlgDeuda').evaluate(d => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await page.locator('.de-card').first().getByRole('button', { name: /Simular/ }).click();
  await page.locator('#dsImporte').fill('1000');
  await page.locator('#dsForm button[type=submit]').click();
  await expect(page.locator('#dsTabla tbody tr')).toHaveCount(5);
  expect(await page.locator('#dlgSimular').evaluate(d => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
});

test('demo: 2 deudas ficticias, recorrido completo y ninguna petición a n8n', async ({ page }) => {
  await abrirWeb(page, true);
  await verTodoMD(page);
  await page.locator('#dePanel').scrollIntoViewIfNeeded();
  await expect(page.locator('.de-card')).toHaveCount(2);
  await expect(page.locator('#deResumen')).toContainText('Capital pendiente');
  await recorrido(page, 'Mi deuda demo');
  expect(peticionesN8n, 'peticiones a n8n en modo demo').toEqual([]);
});

test('paridad: la copia JS de la web calcula igual que n8n (deudas)', async ({ page }) => {
  test.skip(!fs.existsSync(CASO), 'ejecuta antes tests/probar_deudas.py (deja tests/salida/caso_deudas.json)');
  const c = JSON.parse(fs.readFileSync(CASO, 'utf8'));
  await abrirWeb(page, false);
  const local = await page.evaluate(e => JSON.parse(JSON.stringify({
    items: e.deudas.map(d => window.__miDinero.calcularDeuda(d, e.hoy)),
    resumen: window.__miDinero.calcularResumenDeudas({ cliente: e.cliente, hoy: e.hoy, ingresos: e.ingresos, deudas: e.deudas }),
    sim: window.__miDinero.simularDeuda(e.deudas.find(d => d.id === e.ids.A), e.hoy, { amortizacion_extra: 10000, tipo: 'reducir_cuota' }).body })), c);
  expect(local.items).toEqual(c.esperado_lista.items);
  expect(local.resumen).toEqual(c.esperado_resumen);
  expect(local.sim).toEqual(c.sim);
});
