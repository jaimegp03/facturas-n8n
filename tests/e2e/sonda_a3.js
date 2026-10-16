const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const A = 4, R = 2;
  let p = await abrir(b, { cli: R, hash: '#/mi-dinero/resumen' });
  log('A) empresa en Mi dinero: aviso=', await t(p, '#mdAvisoCli'), '| kpis=', (await t(p, '#mdKpis')).slice(0, 200));
  await p.screenshot({ path: OUT + '/empresa-md.png' });
  await p.context().close();
  p = await abrir(b, { cli: A, hash: '#/mi-dinero/ingresos' });
  await api('DELETE', '/ingresos?id=4');
  const nAntes = (await api('GET', `/ingresos?cliente_id=${A}`)).items.length;
  await p.evaluate(() => document.getElementById('mdAddIngreso')?.click() || document.getElementById('mdAddIngreso2')?.click()); await p.waitForTimeout(300);
  await p.locator('#ingConcepto').fill('TEST·doble'); await p.locator('#ingImporte').fill('99.99'); await p.locator('#ingIni').fill('2026-10-05');
  await p.locator('#ingGuardar').dblclick({ delay: 10 }).catch(e => log('dbl', e.message.slice(0, 60))); await p.waitForTimeout(2500);
  const lista = (await api('GET', `/ingresos?cliente_id=${A}`)).items;
  log('   doble clic -> creados', lista.length - nAntes);
  for (const i of lista.slice(nAntes)) await api('DELETE', `/ingresos?id=${i.id}`);
  await p.evaluate(() => document.getElementById('mdAddIngreso')?.click()); await p.waitForTimeout(300);
  await p.locator('#ingConcepto').fill('TEST·<b>x</b> & "Ñandú" 😀'); await p.locator('#ingImporte').fill('5'); await p.locator('#ingIni').fill('2026-10-05');
  await p.locator('#ingGuardar').click(); await p.waitForTimeout(2000);
  log('   html escapado: <b> en tabla =', await p.locator('#mdIngresos b').count(), '| texto:', (await t(p, '#mdIngresos')).slice(0, 120));
  for (const i of (await api('GET', `/ingresos?cliente_id=${A}`)).items.filter(i => i.id > 4)) await api('DELETE', `/ingresos?id=${i.id}`);
  // C) mes limite
  await p.evaluate(() => { location.hash = '#/mi-dinero/resumen'; }); await p.waitForTimeout(600);
  for (let i = 0; i < 10; i++) await p.locator('#mdMesSig').click();
  await p.waitForTimeout(1500);
  log('C) +10 meses:', await t(p, '#mdMes'), '|', (await t(p, '#mdKpis')).slice(0, 160), '| prev:', (await t(p, '#mdPrev')).slice(0, 120));
  for (let i = 0; i < 22; i++) await p.locator('#mdMesAnt').click();
  await p.waitForTimeout(1500);
  log('   -22 meses:', await t(p, '#mdMes'), '|', (await t(p, '#mdKpis')).slice(0, 160));
  // D) recarga mantiene hash y cliente
  await p.reload(); await p.waitForTimeout(2500);
  log('D) recarga: hash', await p.evaluate(() => location.hash), 'cli', await p.locator('#selCliente').inputValue(), 'mes', await t(p, '#mdMes'));
  await p.goBack(); await p.waitForTimeout(500); log('   Atrás ->', await p.evaluate(() => location.hash));
  // E) teclado: tab a nav
  await p.evaluate(() => { location.hash = '#/facturas'; }); await p.waitForTimeout(800);
  await p.keyboard.press('Tab'); const f1 = await p.evaluate(() => document.activeElement?.className + '|' + document.activeElement?.textContent.slice(0, 30));
  log('E) primer tab:', f1);
  log('errs', p.errs, 'fails', p.fails);
  await b.close();
})();
