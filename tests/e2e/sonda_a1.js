const { chromium, abrir, api, log, OUT, num } = require('./sonda_autonomo');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const cls = (await api('GET', '/clientes')).items; log(cls.map(c => c.id + ':' + c.nombre).join(' | '));
  const R = cls.find(c => c.nombre.includes('Reformas')).id, P = cls.find(c => c.nombre.includes('Panader')).id;
  for (const [w, h, mob] of [[1440, 900, false], [1366, 768, false], [390, 844, true]]) {
    const p = await abrir(b, { w, h, cli: R, mobile: mob });
    const sc = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(`== ${w}: overflow=${sc} filas=${await p.locator('#list .row').count()} total=${(await p.locator('#totalLista').innerText()).replace(/\s+/g, ' ')} kpis=${(await p.locator('#kpis').innerText()).replace(/\s+/g, ' ').slice(0, 260)}`);
    log('errs', p.errs, 'fails', p.fails);
    if (w === 1440) {
      const rs = await api('GET', `/resumen?cliente_id=${R}&desde=2026-01-01&hasta=2026-12-31`);
      log('API resumen total', rs.total, 'n', rs.num_facturas, 'excl', JSON.stringify(rs.excluidas_sin_cambio));
      const f = await api('GET', `/fiscal?cliente_id=${R}&anio=2026&trimestre=3`);
      await p.screenshot({ path: OUT + '/r1440.png' });
      // trimestre
      await p.locator('#fAnio').selectOption('2026').catch(e => log('fAnio', e.message.slice(0, 80)));
      await p.locator('#fTrim').selectOption('3').catch(e => log('fTrim', e.message.slice(0, 80)));
      await p.locator('#btnFiscal').click(); await p.waitForTimeout(3000);
      const t = (await p.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ');
      log('fiscalOut:', t.slice(0, 900)); log('msgFiscal', await p.locator('#msgFiscal').innerText());
      log('API 303 total_deducible', JSON.stringify(f.iva_303.total_deducible), 'interior', JSON.stringify(f.iva_303.interior.map(x => [x.tipo, x.base, x.cuota])));
      // cambio de cliente: filtros
      await p.locator('#fBuscar').fill('zzz'); await p.waitForTimeout(1500);
      log('vacio:', (await p.locator('#list').innerText()).replace(/\s+/g, ' ').slice(0, 200));
      await p.locator('#selCliente').selectOption(String(P)); await p.waitForTimeout(2000);
      log('tras cambiar cliente: buscar=', await p.locator('#fBuscar').inputValue(), 'filas', await p.locator('#list .row').count(), 'fiscalOut=', (await p.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ').slice(0, 120), 'cli', (await p.locator('#clienteInfo').innerText()).replace(/\s+/g, ' ').slice(0, 120));
    }
    await p.context().close();
  }
  await b.close();
})();
