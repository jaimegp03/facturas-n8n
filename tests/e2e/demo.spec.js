// Modo demo de web/index.html: recorrido punta a punta SIN n8n (datos ficticios en memoria) y vuelta a los datos reales.
// Proyecto: npx playwright test --project=demo   (el último test apaga la demo y lee los datos reales de n8n; no modifica nada)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';

let errores, peticionesN8n;
test.beforeEach(async ({ page }) => {
  errores = []; peticionesN8n = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (r.url().startsWith(BASE) || /:5678/.test(r.url())) peticionesN8n.push(r.method() + ' ' + r.url()); });
  // Conexión real guardada (para comprobar que la demo no la toca) y demo activada solo en la primera carga de la pestaña.
  await page.addInitScript(([base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (!sessionStorage.getItem('init-demo')) {
      sessionStorage.setItem('init-demo', '1');
      localStorage.setItem('facturas.base', JSON.stringify(base));
      localStorage.setItem('facturas.token', JSON.stringify(token));
      localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
      localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14'));
      localStorage.setItem('facturas.demo', 'true');
    }
  }, [BASE, env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
});
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });

const filas = page => page.locator('#list .row');
// recuento estable: la lista termina de recargarse cuando las filas coinciden con el total mostrado
const contarEstable = async page => { let n = -1; await expect.poll(async () => { const t = parseInt(await page.locator('#totalLista').innerText()); const c = await filas(page).count(); n = c; return c > 0 && Math.min(t, +(await page.locator('#fPorPagina').inputValue())) === c; }).toBe(true); return n; };

test('demo: banda, datos, gráficos y sin ninguna petición a n8n', async ({ page }) => {
  await expect(page.locator('#demoStrip')).toBeVisible();
  await expect(page.locator('#demoStrip')).toContainText('DEMO · datos ficticios');
  await expect(page.locator('#btnDemo')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#connTxt')).toHaveText('Demo');
  await expect(page.locator('#selCliente option')).toHaveCount(5);              // Todos + 4 clientes
  await page.locator('#selCliente').selectOption('');
  await expect.poll(() => filas(page).count()).toBeGreaterThanOrEqual(25);
  await expect(page.locator('#kpis .kpi')).toHaveCount(4);
  expect(await page.locator('#chartMes svg g.m').count()).toBeGreaterThanOrEqual(12);
  expect(await page.locator('#chartCat li').count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#donutCat svg.donut')).toHaveCount(1);
  expect(await page.locator('#recs .rec').count()).toBeGreaterThanOrEqual(3);
  // avisos de todo tipo presentes en el DOM
  await page.locator('#fPorPagina').selectOption('200'); await contarEstable(page);
  const texto = await page.locator('#list').innerText();
  for (const t of ['Revisar', 'Vencida', 'No deducible', 'NIF inválido', 'Ret. 19 %', 'Ret. 15 %', 'USD', 'Rectificativa', 'Ticket', 'Pendiente', 'Pagada']) expect(texto, t).toContain(t);
  await expect(page.locator('#bvGasto')).not.toHaveText('—');
  // la demo no escribe ajustes reales ni habla con n8n
  expect(peticionesN8n, 'peticiones a n8n').toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('facturas.cliente'))).toBeNull();
});

