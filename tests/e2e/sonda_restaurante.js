// Sonda de comprobación del recorrido del restaurante (solo lectura). Uso: node tests/e2e/sonda_restaurante.js
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = env.N8N_BASE_URL + '/webhook', H = { 'X-API-Key': env.FACT_API_KEY };
(async () => {
  const cl = (await (await fetch(API + '/clientes', { headers: H })).json()).items.find(c => /La Barraca/.test(c.nombre));
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-ES' })).newPage();
  const fallos = [];
  p.on('response', r => { if (r.status() >= 400) fallos.push(r.status() + ' ' + r.url().replace(API, '').slice(0, 90)); });
  await p.addInitScript(([base, token, cli]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base)); localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-10-09')); localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-15'));
    localStorage.setItem('facturas.cliente', JSON.stringify(cli));
  }, [API, env.FACT_API_KEY, String(cl.id)]);
  await p.goto('file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/'));
  await p.locator('#list .row').first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(3000);
  const lat = async () => ({ s2: await p.locator('#s2').innerText(), s3: await p.locator('#s3').innerText(), s4: await p.locator('#s4').innerText() });
  console.log('BARRA LATERAL (cliente restaurante):', JSON.stringify(await lat()));
  console.log('RECOMENDACIONES visibles:', (await p.locator('#recs').innerText()).replace(/\s+/g, ' ').slice(0, 160), '| ahorro:', await p.locator('#savingTotal').isVisible());
  console.log('KPIs:', (await p.locator('#kpis').innerText()).replace(/\s+/g, ' ').slice(0, 220));
  console.log('FALLOS DE RED:', fallos);
  // trimestre: ¿qué trimestre sale por defecto y qué pasa al cambiarlo?
  console.log('TRIMESTRE por defecto:', await p.locator('#fAnio').inputValue(), await p.locator('#fTrim').inputValue(), '|', (await p.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ').slice(0, 110));
  await p.locator('#fTrim').selectOption('4'); await p.locator('#btnFiscal').click();
  await p.waitForFunction(() => /Del 01\/10\/2026/.test(document.querySelector('#msgFiscal').innerText), null, { timeout: 20000 });
  console.log('4T (esperando al resultado):', (await p.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ').slice(0, 520));
  await p.locator('#trimestre').screenshot({ path: path.join(RAIZ, 'tests/salida/restaurante/08b_trimestre_4T.png') });
  // otro cliente: ¿se limpia la barra lateral?
  await p.locator('#selCliente').selectOption({ label: 'Personal' }); await p.waitForTimeout(3000);
  console.log('Tras cambiar a Personal:', JSON.stringify(await lat()));
  await p.locator('#selCliente').selectOption(String(cl.id)); await p.waitForTimeout(3000);
  console.log('Vuelta al restaurante:', JSON.stringify(await lat()), '| ahorro visible:', await p.locator('#savingTotal').isVisible());
  // rectificativa y estado de pago de lo conciliado
  const f = (await (await fetch(`${API}/facturas?cliente_id=${cl.id}&desde=2000-01-01&hasta=2100-12-31&por_pagina=50`, { headers: H })).json()).items;
  const rect = f.find(x => x.tipo_factura === 'rectificativa');
  console.log('RECTIFICATIVA: rectifica_numero =', rect.rectifica_numero, '| total', rect.total, '| estado_pago', rect.estado_pago, '| deducible', rect.deducible, 'cuota', rect.cuota_deducible);
  console.log('PAGADAS tras conciliar:', f.filter(x => x.estado_pago === 'pagada').map(x => (x.numero || '') + ' ' + (x.fecha_pago || '')).join(' · '));
  await b.close();
})();
