// Segunda parte del recorrido del restaurante: arreglar las cuentas de la comida (corrección + lote), trimestre por defecto y móvil.
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const OUT = path.join(RAIZ, 'tests', 'salida', 'restaurante');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = env.N8N_BASE_URL + '/webhook', H = { 'X-API-Key': env.FACT_API_KEY };
const n = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.') || 0);
(async () => {
  const cl = (await (await fetch(API + '/clientes', { headers: H })).json()).items.find(c => /La Barraca/.test(c.nombre));
  const b = await chromium.launch({ channel: 'chrome' });
  async function abrir(vp, extra = {}) {
    const ctx = await b.newContext({ viewport: vp, locale: 'es-ES', acceptDownloads: true, ...extra });
    const p = await ctx.newPage();
    await p.addInitScript(([base, token, cli]) => {
      if (window.top !== window || location.protocol !== 'file:') return;
      localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
      localStorage.setItem('facturas.desde', JSON.stringify('2026-10-09')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-15'));
      localStorage.setItem('facturas.cliente', JSON.stringify(cli));
    }, [API, env.FACT_API_KEY, String(cl.id)]);
    await p.goto('file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/'));
    await p.locator('#list .row').first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(2500);
    return p;
  }
  const p = await abrir({ width: 1366, height: 768 });

  console.log('TRIMESTRE al abrir:', await p.locator('#fAnio').inputValue(), await p.locator('#fTrim').inputValue() + 'T', '|', (await p.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ').slice(0, 90));

  // 1. Corregir la cuenta del proveedor de pescado desde la ficha
  await p.locator('#fBuscar').fill('pescados'); await p.waitForTimeout(1300);
  const fila = p.locator('#list .row').first();
  await fila.locator('.row-head').click();
  await fila.getByRole('button', { name: /Corregir/ }).click();
  await fila.locator('input[name="cuenta_gasto"]').fill('600');
  await fila.getByRole('button', { name: 'Guardar cambios' }).click();
  await p.locator('#toast').waitFor({ state: 'visible' });
  console.log('TOAST tras corregir la cuenta:', await p.locator('#toast').innerText());
  await p.screenshot({ path: path.join(OUT, '12_cuenta_corregida.png') });

  // 2. Resto de comida a la vez: filtrar categoría, seleccionar todas, quitar el ticket y aplicar cuenta 600
  await p.locator('#fBuscar').fill(''); await p.waitForTimeout(1200);
  await p.locator('#fCat').selectOption('Alimentación y supermercado'); await p.waitForTimeout(1500);
  await p.locator('#selTodas').check();
  const ticket = p.locator('#list .row').filter({ hasText: 'Cash' });
  if (await ticket.count()) await ticket.locator('input.sel-fila').uncheck();
  console.log('LOTE:', await p.locator('#loteN').innerText());
  await p.screenshot({ path: path.join(OUT, '13_lote_cuenta.png') });
  await p.locator('#loteCuenta').fill('600'); await p.locator('#loteCuentaOk').click();
  await p.locator('#toast').filter({ hasText: 'Cuenta cambiada' }).waitFor({ timeout: 15000 });
  console.log('TOAST lote:', await p.locator('#toast').innerText());
  await p.locator('#fCat').selectOption(''); await p.waitForTimeout(1500);

  // 3. Asientos otra vez
  await p.locator('#c4').scrollIntoViewIfNeeded();
  const [d] = await Promise.all([p.waitForEvent('download'), p.locator('[data-descarga="csv"]').click()]);
  const ruta = path.join(OUT, 'asientos2.csv'); await d.saveAs(ruta);
  const filas = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => l.split(';'));
  const h = filas[0], ic = h.indexOf('Cuenta'), idb = h.indexOf('Debe'), ih = h.indexOf('Haber');
  const gasto = {}, prov = new Set();
  for (const r of filas.slice(1)) { if (r[ic].startsWith('6')) gasto[r[ic]] = +(((gasto[r[ic]] || 0) + n(r[idb]) - n(r[ih])).toFixed(2)); if (/^4[01]/.test(r[ic])) prov.add(r[ic]); }
  console.log('ASIENTOS tras corregir → gasto por cuenta:', JSON.stringify(gasto), '| proveedores:', [...prov].join(','));

  // 4. La regla quedó guardada (por cliente + proveedor)
  const f = (await (await fetch(`${API}/facturas?cliente_id=${cl.id}&desde=2000-01-01&hasta=2100-12-31&por_pagina=50`, { headers: H })).json()).items;
  console.log('ORIGEN de la cuenta en pescado:', f.find(x => /Pescados/.test(x.proveedor)).origen_categoria, '| cuentas:', f.map(x => x.cuenta_gasto).join(','));

  // 5. Móvil: el dueño mira desde el teléfono
  const m = await abrir({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.locator('#c2').scrollIntoViewIfNeeded(); await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(OUT, '14_movil_lista.png') });
  const ancho = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('MÓVIL scroll horizontal extra:', ancho);
  await b.close();
})().catch(e => { console.error('ERROR', e.message.split('\n')[0]); process.exit(1); });
