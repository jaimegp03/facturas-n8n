const { chromium, abrir, api, log, OUT, num } = require('./sonda_autonomo');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const A = 4;
  for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
    const p = await abrir(b, { w, h, cli: A, mobile: mob, hash: '#/mi-dinero/resumen' });
    log(`== ${w} overflow=${await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)} hash=${await p.evaluate(() => location.hash)}`);
    log('cli sel md:', await p.locator('#mdCliente').inputValue().catch(() => '?'), '| aviso:', await t(p, '#mdAvisoCli'));
    log('KPIs:', await t(p, '#mdKpis'));
    log('mes:', await t(p, '#mdMes'), '| vacio visible', await p.locator('#mdVacio').isVisible());
    log('alertas:', (await t(p, '#mdAlertas')).slice(0, 400));
    log('prev:', (await t(p, '#mdPrev')).slice(0, 400));
    for (const s of ['ingresos', 'metas', 'deudas', 'renta', 'herramientas']) {
      await p.evaluate(s => { location.hash = '#/mi-dinero/' + s; }, s); await p.waitForTimeout(900);
      const sel = { ingresos: '#mdIngresos', metas: '#mtResumen', deudas: '#deResumen', renta: '#rnKpis', herramientas: '#md-herramientas' }[s];
      log(`[${s}]`, (await t(p, sel)).slice(0, 350));
      if (s === 'metas') log('  metas lista:', (await t(p, '#mtLista')).slice(0, 400));
      if (s === 'deudas') log('  deudas:', (await t(p, '#deLista')).slice(0, 700), '| avisos:', await t(p, '#deAvisos'));
      if (s === 'ingresos') log('  532:', (await t(p, '#md532')).slice(0, 300), '| pres:', (await t(p, '#mdPres')).slice(0, 300));
    }
    const mi = await api('GET', `/mi-dinero?cliente_id=${A}&mes=2026-10`);
    log('API mi-dinero ingresos', JSON.stringify(mi.ingresos).slice(0, 200), 'gasto', JSON.stringify(mi.gasto || mi.gastos).slice(0, 120));
    const ds = await api('GET', `/deudas/resumen?cliente_id=${A}`); log('API deudas', JSON.stringify(ds).slice(0, 500));
    log('errs', p.errs, 'fails', p.fails);
    await p.screenshot({ path: OUT + `/md${w}.png`, fullPage: false });
    await p.context().close();
  }
  await b.close();
})();
