// PWA: manifest, iconos, service worker, modo sin conexión, caché que NO incluye /webhook/*, aviso de versión nueva, instalación y atajo de foto.
// Servidor estático local en 127.0.0.1 (contexto seguro); sin n8n. Proyecto: npx playwright test --project=pwa
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { iniciar, RAIZ } = require('./servidor_web.js');

let srv;
test.beforeAll(async () => { srv = await iniciar(); });
test.afterAll(async () => { await srv.cerrar(); });
const demo = page => page.addInitScript(() => { try { localStorage.setItem('facturas.demo', 'true'); } catch {} });
const listo = async page => { await page.goto(srv.url + '/'); await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 }); };
const registrar = async page => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) { await page.reload(); await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 }); }
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
};

test('manifest válido y todos los iconos existen con su tamaño', async ({ page }) => {
  await demo(page); await listo(page);
  const m = await (await page.request.get(srv.url + '/manifest.webmanifest')).json();
  expect(m).toMatchObject({ name: 'Facturas', short_name: 'Facturas', display: 'standalone', lang: 'es', scope: './', start_url: './#/facturas' });
  expect(m.description).toMatch(/facturas/i);
  expect(m.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/); expect(m.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  const sizes = m.icons.map(i => i.sizes + ':' + (i.purpose || 'any')).sort();
  expect(sizes).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
  for (const i of m.icons) {
    const r = await page.request.get(srv.url + '/' + i.src); expect(r.status(), i.src).toBe(200);
    const buf = await r.body(); expect(buf.readUInt32BE(16), 'ancho ' + i.src).toBe(parseInt(i.sizes)); expect(buf.readUInt32BE(20), 'alto ' + i.src).toBe(parseInt(i.sizes));
  }
  expect(m.shortcuts.map(s => s.url).sort()).toEqual(['./#/facturas?foto=1', './#/mi-dinero']);
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', /apple-touch-icon\.png/);
  await expect(page.locator('meta[name=theme-color]')).toHaveCount(1);
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  expect(fs.existsSync(path.join(RAIZ, 'web', 'icons', 'apple-touch-icon.png'))).toBe(true);
});

test('service worker activo, sin conexión muestra la aplicación y /webhook/* nunca se guarda', async ({ page, context }) => {
  await demo(page); await listo(page); await registrar(page);
  await page.evaluate(() => fetch('/webhook/categorias', { headers: { 'X-API-Key': 'x' } }).catch(() => {}));
  await page.evaluate(() => fetch('/webhook/facturas?x=1').catch(() => {}));
  const cacheadas = await page.evaluate(async () => { const o = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) o.push(r.url); return o; });
  expect(cacheadas.length).toBeGreaterThan(4);
  expect(cacheadas.filter(u => u.includes('/webhook/'))).toEqual([]);
  for (const f of ['index.html', 'escaner.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) expect(cacheadas.some(u => u.endsWith(f)), f).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#drop')).toBeVisible();
  await expect(page.locator('#pwaOff')).toContainText('Sin conexión');
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  const r = await page.evaluate(() => fetch('/webhook/categorias').then(x => 'respuesta ' + x.status).catch(() => 'error de red'));
  expect(r).toBe('error de red');
  await context.setOffline(false);
  await expect(page.locator('#pwaOff')).toHaveCount(0, { timeout: 10_000 });
});

test('aviso «Hay una versión nueva — Actualizar» cuando cambia el service worker', async ({ page }) => {
  await demo(page); await listo(page); await registrar(page);
  srv.version('2099-version-de-prueba');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await expect(page.locator('#pwaAct')).toContainText('Hay una versión nueva');
  await page.locator('#pwaAct button', { hasText: 'Actualizar' }).click();
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 15_000 }).toEqual(['facturas-shell-2099-version-de-prueba']);
  srv.version(null);
});

test('botón «Instalar aplicación» en Ajustes y atajo ?foto=1', async ({ page }) => {
  await demo(page); await listo(page);
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompt = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.evaluate(() => document.getElementById('dlgAjustes').showModal());
  const btn = page.locator('#btnInstalar');
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => window.__prompt)).toBe(true);
  await expect(btn).toBeHidden();
  await page.evaluate(() => document.getElementById('dlgAjustes').close());
  await page.goto(srv.url + '/#/facturas?foto=1');
  await expect(page.locator('#pwaFoto')).toContainText('escanear un ticket');
  await expect(page).toHaveURL(/#\/facturas$/);
  await expect(page.locator('#tabVistaFac')).toHaveAttribute('aria-current', 'page');
});

test('con file:// no hay service worker ni manifest ni errores', async ({ page }) => {
  const errores = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('facturas.demo', 'true'); } catch {} });
  await page.goto('file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/'));
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('link[rel=manifest]')).toHaveCount(0);
  expect(await page.evaluate(async () => { try { return (await navigator.serviceWorker.getRegistrations()).length; } catch { return 0; } })).toBe(0);   // con file:// el navegador ni lo permite
  await page.evaluate(() => document.getElementById('dlgAjustes').showModal());
  await expect(page.locator('#ajPwa')).toBeHidden();
  expect(errores).toEqual([]);
});