test('demo: cambiar de cliente, trimestre fiscal y descargas', async ({ page }, info) => {
  await page.locator('#selCliente').selectOption('3');                           // Marta Ibáñez (autónoma)
  await expect(page.locator('#list')).toContainText('Pixelforge');
  await expect(page.locator('#list')).not.toContainText('Mar y Tierra');
  await expect(page.locator('#clienteInfo')).toContainText('Régimen general');
  await expect(page.locator('#bvCliente')).toContainText('Marta Ibáñez');
  await page.locator('#selCliente').selectOption('2');                           // Taberna (restaurante)
  await expect(page.locator('#list')).toContainText('Mar y Tierra');
  // trimestre: se calcula solo al elegir cliente; recalcular otro trimestre
  await expect(page.locator('#fiscalOut table').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#fiscalOut')).toContainText('IVA 10 %');
  await expect(page.locator('#fiscalOut')).toContainText('Modelo 111');
  await expect(page.locator('#fiscalOut')).toContainText('Modelo 115');
  await expect(page.locator('#fiscalOut')).toContainText('Modelo 347');
  await expect(page.locator('#fiscalOut')).toContainText('Distribuciones Mar y Tierra');   // supera 3.005,06 € en el año
  await page.locator('#selCliente').selectOption('3');
  await expect(page.locator('#fiscalOut')).toContainText('Cloudhost', { timeout: 10_000 });   // 349 del autónomo
  await page.locator('#fTrim').selectOption('2');
  await page.locator('#btnFiscal').click();
  await expect(page.locator('#msgFiscal')).toContainText('Las casillas son orientativas');
  // descargas de ejemplo generadas en el navegador
  for (const [boton, patron] of [['libro', /^Libro_recibidas_.*\.csv$/], ['csv', /^Asientos_.*\.csv$/], ['a3', /A-VALIDAR.*\.csv$/], ['holded', /^Compras_Holded_.*\.csv$/]]) {
    const [d] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-descarga="${boton}"]`).click()]);
    expect(d.suggestedFilename()).toMatch(patron);
    const f = path.join(RAIZ, 'tests', 'salida', 'demo-' + d.suggestedFilename()); await d.saveAs(f);
    const txt = fs.readFileSync(f, 'utf8'); expect(txt.startsWith('﻿')).toBe(true); expect(txt).toContain(';');
  }
  // Excel de ejemplo = .xlsx real con datos ficticios (ExcelJS por CDN, bajo demanda)
  const [x] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExport').click()]);
  expect(x.suggestedFilename()).toMatch(/^Gastos_\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(page.locator('#msgExport')).toContainText('Excel de ejemplo con datos ficticios');
  expect(peticionesN8n).toEqual([]);
});

test('demo: banco, conciliar e ignorar', async ({ page }) => {
  await expect(page.locator('#bancoOut [data-conciliar]').first()).toBeVisible({ timeout: 10_000 });
  const antes = await page.locator('#bancoOut [data-mov]').count();
  const sinPagar = await filas(page).filter({ hasText: 'Pendiente' }).count();
  await page.locator('#bancoOut [data-conciliar]').first().click();
  await expect(page.locator('#toast')).toContainText('Conciliado');
  await expect(page.locator('#bancoOut [data-mov]')).toHaveCount(antes - 1);
  await expect.poll(() => filas(page).filter({ hasText: 'Pendiente' }).count()).toBeLessThan(sinPagar);
  await page.locator('#bancoOut [data-ignorar]').first().click();
  await expect(page.locator('#toast')).toContainText('ignorado');
  // importar un extracto simulado añade movimientos
  await page.locator('#bancoArchivo').setInputFiles(path.join(RAIZ, 'tests', 'facturas-contables', 'extracto_TEST.csv'));
  await expect(page.locator('#msgBanco')).toContainText('importado');
});

test('demo: subida simulada, edición, lote y borrado en memoria', async ({ page }) => {
  await page.locator('#selCliente').selectOption('');
  await page.locator('#fPorPagina').selectOption('200');
  await expect.poll(async () => { const n = parseInt(await page.locator('#totalLista').innerText()); return n > 50 && (await filas(page).count()) === n; }).toBe(true);
  const n0 = await filas(page).count();
  // subida: progreso simulado y una factura ficticia nueva
  const tmpTxt = path.join(RAIZ, 'tests', 'salida', 'no-es-factura.txt'); fs.writeFileSync(tmpTxt, 'hola');
  await page.locator('#fileInput').setInputFiles([path.join(RAIZ, 'tests', 'facturas-ejemplo', '01_zara_ropa.pdf'), tmpTxt]);
  const q = page.locator('#queue .qi');
  await expect(q).toHaveCount(2);
  await expect(q.filter({ hasText: 'no-es-factura.txt' })).toContainText('Tipo no admitido');
  await expect(q.filter({ hasText: '01_zara_ropa.pdf' })).toContainText(/Subiendo|Leyendo/);
  await expect(q.filter({ hasText: '01_zara_ropa.pdf' })).toContainText(/Correcta|Revisar/, { timeout: 15_000 });
  await expect.poll(() => filas(page).count(), { timeout: 15_000 }).toBe(n0 + 1);
  // editar: cambia el proveedor y se queda
  const fila = filas(page).first();
  await fila.locator('.row-head').click();
  await fila.getByRole('button', { name: /Corregir/ }).click();
  await fila.locator('input[name="proveedor"]').fill('Proveedor editado demo');
  await page.keyboard.press('Escape');                                           // Esc cancela
  await expect(fila.locator('form[data-edit]')).toHaveCount(0);
  await fila.locator('.row-head').click();
  await fila.getByRole('button', { name: /Corregir/ }).click();
  await fila.locator('input[name="proveedor"]').fill('Proveedor editado demo');
  await fila.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(filas(page).filter({ hasText: 'Proveedor editado demo' })).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText(/Cambios guardados|recordará|sigue por revisar/);
  // lote: marcar dos como pagadas y deshacer
  await filas(page).nth(2).locator('input.sel-fila').check();
  await filas(page).nth(3).locator('input.sel-fila').check();
  await expect(page.locator('#loteN')).toHaveText('2 seleccionadas');
  await page.locator('#lotePagadas').click();
  await expect(page.locator('#toast')).toContainText('Marcadas como pagadas');
  // borrar una factura
  const antesBorrar = await contarEstable(page);
  const objetivo = filas(page).nth(1);
  await objetivo.locator('.row-head').click();
  await objetivo.getByRole('button', { name: 'Borrar' }).click();
  await objetivo.getByRole('button', { name: 'Sí, borrar' }).click();
  await expect(page.locator('#toast')).toContainText('Factura borrada');
  expect(await contarEstable(page)).toBe(antesBorrar - 1);
  // clientes: alta en memoria
  await page.locator('#btnNuevoCliente').click();
  await page.locator('#cliNombre').fill('Cliente demo nuevo');
  await page.locator('#cliNif').fill('B12345674');
  await page.locator('#cliForm button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Cliente creado');
  await expect(page.locator('#selCliente option:checked')).toContainText('Cliente demo nuevo');
  expect(peticionesN8n).toEqual([]);
});

test('demo: asesor, ajustes bloqueados y apagar vuelve a los datos reales sin residuos', async ({ page }) => {
  await page.locator('#btnAsesor').click();
  await expect(page.locator('#msgAsesor')).toContainText('Listo', { timeout: 10_000 });
  await page.locator('#btnAjustes').click();
  await expect(page.locator('#toast')).toContainText('Modo demo');
  await expect(page.locator('#dlgAjustes')).not.toHaveAttribute('open', '');
  // apagar: recarga con los datos reales
  await page.locator('#btnDemo').click();
  await expect(page.locator('#connTxt')).toHaveText('Conectado', { timeout: 20_000 });
  await expect(filas(page)).toHaveCount(14, { timeout: 20_000 });
  await expect(page.locator('#demoStrip')).toBeHidden();
  await expect(page.locator('#btnDemo')).toHaveAttribute('aria-checked', 'false');
  const estado = await page.evaluate(() => ({ demo: localStorage.getItem('facturas.demo'), base: localStorage.getItem('facturas.base'), cliente: localStorage.getItem('facturas.cliente'), cuerpo: document.body.className, texto: document.body.innerText }));
  expect(estado.demo).toBe('false');
  expect(estado.base).toContain('localhost');
  expect(estado.cliente).toBeNull();
  expect(estado.cuerpo).not.toContain('demo');
  for (const t of ['Taberna La Esquina', 'Pixelforge', 'Mar y Tierra', 'Cliente demo nuevo', 'DEMO · datos ficticios']) expect(estado.texto, t).not.toContain(t);
  expect(peticionesN8n.length).toBeGreaterThan(0);                               // ahora sí habla con n8n
});
