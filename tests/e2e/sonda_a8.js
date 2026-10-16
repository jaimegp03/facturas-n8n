const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  let p = await abrir(b, { cli: 4, w: 1366, h: 768 });
  log('bienvenida:', (await t(p, '#bienvenida')).slice(0, 220), '| lista:', (await t(p, '#list')).slice(0, 160));
  log('kpis:', (await t(p, '#kpis')).slice(0, 220), '| recs:', (await t(p, '#recs')).slice(0, 160), '| saving', (await t(p, '#savingTotal')).slice(0, 80));
  await p.locator('#btnFiscal').click(); await p.waitForTimeout(2500);
  log('fiscal particular:', (await t(p, '#msgFiscal')).slice(0, 160), '|', (await t(p, '#fiscalOut')).slice(-330));
  await p.locator('#descargas [data-descarga]').first().click(); await p.waitForTimeout(3000);
  log('descarga vacia msg:', await t(p, '#msgDescargas'));
  await p.locator('#btnExport').click(); await p.waitForTimeout(6000); log('export msg:', await t(p, '#msgExport'));
  await p.screenshot({ path: OUT + '/part-1366.png' });
  log('errs', p.errs.filter(e => !/404/.test(e)), 'fails', p.fails.filter(e => !/^404 GET \/recomend/.test(e)));
  await b.close();
})();
