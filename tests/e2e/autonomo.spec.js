// Regresión de la prueba «autónomo» (docs/prueba-autonomo.md): respuestas tardías en Mi dinero, doble envío,
// mensajes sin jerga, descargas vacías y estado vacío del cliente. Proyecto: npx playwright test --project=autonomo
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const { irMD } = require('./vistas_util');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + RAIZ.split(path.sep).join('/') + '/web/index.html';
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
let errores;
async function abrir(page, demo, extra = {}) {
  errores = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|status of (400|404|422)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(([base, token, demo, extra]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify(extra.desde || '2026-01-01')); localStorage.setItem('facturas.hasta', JSON.stringify(extra.hasta || '2026-12-31'));
    if (demo) localStorage.setItem('facturas.demo', 'true'); else localStorage.removeItem('facturas.demo');
  }, [BASE, env.FACT_API_KEY, demo, extra]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row, #list .empty').first()).toBeVisible({ timeout: 20_000 });
}
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Disposition', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE' };

test('A-02 Mi dinero: una respuesta tardía de un mes anterior no pisa la pantalla', async ({ page }) => {
  await abrir(page, false);
  await page.evaluate(() => { location.hash = '#/mi-dinero/resumen'; });
  await expect(page.locator('#mdKpis .md-kpi')).toHaveCount(4, { timeout: 20_000 });
  let primera = true;
  // Cada respuesta dice «1 concepto en <mes>» con el mes que devolvió el servidor; la primera tarda 2,5 s (llega la última).
  await page.route('**/webhook/mi-dinero?*', async route => {
    const lenta = primera; primera = false;
    const r = await route.fetch(); const j = await r.json(); j.ingresos.num = 1;
    if (lenta) await new Promise(x => setTimeout(x, 2500));
    await route.fulfill({ response: r, json: j });
  });
  await page.locator('#mdMesSig').click(); await page.locator('#mdMesSig').click();
  await page.waitForTimeout(5000);
  const mes = await page.locator('#mdMes').inputValue(); const nombre = MESES[+mes.slice(5) - 1] + ' ' + mes.slice(0, 4);
  await expect(page.locator('#mdKpis')).toContainText('en ' + nombre);
});

test('A-03 doble clic en Guardar no crea dos ingresos (demo)', async ({ page }) => {
  await abrir(page, true);
  await irMD(page, 'ingresos');
  await page.locator('#mdAddIngreso').click();
  await page.locator('#ingConcepto').fill('TEST·doble clic'); await page.locator('#ingImporte').fill('99.99'); await page.locator('#ingIni').fill('2026-10-05');
  await page.locator('#ingGuardar').dblclick({ delay: 10 });
  await page.waitForTimeout(800);
  await expect(page.locator('#mdIngresos tbody tr', { hasText: 'TEST·doble clic' })).toHaveCount(1);
});

test('A-05 los errores de formulario no enseñan nombres de campo técnicos (demo)', async ({ page }) => {
  await abrir(page, true);
  await irMD(page, 'herramientas');
  await page.locator('#btnFiniquito').click();
  await page.locator('#finIni').fill('2020-03-15'); await page.locator('#finFin').fill('2019-01-01'); await page.locator('#finSal').fill('30000');
  await page.locator('#finCalcular').click();
  await expect(page.locator('#finMsg')).toContainText('anterior');
  const t = await page.locator('#finMsg').innerText();
  expect(t).not.toMatch(/_|"/); expect(t).toContain('«Fecha de fin»');
  await page.keyboard.press('Escape');
  await irMD(page, 'ingresos');
  await page.locator('#mdAddIngreso').click();
  await page.locator('#ingConcepto').fill('TEST·neg'); await page.locator('#ingImporte').fill('-50'); await page.locator('#ingIni').fill('2026-10-05');
  await page.locator('#ingGuardar').click();
  await expect(page.locator('#ingMsg')).toContainText('mayor que 0');
  const u = await page.locator('#ingMsg').innerText();
  expect(u).not.toMatch(/_|"|Falta/);
});

test('A-04 una descarga de CSV sin filas avisa de que está vacía', async ({ page }) => {
  await abrir(page, false);
  await page.route('**/webhook/libro-registro*', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="Libro_vacio.csv"' }, body: '﻿Nº recepción;Fecha expedición;Número\r\n' }));
  await page.locator('#selCliente').selectOption({ index: 1 });
  await page.locator('#descargas [data-descarga="libro"]').click();
  await expect(page.locator('#msgDescargas')).toContainText('sin datos', { timeout: 15_000 });
});

test('A-06 cliente sin facturas: el estado vacío no habla de filtros', async ({ page }) => {
  await abrir(page, false);
  await page.route('**/webhook/facturas?*', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [], total: 0, pagina: 1, por_pagina: 50, paginas: 0 }) }));
  await page.locator('#fBuscar').fill('x'); await page.locator('#fBuscar').fill('');
  await expect(page.locator('#list .empty')).toContainText('aún no tiene facturas', { timeout: 10_000 });
  await page.locator('#fBuscar').fill('zzzzzz');
  await expect(page.locator('#list .empty')).toContainText('estos filtros', { timeout: 10_000 });
});
