// Pruebas de la web contra el n8n real, sin gastar llamadas a Gemini:
// la subida usa una factura ya registrada (debe responder "duplicada") y un .txt (rechazo en el cliente).
// No modifica datos: la edición se abre y se cancela.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const CAPTURAS = path.join(RAIZ, 'tests', 'salida', 'capturas');
fs.mkdirSync(CAPTURAS, { recursive: true });

let erroresConsola;
test.beforeEach(async ({ page }) => {
  erroresConsola = [];
  page.on('console', m => { if (m.type() === 'error') erroresConsola.push(m.text()); });
  page.on('pageerror', e => erroresConsola.push(String(e)));
  await page.addInitScript(([base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return; // no tocar iframes (PDF en blob:)
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14'));
  }, [(env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook', env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row')).toHaveCount(14, { timeout: 20_000 });
});

test.afterEach(async () => {
  // Las fuentes de Google pueden fallar sin red; no son errores de la app.
  const propios = erroresConsola.filter(t => !/fonts\.(googleapis|gstatic)/.test(t));
  expect(propios, 'errores en consola').toEqual([]);
});

test('carga datos, sin scroll horizontal, capturas', async ({ page }, info) => {
  await expect(page.locator('#connTxt')).toHaveText('Conectado');
  await expect(page.locator('#kpis .kpi').first()).toContainText('1.029,58');
  await expect(page.locator('#chartMes svg g.m')).toHaveCount(10);
  await expect(page.locator('#chartCat li')).toHaveCount(10);
  await expect(page.locator('#tablaRec tfoot')).toContainText('177,41');
  await expect(page.locator('#recs .rec')).toHaveCount(5);
  await expect(page.locator('#revisarNote')).toBeVisible();
  await expect(page.locator('.row.revisar')).toHaveCount(1);
  const anchoExtra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(anchoExtra, 'scroll horizontal').toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(CAPTURAS, `${info.project.name}-arriba.png`) });
  await page.screenshot({ path: path.join(CAPTURAS, `${info.project.name}-completa.png`), fullPage: true });
});

test('escena sticky: los capítulos cambian al hacer scroll', async ({ page }, info) => {
  const nav = page.locator('nav.chapters');
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    await page.locator('#' + id).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(250);
    await expect(page.locator(`.chap[data-chap="${id}"]`)).toHaveClass(/active/);
    await expect(page.locator('.chap.active')).toHaveCount(1);
    const pos = await nav.evaluate(el => getComputedStyle(el).position);
    expect(pos).toBe('sticky');
    await expect(nav).toBeInViewport();
  }
  await expect(page.locator('#s3')).toContainText('1.029,58');
  await page.locator('#c3').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(CAPTURAS, `${info.project.name}-analiza.png`) });
});

test('lista: hover/toque expande la fila y cambia la vista previa', async ({ page }, info) => {
  const filas = page.locator('#list .row');
  const zara = filas.filter({ hasText: 'Zara' });
  const netflixFoto = filas.filter({ hasText: 'Netflix' }).filter({ hasText: '15,98' });
  if (info.project.name === 'escritorio') {
    await zara.locator('.row-head').hover();
    await expect(zara).toHaveClass(/open/);
    await expect(page.locator('#preview h3')).toContainText('Zara');
    await expect(page.locator('#preview iframe')).toHaveCount(1, { timeout: 10_000 }); // PDF real
    await netflixFoto.locator('.row-head').hover();
    await expect(netflixFoto).toHaveClass(/open/);
    await expect(zara).not.toHaveClass(/open/);
    await expect(page.locator('#preview h3')).toContainText('Netflix');
    await expect(page.locator('#preview img')).toHaveCount(1, { timeout: 10_000 }); // foto real
    await page.waitForTimeout(400);
    await page.locator('#c2').screenshot({ path: path.join(CAPTURAS, `${info.project.name}-lista-hover.png`) });
    // teclado: flecha abajo mueve el foco y la vista previa
    await netflixFoto.locator('.row-head').focus();
    await page.keyboard.press('ArrowDown');
    const enfocada = page.locator('#list .row:focus-within');
    await expect(enfocada).toHaveClass(/open/);
  } else {
    await expect(page.locator('#preview')).toBeHidden();
    await zara.locator('.row-head').tap();
    await expect(zara).toHaveClass(/open/);
    await zara.getByRole('button', { name: 'Ver documento' }).tap();
    await expect(page.locator('#dlgPreview')).toBeVisible();
    await expect(page.locator('#dlgPreview h3')).toContainText('Zara');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(CAPTURAS, `${info.project.name}-vista-previa.png`) });
    await page.locator('#dlgPreviewClose').tap();
  }
  // edición: se abre el formulario con la categoría actual y se cancela sin guardar
  const rep = filas.filter({ hasText: 'Repsol' });
  await rep.locator('.row-head').click();
  await rep.getByRole('button', { name: 'Corregir' }).click();
  await expect(rep.locator('select[name="categoria"]')).toHaveValue('Transporte y combustible');
  await expect(rep.locator('input[name="total"]')).toHaveValue('61,50');
  await expect(rep.locator('.why.warn')).toHaveCount(0);
  await rep.getByRole('button', { name: 'Cancelar' }).click();
  await expect(rep.locator('form[data-edit]')).toHaveCount(0);
  await expect(rep.locator('.why.warn')).toContainText('no cuadra');
});

test('subida: duplicada y tipo no admitido', async ({ page }) => {
  const tmpTxt = path.join(RAIZ, 'tests', 'salida', 'no-es-factura.txt');
  fs.writeFileSync(tmpTxt, 'hola');
  await page.locator('#fileInput').setInputFiles([
    path.join(RAIZ, 'tests', 'facturas-ejemplo', '01_zara_ropa.pdf'),
    tmpTxt,
  ]);
  const q = page.locator('#queue .qi');
  await expect(q).toHaveCount(2);
  await expect(q.filter({ hasText: 'no-es-factura.txt' })).toContainText('Tipo no admitido');
  await expect(q.filter({ hasText: '01_zara_ropa.pdf' })).toContainText('Duplicada', { timeout: 30_000 });
  await expect(q.filter({ hasText: '01_zara_ropa.pdf' })).toContainText('59,96');
  await expect(page.locator('#list .row')).toHaveCount(14); // no se ha añadido nada
});

test('exportar Excel descarga Gastos_AAAA-MM-DD.xlsx', async ({ page }, info) => {
  await page.locator('#c4').evaluate(el => el.scrollIntoView());
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExport').click()]);
  expect(descarga.suggestedFilename()).toMatch(/^Gastos_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const destino = path.join(RAIZ, 'tests', 'salida', `web-${info.project.name}-${descarga.suggestedFilename()}`);
  await descarga.saveAs(destino);
  const cab = fs.readFileSync(destino).subarray(0, 2).toString('latin1');
  expect(cab).toBe('PK'); // zip válido
  await expect(page.locator('#msgExport')).toContainText('Descargado');
  await page.screenshot({ path: path.join(CAPTURAS, `${info.project.name}-exporta.png`) });
});
