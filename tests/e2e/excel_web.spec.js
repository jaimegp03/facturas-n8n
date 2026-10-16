// Exportaciones .xlsx generadas en el navegador (Modo demo, ExcelJS por CDN bajo demanda).
// Guarda los libros en tests/salida/excel_web/ y los valida con tests/validar_xlsx_web.py (openpyxl).
// Proyecto: npx playwright test --project=excel_web   (sin n8n ni Gemini)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const SALIDA = path.join(RAIZ, 'tests', 'salida', 'excel_web');
fs.mkdirSync(SALIDA, { recursive: true });
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const PY = path.join(RAIZ, '.venv', 'Scripts', 'python.exe');
const validar = (...args) => {
  const r = spawnSync(PY, ['-I', path.join(RAIZ, 'tests', 'validar_xlsx_web.py'), ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  expect(r.status, r.stdout + r.stderr).toBe(0);
  return r.stdout;
};

let errores, scriptsExcelJS;
test.beforeEach(async ({ page }) => {
  errores = []; scriptsExcelJS = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (/exceljs/i.test(r.url())) scriptsExcelJS.push(r.url()); });
  await page.addInitScript(() => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (!sessionStorage.getItem('init-demo')) {
      sessionStorage.setItem('init-demo', '1');
      localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
      localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14'));
      localStorage.setItem('facturas.demo', 'true');
    }
  });
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
});
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });

test('ExcelJS no se carga al abrir la página, solo al exportar', async ({ page }) => {
  expect(scriptsExcelJS).toEqual([]);
  expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');
});

test('demo: botón Excel genera un .xlsx con varias hojas y estilo', async ({ page }) => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('#btnExport').click()]);
  expect(d.suggestedFilename()).toMatch(/^Gastos_\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(page.locator('#msgExport')).toContainText('Excel de ejemplo con datos ficticios');
  expect(scriptsExcelJS.length).toBe(1);
  const f = path.join(SALIDA, 'Gastos_demo.xlsx'); await d.saveAs(f);
  console.log(validar('gastos', f));
});

test('libro registro y asientos .xlsx (demo) y CSV con BOM', async ({ page }) => {
  await page.locator('#selCliente').selectOption('2');
  await expect(page.locator('#fiscalOut table').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#ayudaDescargas')).toContainText('para ver los datos en Excel usa .xlsx');
  for (const [boton, patron, dest, tipo] of [['libro-xlsx', /^Libro_recibidas_.*\.xlsx$/, 'libro.xlsx', 'libro'], ['csv-xlsx', /^Asientos_.*\.xlsx$/, 'asientos.xlsx', 'asientos']]) {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator(`[data-descarga="${boton}"]`).click()]);
    expect(d.suggestedFilename()).toMatch(patron);
    const f = path.join(SALIDA, dest); await d.saveAs(f);
    console.log(validar(tipo, f));
  }
  for (const boton of ['libro', 'csv', 'a3', 'holded']) {
    const [d] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-descarga="${boton}"]`).click()]);
    const f = path.join(SALIDA, 'demo-' + d.suggestedFilename()); await d.saveAs(f);
    const b = fs.readFileSync(f);
    expect([...b.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);                        // un solo BOM
    expect([...b.subarray(3, 6)]).not.toEqual([0xEF, 0xBB, 0xBF]);
    expect(b.toString('utf8')).toContain('\r\n');
  }
});

test('sin conexión al CDN: mensaje claro y sin descarga', async ({ page }) => {
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.locator('#btnExport').click();
  await expect(page.locator('#msgExport')).toContainText('No se pudo cargar el generador de Excel', { timeout: 20_000 });
  errores = errores.filter(e => !/ERR_FAILED|Failed to load resource|integrity/i.test(e));
});

test('móvil 390: sin scroll horizontal con la ayuda de descargas', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem('facturas.demo', 'true'); });
  await p.goto(URL_WEB);
  await expect(p.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
