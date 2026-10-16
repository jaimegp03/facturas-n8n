const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  let p = await abrir(b, { cli: 2 });
  // 1 periodo invertido
  await p.locator('#desde').fill('2026-12-31'); await p.locator('#hasta').fill('2026-01-01'); await p.locator('#hasta').press('Enter'); await p.waitForTimeout(2000);
  log('1) desde>hasta: filas', await p.locator('#list .row').count(), '| msgs:', (await t(p, '#list')).slice(0, 160), '| periodoTxt', await t(p, '#periodoTxt'));
  await p.locator('#desde').fill('2026-12-31'); await p.locator('#hasta').fill('2026-12-31'); await p.locator('#hasta').press('Enter'); await p.waitForTimeout(2000);
  log('   31/12 solo: filas', await p.locator('#list .row').count(), '|', (await t(p, '#totalLista')), '| kpi', (await t(p, '#kpis')).slice(0, 120));
  await p.locator('#desde').fill('2026-01-01'); await p.locator('#hasta').fill('2026-12-31'); await p.locator('#hasta').press('Enter'); await p.waitForTimeout(2000);
  // 2 filtros entre vistas
  await p.locator('#fEstado').selectOption({ index: 1 }).catch(() => {}); await p.waitForTimeout(1500);
  const f1 = await p.locator('#list .row').count(); const est = await p.locator('#fEstado').inputValue();
  await p.evaluate(() => { location.hash = '#/mi-dinero/resumen'; }); await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = '#/facturas'; }); await p.waitForTimeout(1500);
  log('2) filtro estado', est, 'filas', f1, '-> tras ir y volver', await p.locator('#fEstado').inputValue(), await p.locator('#list .row').count(), '| pestaña', await p.locator('#tabsEstado [aria-selected=true], #tabsEstado .on').first().innerText().catch(() => '?'));
  // 3 nuevo cliente
  await p.locator('#btnNuevoCliente').click(); await p.waitForTimeout(300);
  await p.locator('#cliNombre').fill('TEST·Dup'); await p.locator('#cliNif').fill('B12345678'); 
  await p.locator('#cliForm button[type=submit]').click(); await p.waitForTimeout(1500);
  log('3) NIF inválido ->', await t(p, '#cliMsg'));
  await p.locator('#cliNif').fill('B90456120'); await p.locator('#cliForm button[type=submit]').click(); await p.waitForTimeout(1500);
  log('   NIF duplicado ->', await t(p, '#cliMsg'));
  await p.locator('#cliNombre').fill(''); await p.locator('#cliForm button[type=submit]').click(); await p.waitForTimeout(800);
  log('   sin nombre ->', await t(p, '#cliMsg'), '| dlg abierto', await p.locator('#dlgCliente').evaluate(d => d.open));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  log('   foco tras Esc', await p.evaluate(() => document.activeElement?.id));
  // 4 teclado en lista: Enter abre fila, e corrige, Esc
  await p.locator('#list .row').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  log('4) Enter abre:', await p.locator('#list .row').first().evaluate(e => e.className + ' exp=' + e.getAttribute('aria-expanded')));
  await p.keyboard.press('e'); await p.waitForTimeout(400);
  log('   e -> form edicion', await p.locator('form[data-edit]').count(), 'foco', await p.evaluate(() => document.activeElement?.name || document.activeElement?.tagName));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  log('   Esc -> form', await p.locator('form[data-edit]').count());
  // importes raros en edicion: coma decimal
  await p.locator('#list .row').first().locator('.row-head').click().catch(() => {}); await p.waitForTimeout(300);
  await p.locator('#list .row').first().getByRole('button', { name: /Corregir/ }).click().catch(() => {}); await p.waitForTimeout(300);
  const inp = p.locator('#list .row').first().locator('input[name="total"]');
  await inp.fill('1.161,60'); await p.locator('#list .row').first().getByRole('button', { name: 'Guardar cambios' }).click(); await p.waitForTimeout(1200);
  log('5) total "1.161,60" ->', await t(p, '#list .row .form-msg').catch(() => '(sin msg)'));
  await inp.fill('-5'); await p.locator('#list .row').first().getByRole('button', { name: 'Guardar cambios' }).click(); await p.waitForTimeout(1500);
  log('   total -5 ->', (await p.locator('#list .row').first().locator('.form-msg').innerText().catch(() => '(cerrado)')).slice(0, 160));
  log('errs', p.errs.filter(e => !/404/.test(e)), 'fails', p.fails.filter(e => !/^404 GET \/recomend/.test(e)));
  await b.close();
})();
