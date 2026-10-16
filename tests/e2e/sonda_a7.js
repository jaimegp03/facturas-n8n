const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  let p = await abrir(b, { cli: 4, hash: '#/mi-dinero/herramientas', w: 1366, h: 768 });
  await p.locator('#btnFiniquito').click(); await p.waitForTimeout(400);
  log('fin: foco', await p.evaluate(() => document.activeElement?.id), 'tipo opciones', await p.locator('#finTipo option').allInnerTexts());
  await p.locator('#finIni').fill('2020-03-15'); await p.locator('#finFin').fill('2019-01-01'); await p.locator('#finSal').fill('30000'); await p.locator('#finCalcular').click(); await p.waitForTimeout(800);
  log('1) fin<ini ->', await t(p, '#finMsg'), '|', (await t(p, '#finRes')).slice(0, 100));
  await p.locator('#finFin').fill('2026-12-31'); await p.locator('#finSal').fill('-5'); await p.locator('#finCalcular').click(); await p.waitForTimeout(800);
  log('2) salario -5 ->', await t(p, '#finMsg'), '|', (await t(p, '#finRes')).slice(0, 100));
  await p.locator('#finSal').fill('32500.55'); await p.locator('#finCalcular').click(); await p.waitForTimeout(800);
  log('3) ok ->', (await t(p, '#finRes')).slice(0, 380), '| msg', await t(p, '#finMsg'));
  await p.screenshot({ path: OUT + '/fin.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); log('   Esc foco', await p.evaluate(() => document.activeElement?.id));
  await p.locator('#btnNomina').click(); await p.waitForTimeout(300);
  await p.locator('#nomBruto').fill('45000'); await p.locator('#nomPagas').selectOption({ index: 0 }).catch(() => {}); await p.locator('#nomCalcular').click(); await p.waitForTimeout(800);
  log('4) nómina ->', (await t(p, '#nomRes')).slice(0, 300), '| msg', await t(p, '#nomMsg'));
  await p.keyboard.press('Escape');
  // deudas: simular y editar
  await p.evaluate(() => { location.hash = '#/mi-dinero/deudas'; }); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Simular' }).first().click(); await p.waitForTimeout(500);
  await p.locator('#dsImporte').fill('10000'); await p.locator('#dsForm button[type=submit]').click(); await p.waitForTimeout(1500);
  log('5) simular 10.000 extra:', (await t(p, '#dsAhorro')).slice(0, 300), '|', await t(p, '#dsMsg'));
  await p.locator('#dsImporte').fill('999999'); await p.locator('#dsForm button[type=submit]').click(); await p.waitForTimeout(1500);
  log('   simular 999.999:', (await t(p, '#dsAhorro')).slice(0, 200), '|', await t(p, '#dsMsg'));
  await p.keyboard.press('Escape');
  // metas: aportar mas de lo que hay (retirar)
  await p.evaluate(() => { location.hash = '#/mi-dinero/metas'; }); await p.waitForTimeout(800);
  const inp = p.locator('#mtLista input[type=number], #mtLista input').first(); await inp.fill('-99999'); await p.getByRole('button', { name: 'Aportar' }).first().click(); await p.waitForTimeout(1500);
  log('6) retirar 99.999 ->', (await t(p, '#mtMsg')).slice(0, 200), '| meta:', (await t(p, '#mtLista')).slice(0, 120));
  await inp.fill('0,5'); await p.getByRole('button', { name: 'Aportar' }).first().click(); await p.waitForTimeout(1500);
  log('   aportar 0,5 ->', (await t(p, '#mtMsg')).slice(0, 200), '| meta:', (await t(p, '#mtLista')).slice(0, 100));
  log('errs', p.errs.filter(e => !/404/.test(e)), 'fails', p.fails.filter(e => !/^404 GET \/recomend/.test(e)));
  await b.close();
})();
