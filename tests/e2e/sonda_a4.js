const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const fs = require('fs');
const t = async (p, s) => (await p.locator(s).innerText()).replace(/\s+/g, ' ');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const R = 2;
  let p = await abrir(b, { cli: R, w: 1366, h: 768 });
  await p.locator('#c4').scrollIntoViewIfNeeded().catch(() => {});
  log('descargas:', (await t(p, '#descargas')).slice(0, 500));
  const botones = await p.locator('#descargas button, #descargas a').evaluateAll(es => es.map(e => (e.id || '') + ':' + e.textContent.trim().slice(0, 40)));
  log('botones', botones.join(' | '), '| btnExport:', (await p.locator('#btnExport').innerText()).trim());
  fs.mkdirSync(OUT + '/dl', { recursive: true });
  for (const [i, txt] of botones.entries()) {
    const loc = p.locator('#descargas button, #descargas a').nth(i);
    if (!(await loc.isVisible())) { log('  invisible:', txt); continue; }
    try { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), loc.click()]);
      const f = OUT + '/dl/' + d.suggestedFilename(); await d.saveAs(f); const buf = fs.readFileSync(f);
      log('  ', txt, '->', d.suggestedFilename(), buf.length, 'B', 'BOM', buf[0] === 0xEF && buf[1] === 0xBB, 'cabecera', buf.slice(0, 120).toString('utf8').replace(/\s+/g, ' ').slice(0, 100));
    } catch (e) { log('  sin descarga', txt, e.message.slice(0, 60)); }
    log('   msg:', await t(p, '#msgDescargas'));
  }
  try { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 40000 }), p.locator('#btnExport').click()]); await d.saveAs(OUT + '/dl/' + d.suggestedFilename()); log('xlsx', d.suggestedFilename(), fs.statSync(OUT + '/dl/' + d.suggestedFilename()).size); } catch (e) { log('xlsx fallo', e.message.slice(0, 80)); }
  log('msgExport', await t(p, '#msgExport'));
  // banco
  log('banco:', (await t(p, '#banco')).slice(0, 300));
  await p.setInputFiles('#bancoArchivo', 'C:/ProyectosClaude/facturas/tests/facturas-contables/extracto_TEST.csv'); await p.waitForTimeout(4000);
  log('banco tras CSV:', (await t(p, '#msgBanco')).slice(0, 200), '|', (await t(p, '#bancoOut')).slice(0, 500));
  await p.screenshot({ path: OUT + '/banco.png' });
  log('errs', p.errs, 'fails', p.fails);
  await b.close();
})();
