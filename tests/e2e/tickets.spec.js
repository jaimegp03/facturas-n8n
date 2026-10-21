// Fase 3 (tickets) en modo demo, sin n8n: subida simulada de un ticket, detalle con líneas, botón «Hacer foto» en móvil,
// axe 0 y sin scroll horizontal a 390. Proyecto: npx playwright test --project=tickets
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const FOTO = path.join(RAIZ, 'tests', 'tickets-ejemplo', 'TEST_T04_bar.png');

let errores;
test.beforeEach(async ({ page }) => {
  errores = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(() => {
    if (window.top !== window || location.protocol !== 'file:') return;
    if (!sessionStorage.getItem('init-demo')) { sessionStorage.setItem('init-demo', '1'); localStorage.setItem('facturas.demo', 'true'); }
  });
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
});
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });
const filas = page => page.locator('#list .row');
const sinScroll = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('tickets: textos de la zona de subida y botón Hacer foto con capture', async ({ page, isMobile }) => {
  await expect(page.locator('#drop')).toContainText('Facturas y tickets');
  const foto = page.locator('#fotoInput');
  await expect(foto).toHaveAttribute('capture', 'environment');
  await expect(foto).toHaveAttribute('accept', 'image/*');
  if (isMobile) await expect(page.locator('#btnFoto')).toBeVisible(); else await expect(page.locator('#btnFoto')).toBeHidden();
});

test('tickets: subida simulada de una foto crea un ticket y el detalle muestra las líneas', async ({ page }) => {
  await page.locator('#selCliente').selectOption({ index: 0 }).catch(() => {});
  await page.evaluate(() => localStorage.setItem('facturas.escanear', 'false'));   // sin escáner: aquí se prueba la subida simulada (el escáner tiene su propio spec)
  await page.locator('#fotoInput').setInputFiles(FOTO);
  const q = page.locator('#queue .qi');
  await expect(q).toHaveCount(1);
  await expect(q.first()).toContainText(/Correcta|Revisar/, { timeout: 15_000 });
  await expect(q.first()).toContainText('Ticket');
  // detalle de un ticket con 12 líneas
  const fila = filas(page).filter({ hasText: 'Súper Ahorro Centro' }).first();
  await fila.scrollIntoViewIfNeeded();
  await fila.locator('.row-head').click();
  const tabla = fila.locator('.tk-tabla');
  await expect(tabla).toBeVisible();
  await expect(tabla.locator('tbody tr')).toHaveCount(12);
  await expect(tabla).toContainText('Leche entera 1L');
  // sin NIF y sin número: nada raro en la fila
  const sin = filas(page).filter({ hasText: 'Zapatería Marín' }).first();
  await expect(sin).toBeVisible();
  const txt = await sin.innerText();
  expect(txt).not.toMatch(/inválido|null|undefined|NaN/i);
});

test('tickets: filtro Tickets, axe 0 y sin scroll horizontal', async ({ page, isMobile }) => {
  await page.locator('#selCliente').selectOption('').catch(() => {});
  await page.locator('#fTipoFac').selectOption('simplificada');
  await expect.poll(async () => await filas(page).count()).toBeGreaterThanOrEqual(8);
  for (const f of await filas(page).all()) await expect(f).toContainText('Ticket');
  expect(await sinScroll(page)).toBeLessThanOrEqual(0);
  await filas(page).first().locator('.row-head').click();
  await expect(page.locator('.tk-tabla').first()).toBeVisible();
  expect(await sinScroll(page)).toBeLessThanOrEqual(0);
  await page.waitForTimeout(700);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')), 'axe').toEqual([]);
  void isMobile;
});
