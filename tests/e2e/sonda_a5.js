const { chromium, abrir, api, log, OUT } = require('./sonda_autonomo');
const AxeBuilder = require('@axe-core/playwright').default;
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  for (const [w, h, mob, hash, cli] of [[390, 844, true, '', 2], [1366, 768, false, '', 2], [390, 844, true, '#/mi-dinero/deudas', 4], [1366, 768, false, '#/mi-dinero/metas', 4], [390, 844, true, '#/mi-dinero/renta', 4]]) {
    const p = await abrir(b, { w, h, cli, mobile: mob, hash });
    if (!hash) { await p.locator('#btnFiscal').click(); await p.waitForTimeout(2500); await p.locator('#list .row-head').first().click(); await p.waitForTimeout(500); }
    const ax = (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + '×' + v.nodes.length);
    const clip = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && e.scrollWidth > e.clientWidth + 2 && /hidden|clip/.test(cs.overflowX) && !/^(svg|path|rect)$/i.test(e.tagName) && e.clientWidth > 0 && cs.textOverflow !== 'ellipsis'; }).slice(0, 6).map(e => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 30) + ' ' + e.scrollWidth + '>' + e.clientWidth));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(`${w} ${hash || 'facturas'} axe=${JSON.stringify(ax)} clip=${JSON.stringify(clip)} overflowX=${over} errs=${p.errs.filter(e => !/404/.test(e)).length}`);
    await p.screenshot({ path: OUT + `/s-${w}-${(hash || 'fac').replace(/\W/g, '')}.png`, fullPage: false });
    await p.context().close();
  }
  await b.close();
})();
