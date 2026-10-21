// Genera web/icons/*.png a partir del logotipo SVG de la cabecera (Chrome instalado vía Playwright).
// Uso: node tests/generar_iconos.js
const { chromium } = require('./e2e/node_modules/@playwright/test');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, '..', 'web', 'icons');
const logo = (pad, redondo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(108,195,207)"/><stop offset="1" stop-color="rgb(20,107,126)"/></linearGradient></defs>
${pad ? '<rect width="32" height="32" fill="url(#g)"/>' : `<rect width="32" height="32" rx="${redondo}" fill="url(#g)"/>`}
<g transform="${pad ? 'translate(16 16) scale(0.8) translate(-16 -16)' : ''}">
<path d="M10 7.5h8.5l4.5 4.5v12.5H10z" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/>
<path d="M13 16.5h7M13 20.5h4.5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
<circle cx="23.5" cy="23.5" r="4.5" fill="rgb(242,112,74)" stroke="rgb(10,51,64)" stroke-width="1.5"/>
<path d="m21.4 23.6 1.5 1.5 2.7-3" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const jobs = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]];
  for (const [name, n, mask] of jobs) {
    const p = await b.newPage({ viewport: { width: n, height: n } });
    await p.setContent(`<body style="margin:0;background:transparent">${logo(mask, 9)}</body>`);
    await p.screenshot({ path: path.join(OUT, name), omitBackground: !mask });
    await p.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'icon.svg'), logo(false, 9));
  console.log(fs.readdirSync(OUT).map(f => f + ' ' + fs.statSync(path.join(OUT, f)).size).join('\n'));
})();
