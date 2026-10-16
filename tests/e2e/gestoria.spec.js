// Modo gestoría en la web real: cliente, búsqueda, badges, validación de importes, lote, deshacer, orden,
// trimestre fiscal, descargas contables, banco y alta de clientes. Sin Gemini.
// Datos: tests/fixture_gestoria.py crear / borrar (todo marcado TEST). Uso: npx playwright test --project=gestoria
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const PY = path.join(RAIZ, '.venv', 'Scripts', 'python.exe');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const H = { 'X-API-Key': env.FACT_API_KEY };
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const OUT = path.join(RAIZ, 'tests', 'salida', 'capturas', 'gestoria');
fs.mkdirSync(OUT, { recursive: true });
const ESPERADO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'facturas-contables', 'esperado_contable.json'), 'utf8'));
const caso = id => ESPERADO.find(e => e.id === id);
const fmt = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });

let clientes = {};
const getJSON = async ruta => (await fetch(API + ruta, { headers: H })).json();
const facturasDe = async cid => (await getJSON(`/facturas?cliente_id=${cid}&desde=2000-01-01&hasta=2100-12-31&por_pagina=200`)).items;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  const salida = execFileSync(PY, [path.join(RAIZ, 'tests', 'fixture_gestoria.py'), 'crear'], { cwd: RAIZ, encoding: 'utf8' });
  const res = JSON.parse(salida.slice(salida.search(/^\{/m)));
  clientes = res.clientes;                      // {reformas: id, panaderia: id}
});
test.afterAll(() => {
  execFileSync(PY, [path.join(RAIZ, 'tests', 'fixture_gestoria.py'), 'borrar'], { cwd: RAIZ, encoding: 'utf8' });
});

async function abrir(page, cliente) {
  await page.addInitScript(([base, token, cli]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-12-31'));
    localStorage.setItem('facturas.cliente', JSON.stringify(cli));
    localStorage.setItem('facturas.porPagina', JSON.stringify(50));
    localStorage.setItem('facturas.orden', JSON.stringify('-fecha'));
  }, [API, env.FACT_API_KEY, String(cliente || '')]);
  await page.goto(URL_WEB);
  await expect(page.locator('#connTxt')).toHaveText('Conectado', { timeout: 20000 });
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20000 });
}

test('cliente: el selector separa las facturas de cada cliente', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await expect(page.locator('#selCliente')).toHaveValue(String(clientes.reformas));
  const n = await page.locator('#list .row').count();
  const api = (await facturasDe(clientes.reformas)).length;
  expect(n).toBe(Math.min(api, 50));
  await expect(page.locator('#list')).not.toContainText('Panadería');
  await expect(page.locator('#list')).not.toContainText('Netflix');      // las reales son de «Personal»
  await page.locator('#selCliente').selectOption(String(clientes.panaderia));
  await expect(page.locator('#list')).toContainText(/Harinas/i);
  await page.screenshot({ path: path.join(OUT, 'cliente.png') });
});

test('búsqueda por NIF, número e importe', async ({ page }) => {
  await abrir(page, clientes.reformas);
  const c = caso('18');
  for (const [txt, esperado] of [[c.proveedor_nif, /Materiales/i], [c.numero, /Materiales/i], [fmt(c.total_factura), /Materiales/i]]) {
    await page.locator('#fBuscar').fill(txt);
    await page.waitForTimeout(1200);
    await expect(page.locator('#list .row').first(), `buscar «${txt}»`).toContainText(esperado);
  }
});

test('badges: NIF inválido, no deducible, moneda extranjera y retención', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#fBuscar').fill(caso('12').numero); await page.waitForTimeout(1200);
  await expect(page.locator('#list .row').first()).toContainText('NIF inválido');
  await page.locator('#fBuscar').fill(caso('06').numero); await page.waitForTimeout(1200);
  await expect(page.locator('#list .row').first()).toContainText('No deducible');
  await page.locator('#fBuscar').fill(caso('11').numero); await page.waitForTimeout(1200);
  await expect(page.locator('#list .row').first()).toContainText('USD');
  await expect(page.locator('#list .row').first().locator('.row-head .eq')).toContainText('€');
  await page.locator('#fBuscar').fill(caso('02').numero); await page.waitForTimeout(1200);
  await expect(page.locator('#list .row').first()).toContainText('Ret. 15 %');
  await page.screenshot({ path: path.join(OUT, 'badges.png') });
});

test('B1: un importe no numérico no se guarda', async ({ page }) => {
  await abrir(page, clientes.reformas);
  const fila = page.locator('#list .row').first();
  const id = await fila.getAttribute('data-id');
  const antes = (await facturasDe(clientes.reformas)).find(f => String(f.id) === id);
  await fila.locator('.row-head').click();
  await fila.getByRole('button', { name: /Corregir/ }).click();
  await fila.locator('input[name="total"]').fill('abc');
  await fila.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(fila.locator('.form-msg')).toContainText('no es un número válido');
  await expect(fila.locator('form[data-edit]')).toHaveCount(1);
  const despues = (await facturasDe(clientes.reformas)).find(f => String(f.id) === id);
  expect(despues.total).toBe(antes.total);
  await page.screenshot({ path: path.join(OUT, 'b1_validacion.png') });
});

