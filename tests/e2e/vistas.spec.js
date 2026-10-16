// Vistas «Facturas | Mi dinero» de web/index.html (hash #/facturas, #/mi-dinero[/seccion]). Demo, sin n8n. Proyecto: npx playwright test --project=vistas
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const SECS = ['resumen', 'ingresos', 'metas', 'deudas', 'renta', 'herramientas'];
let errores, peticiones;

async function abrir(page, hash = '', vistaGuardada) {
  errores = []; peticiones = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (/:5678/.test(r.url())) peticiones.push(r.url()); });
  await page.addInitScript(([vg]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (sessionStorage.getItem('init-v')) return;
    sessionStorage.setItem('init-v', '1');
    localStorage.setItem('facturas.base', JSON.stringify('http://localhost:5678/webhook'));
    localStorage.setItem('facturas.token', JSON.stringify('demo'));
    localStorage.setItem('facturas.demo', 'true');
    if (vg) localStorage.setItem('facturas.vista', JSON.stringify(vg)); else localStorage.removeItem('facturas.vista');
  }, [vistaGuardada || null]);
  await page.goto(URL_WEB + hash);
}
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });
const axe = async page => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '));
const sinScrollH = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const irA = async (page, s) => { await page.evaluate(x => { location.hash = '#/mi-dinero/' + x; }, s); await expect(page.locator('#md-' + s)).toBeVisible(); };

test('por defecto es Facturas (capítulos 01-04, sin el 05) y el selector de vista es accesible', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#sceneMd')).toBeHidden();
  await expect(page.locator('#tabVistaFac')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#tabVistaMd')).not.toHaveAttribute('aria-current', /.*/);
  await expect(page.locator('#sceneFac .chapter')).toHaveCount(4);
  await expect(page.locator('#c5')).toHaveCount(0);
  await expect(page.locator('#sceneFac nav.chapters .chap')).toHaveCount(4);
  await expect(page.locator('#sceneFac')).not.toContainText('Mi dinero');
  expect(await page.evaluate(() => document.querySelector('#top').offsetHeight - document.querySelector('#demoStrip').offsetHeight)).toBeLessThanOrEqual(64);
  await expect(page.locator('#btnAjustes')).toContainText('Ajustes');
  expect(await page.evaluate(() => location.hash)).toBe('');
});

test('cambio de vista por clic y por hash; Atrás y Adelante; la vista se recuerda', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#tabVistaMd').click();
  await expect(page).toHaveURL(/#\/mi-dinero$/);
  await expect(page.locator('#sceneMd')).toBeVisible();
  await expect(page.locator('#sceneFac')).toBeHidden();
  await expect(page.locator('#md-resumen')).toBeVisible();
  await expect(page.locator('#tabVistaMd')).toHaveAttribute('aria-current', 'page');
  await page.locator('#tabVistaFac').click();
  await expect(page.locator('#sceneFac')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sceneMd')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#sceneFac')).toBeVisible();
  await irA(page, 'deudas');
  await page.evaluate(() => { location.hash = '#/facturas'; });
  await expect(page.locator('#sceneFac')).toBeVisible();
  // el logotipo (#c1) vuelve a Facturas desde Mi dinero
  await page.locator('#tabVistaMd').click();
  await page.locator('a.brand').click();
  await expect(page.locator('#sceneFac')).toBeVisible();
  // recordar: la vista se guarda en localStorage
  await page.locator('#tabVistaMd').click();
  await expect(page.locator('#sceneMd')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('facturas.vista'))).toContain('mi-dinero');
});

test('sin hash y con la vista guardada se abre Mi dinero; el hash manda sobre lo guardado', async ({ page }) => {
  await abrir(page, '', 'mi-dinero');
  await expect(page.locator('#sceneMd')).toBeVisible();
  await expect(page).toHaveURL(/#\/mi-dinero\/resumen$/);
  await page.goto(URL_WEB + '#/facturas');
  await page.reload();
  await expect(page.locator('#sceneFac')).toBeVisible();
});

test('cada sección de Mi dinero se muestra sola, por clic y por enlace directo', async ({ page }) => {
  await abrir(page, '#/mi-dinero/renta');
  await expect(page.locator('#md-renta')).toBeVisible();
  for (const s of SECS) {
    await page.locator(`#navMd .mdn[data-sec="${s}"] a`).click();
    await expect(page).toHaveURL(new RegExp('#/mi-dinero/' + s + '$'));
    for (const o of SECS) await expect(page.locator('#md-' + o)).toBeVisible({ visible: o === s });
    await expect(page.locator('#navMd .mdn.active')).toHaveCount(1);
    await expect(page.locator(`#navMd .mdn[data-sec="${s}"] a`)).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.locator('#btnFiniquito')).toBeVisible();
  await expect(page.locator('#btnNomina')).toBeVisible();
  await page.locator('#navMd .mdn[data-sec="resumen"] a').click();
  await expect(page.locator('#mdKpis .md-kpi')).toHaveCount(4);
  await expect(page.locator('#md-herramientas')).toBeHidden();
  await page.locator('#navMd .mdn[data-sec="ingresos"] a').click();
  await expect(page.locator('#mdPres')).toBeVisible();
  await expect(page.locator('#mdKpis')).toBeHidden();
});

test('axe 0 en las dos vistas y con diálogos abiertos', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  expect(await axe(page)).toEqual([]);
  for (const s of SECS) { await irA(page, s); expect(await axe(page), s).toEqual([]); }
  await page.locator('#btnFiniquito').click();
  await expect(page.locator('#dlgFiniquito')).toBeVisible();
  expect(await axe(page), 'finiquito').toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('#btnNomina').click();
  expect(await axe(page), 'nómina').toEqual([]);
  await page.keyboard.press('Escape');
  await irA(page, 'resumen');
  await page.locator('#mdAddIngreso').click();
  expect(await axe(page), 'ingreso').toEqual([]);
});

test('390 px: sin scroll horizontal en ninguna vista y navegación de secciones en fila', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await sinScrollH(page);
  for (const s of SECS) { await irA(page, s); await sinScrollH(page); }
  const ol = await page.locator('#navMd ol').evaluate(o => ({ d: getComputedStyle(o).display, ov: getComputedStyle(o).overflowX, ys: new Set([...o.children].map(c => Math.round(c.getBoundingClientRect().top))).size }));
  expect(ol.d).toBe('flex'); expect(ol.ov).toBe('auto'); expect(ol.ys).toBe(1);
  await page.locator('#tabVistaFac').click();
  await sinScrollH(page);
});

test('demo: ninguna petición a n8n en ninguna vista ni sección', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  for (const s of SECS) await irA(page, s);
  await page.evaluate(() => { location.hash = '#/facturas'; });
  await expect(page.locator('#sceneFac')).toBeVisible();
  expect(peticiones).toEqual([]);
});

test('Facturas a 1366x768 conserva al menos 8 filas completas y el efecto sticky', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await abrir(page);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.querySelector('#c2').scrollIntoView());
  const n = await page.evaluate(() => { const vh = innerHeight; return [...document.querySelectorAll('#list .row')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length; });
  expect(n).toBeGreaterThanOrEqual(8);
  await expect(page.locator('#sceneFac .chap.active')).toHaveCount(1);
});
