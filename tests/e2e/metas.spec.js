// «Metas de ahorro» y «Resumen del mes» dentro del capítulo 05 Mi dinero de web/index.html (fase 4a). Proyecto: npx playwright test --project=metas
// En vivo contra n8n (cliente particular: crea una meta TEST· y la borra), 390 px, modo demo (sin ninguna petición a n8n) y paridad de la copia JS
// «COMÚN Mi dinero» con GET /metas y GET /resumen-mensual usando el caso que deja tests/probar_metas.py (tests/salida/caso_metas.json).
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
const CASO = path.join(RAIZ, 'tests', 'salida', 'caso_metas.json');

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
  await expect(page.locator('#rsTexto')).toContainText('Resumen de', { timeout: 20_000 });
}
test.afterEach(() => { expect(errores.filter(t => !/status of (400|422)/.test(t)), 'errores en consola').toEqual([]); });
const sinScrollH = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const axe = async page => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '));

async function recorrido(page, nombre, vivo) {
  await verTodoMD(page);
  await page.locator('#mtAdd').click();
  await expect(page.locator('#dlgMeta')).toBeVisible();
  await page.locator('#mtForm button[type=submit]').click();
  await expect(page.locator('#mtFormMsg')).toContainText(/nombre/i);                       // validación visible (422 del servidor / de la copia JS)
  await page.locator('#mtNombre').fill(nombre);
  await page.locator('#mtObjetivo').fill('1200');
  await page.locator('#mtFecha').fill(masMeses(hoyMadrid(), 10));
  await page.locator('#mtPrev').fill('100');
  await page.locator('#mtForm button[type=submit]').click();
  await expect(page.locator('#dlgMeta')).toBeHidden();
  const card = page.locator('.mt-card', { hasText: nombre });
  await expect(card).toBeVisible();
  expect(['en_camino', 'justa', 'atrasada']).toContain(await card.getAttribute('data-estado'));
  await expect(card.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow', '0');
  // aportar y retirar
  await card.locator('input[type=number]').fill('300');
  await card.getByRole('button', { name: 'Aportar' }).click();
  await expect(card).toContainText('300,00');
  await expect(card.locator('[role=progressbar]')).toHaveAttribute('aria-valuenow', '25');
  await card.locator('input[type=number]').fill('-50');
  await card.getByRole('button', { name: 'Aportar' }).click();
  await expect(card).toContainText('250,00');
  await card.locator('input[type=number]').fill('-9999');
  await card.getByRole('button', { name: 'Aportar' }).click();
  await expect(page.locator('#mtMsg')).toContainText('No puedes retirar más');
  // completar la meta => conseguida
  await card.locator('input[type=number]').fill('950');
  await card.getByRole('button', { name: 'Aportar' }).click();
  await expect(card).toHaveAttribute('data-estado', 'conseguida');
  await expect(card).toContainText('¡Meta conseguida!');
  // resumen del mes y copiar
  await expect(page.locator('#rsTabla tbody tr')).toHaveCount(3);
  const lineas = (await page.locator('#rsTexto').textContent()).trim().split('\n');
  expect(lineas.length).toBeGreaterThanOrEqual(6); expect(lineas.length).toBeLessThanOrEqual(10);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.locator('#rsCopiar').click();
  await expect(page.locator('#rsMsg')).toContainText('copiado');
  const copiado = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (copiado !== null) expect(copiado.split('\r\n').join('\n').trim()).toBe(lineas.join('\n'));
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
  // editar y borrar con confirmación en dos clics
  await card.getByRole('button', { name: /Editar/ }).click();
  await expect(page.locator('#dlgMeta')).toBeVisible();
  await page.locator('#mtNombre').fill(nombre + ' ed');
  await page.locator('#mtForm button[type=submit]').click();
  const card2 = page.locator('.mt-card', { hasText: nombre + ' ed' });
  await expect(card2).toBeVisible();
  await card2.getByRole('button', { name: /Borrar/ }).click();
  await expect(card2.getByRole('button', { name: /Confirmar el borrado/ })).toContainText('¿Seguro?');
  await card2.getByRole('button', { name: /Confirmar el borrado/ }).click();
  await expect(page.locator('.mt-card', { hasText: nombre })).toHaveCount(0);
}

test('en vivo: crear meta, aportar, retirar, ver estado, copiar resumen, editar y borrar', async ({ page }) => {
  test.setTimeout(150_000);
  const clientes = (await n8n('GET', '/clientes')).json.items;
  const cli = clientes.find(c => c.regimen_iva === 'particular') || clientes[0];
  const orig = new Set((await n8n('GET', '/metas?cliente_id=' + cli.id)).json.items.map(m => m.id));
  try {
    await abrirWeb(page, false);
    await recorrido(page, 'TEST·Meta web', true);
    expect(peticionesN8n.length).toBeGreaterThan(0);
  } finally {
    for (const m of (await n8n('GET', '/metas?cliente_id=' + cli.id)).json.items) if (!orig.has(m.id)) await n8n('DELETE', '/metas?id=' + m.id);
  }
});

test('390 px: metas y resumen no desbordan ni en la página ni en el diálogo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirWeb(page, true);
  await verTodoMD(page);
  await expect(page.locator('.mt-card').first()).toBeVisible();
  await sinScrollH(page);
  await page.locator('#mtAdd').click();
  expect(await page.locator('#dlgMeta').evaluate(d => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await sinScrollH(page);
  expect(await axe(page)).toEqual([]);
});

test('demo: 3 metas ficticias, recorrido completo y ninguna petición a n8n', async ({ page }) => {
  await abrirWeb(page, true);
  await verTodoMD(page);
  await expect(page.locator('.mt-card')).toHaveCount(3);
  await expect(page.locator('.mt-card', { hasText: 'Horno nuevo' })).toHaveAttribute('data-estado', 'conseguida');
  await expect(page.locator('#mtResumen')).toContainText('ahorro libre');
  await recorrido(page, 'Mi meta demo', false);
  expect(peticionesN8n, 'peticiones a n8n en modo demo').toEqual([]);
});

test('paridad: la copia JS de la web calcula igual que n8n (metas y resumen mensual)', async ({ page }) => {
  test.skip(!fs.existsSync(CASO), 'ejecuta antes tests/probar_metas.py (deja tests/salida/caso_metas.json)');
  const c = JSON.parse(fs.readFileSync(CASO, 'utf8'));
  await abrirWeb(page, false);
  const local = await page.evaluate(e => JSON.parse(JSON.stringify({ metas: window.__miDinero.calcularMetas(e), resumen: window.__miDinero.calcularResumenMensual(e) })), c);
  expect(local.metas).toEqual(c.esperado_metas);
  expect(local.resumen).toEqual(c.esperado_resumen);
});