test('lote: marcar pagadas y deshacer con Ctrl+Z', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#fPago').selectOption('pendiente'); await page.waitForTimeout(1200);
  const filas = page.locator('#list .row');
  const ids = [await filas.nth(0).getAttribute('data-id'), await filas.nth(1).getAttribute('data-id')];
  await filas.nth(0).locator('input.sel-fila').check();
  await filas.nth(1).locator('input.sel-fila').check();
  await expect(page.locator('#lote')).toBeVisible();
  await expect(page.locator('#loteN')).toHaveText('2 seleccionadas');
  await page.screenshot({ path: path.join(OUT, 'lote.png') });
  await page.locator('#lotePagadas').click();
  await expect(page.locator('#toast')).toContainText('Marcadas como pagadas', { timeout: 15000 });
  let fs_ = await facturasDe(clientes.reformas);
  expect(ids.every(id => fs_.find(f => String(f.id) === id).estado_pago === 'pagada')).toBe(true);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#toast')).toContainText('Deshecho', { timeout: 15000 });
  fs_ = await facturasDe(clientes.reformas);
  expect(ids.every(id => fs_.find(f => String(f.id) === id).estado_pago === 'pendiente')).toBe(true);
});

test('orden por total y atajos de teclado', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#listHead [data-orden="total"]').click(); await page.waitForTimeout(1200);
  const totales = await page.locator('#list .row').evaluateAll(rs => rs.map(r => r.dataset.id));
  const api = await facturasDe(clientes.reformas);
  const max = api.filter(f => f.estado !== 'borrada').reduce((a, b) => ((b.total_eur ?? b.total) > (a.total_eur ?? a.total) ? b : a));
  expect(totales[0]).toBe(String(max.id));
  await expect(page.locator('#listHead [role="columnheader"]:has([data-orden="total"])')).toHaveAttribute('aria-sort', 'descending');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.locator('#fBuscar')).toBeFocused();
  await page.locator('#list .row .row-head').first().focus();
  await page.keyboard.press('j');
  await expect(page.locator('#list .row').nth(1).locator('.row-head')).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.locator('#list .row').nth(1).locator('input.sel-fila')).toBeChecked();
  await page.keyboard.press('e');
  await expect(page.locator('#list .row').nth(1).locator('form[data-edit]')).toHaveCount(1);
});

test('trimestre fiscal y descargas contables', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#fAnio').fill('2026'); await page.locator('#fTrim').selectOption('3');
  await page.locator('#btnFiscal').click();
  await expect(page.locator('#fiscalOut table').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#fiscalOut')).toContainText('IVA 21 %');
  await expect(page.locator('#fiscalOut')).toContainText('Modelo 111');
  await expect(page.locator('#fiscalOut')).toContainText('Modelo 115');
  await expect(page.locator('#fiscalOut')).toContainText(/Cloudhost/i);           // 349
  await expect(page.locator('#fiscalOut')).toContainText(/Materiales de Construcción/i); // 347
  await page.locator('#trimestre').screenshot({ path: path.join(OUT, 'trimestre.png') });
  for (const [boton, cabecera] of [['libro', /recepci/i], ['csv', /debe/i], ['a3', /debe|cuenta/i], ['holded', /proveedor|nif/i]]) {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator(`[data-descarga="${boton}"]`).click()]);
    const ruta = path.join(OUT, `${boton}-${d.suggestedFilename()}`);
    await d.saveAs(ruta);
    const txt = fs.readFileSync(ruta, 'utf8');
    expect(txt.split(/\r?\n/)[0], `cabecera ${boton}`).toMatch(cabecera);
    expect(txt.split(/\r?\n/).filter(Boolean).length, `filas ${boton}`).toBeGreaterThan(3);
    const b = fs.readFileSync(ruta); expect([...b.subarray(0, 3)], `BOM ${boton}`).toEqual([0xEF, 0xBB, 0xBF]); expect([...b.subarray(3, 6)]).not.toEqual([0xEF, 0xBB, 0xBF]);
  }
  // .xlsx convertido en el navegador a partir del CSV del servidor (ExcelJS por CDN)
  for (const [boton, tipo] of [['libro-xlsx', 'libro'], ['csv-xlsx', 'asientos']]) {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator(`[data-descarga="${boton}"]`).click()]);
    expect(d.suggestedFilename()).toMatch(/\.xlsx$/);
    const ruta = path.join(OUT, `real-${tipo}.xlsx`); await d.saveAs(ruta);
    const r = require('child_process').spawnSync(path.join(RAIZ, '.venv', 'Scripts', 'python.exe'), ['-I', path.join(RAIZ, 'tests', 'validar_xlsx_web.py'), tipo, ruta], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }
});

test('banco: importar Norma 43 y conciliar', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#bancoArchivo').setInputFiles(path.join(RAIZ, 'tests', 'facturas-contables', 'extracto_TEST.n43'));
  await expect(page.locator('#msgBanco')).toContainText('importado', { timeout: 20000 });
  const boton = page.locator('#bancoOut [data-conciliar]').first();
  await expect(boton).toBeVisible({ timeout: 15000 });
  await page.locator('#banco').screenshot({ path: path.join(OUT, 'banco.png') });
  const fid = await boton.getAttribute('data-conciliar');
  await boton.click();
  await expect(page.locator('#toast')).toContainText('Conciliado', { timeout: 15000 });
  const f = (await facturasDe(clientes.reformas)).find(x => String(x.id) === fid);
  expect(f.estado_pago).toBe('pagada');
});

test('alta de cliente: NIF inválido rechazado, válido creado', async ({ page }) => {
  await abrir(page, clientes.reformas);
  await page.locator('#btnNuevoCliente').click();
  await page.locator('#cliNombre').fill('TEST·Cliente prueba web');
  await page.locator('#cliNif').fill('B12345670');                              // dígito de control malo
  await page.locator('#cliForm button[type="submit"]').click();
  await expect(page.locator('#cliMsg')).toContainText('no es válido');
  await page.locator('#cliNif').fill('B12345674');                              // CIF con control correcto
  await page.locator('#cliForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Cliente creado', { timeout: 15000 });
  await expect(page.locator('#selCliente option:checked')).toContainText('TEST·Cliente prueba web');
});
