const { chromium } = require('C:/ProyectosClaude/facturas/tests/e2e/node_modules/@playwright/test');
const jobs = JSON.parse(process.argv[2]);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
  for (const [url, list] of jobs) {
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(3000);
      for (const t of ['Rechazar', 'Reject', 'Opt out of all', 'Solo necesarias', 'Rechazar todas', 'Rechazar todo']) { const l = p.getByRole('button', { name: t }).first(); if (await l.count()) { try { await l.click({ timeout: 1500 }); break; } catch {} } }
      for (const [name, y] of list) {
        for (let i = 0; i <= y; i += 500) { await p.evaluate(i => scrollTo(0, i), i); await p.waitForTimeout(120); }
        await p.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(1800);
        await p.screenshot({ path: name + '.png' }); console.log('ok', name);
      }
    } catch (e) { console.log('fallo', url, e.message.split('\n')[0]); }
    await p.close();
  }
  await b.close();
})();
