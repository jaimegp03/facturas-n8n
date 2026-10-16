// Genera docs/GUIA.pdf a partir de docs/GUIA.md con el Chrome instalado (sin instalar nada en el sistema).
// Uso: node tests/generar_guia_pdf.js     (necesita internet: marked y mermaid por cdnjs, fuentes de Google con respaldo del sistema)
// Pasos: Markdown -> HTML (marked 4.3.0) -> diagramas Mermaid 10.6.1 -> page.pdf (A4, printBackground, pie con número de página).
// Comprueba además imágenes rotas, diagramas sin renderizar y enlaces internos; sale con 1 si algo falla.
const { chromium } = require('./e2e/node_modules/@playwright/test');
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const MD = path.join(RAIZ, 'docs', 'GUIA.md'), PDF = path.join(RAIZ, 'docs', 'GUIA.pdf');
const TMP = path.join(RAIZ, 'tests', 'salida', 'guia'); fs.mkdirSync(TMP, { recursive: true });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hoy = new Date(), fecha = `${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}`;
const md = fs.readFileSync(MD, 'utf8').replace(/^# .*\r?\n/, '');   // el título va en la portada
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
:root { --teal: #0F4C5C; --tinta: #1b2b30; --suave: #5a6b70; --linea: #d5dfe1; --fondo: #f1f6f7; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'IBM Plex Sans', 'Manrope', 'Segoe UI', Arial, sans-serif; color: var(--tinta); font-size: 10.5pt; line-height: 1.5; margin: 0; }
.portada { height: 250mm; display: flex; flex-direction: column; justify-content: center; border-left: 10mm solid var(--teal); padding-left: 12mm; break-after: page; }
.portada .etiqueta { font-size: 10pt; letter-spacing: .18em; text-transform: uppercase; color: var(--suave); margin-bottom: 8mm; }
.portada h1 { font-size: 34pt; line-height: 1.1; margin: 0 0 8mm; color: var(--teal); }
.portada p { font-size: 13pt; color: var(--suave); margin: 0 0 3mm; max-width: 130mm; }
.portada .fecha { margin-top: 20mm; font-size: 11pt; color: var(--tinta); }
h2 { font-size: 21pt; color: var(--teal); margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 2px solid var(--teal); break-before: page; break-after: avoid; }
h3 { font-size: 14.5pt; color: var(--teal); margin: 8mm 0 3mm; break-after: avoid; }
h4 { font-size: 12pt; margin: 6mm 0 2mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: var(--teal); text-decoration: none; border-bottom: 1px solid #9cc0c8; }
blockquote { margin: 4mm 0; padding: 3mm 5mm; background: var(--fondo); border-left: 3px solid var(--teal); break-inside: avoid; }
blockquote p { margin: 1mm 0; }
table { width: 100%; border-collapse: collapse; margin: 4mm 0; font-size: 9pt; }
th, td { border: 1px solid var(--linea); padding: 1.6mm 2.4mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: var(--teal); color: #fff; font-weight: 600; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: var(--fondo); }
code { font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 9pt; background: var(--fondo); padding: .2mm 1.2mm; border-radius: 1mm; overflow-wrap: anywhere; }
pre { background: #10272d; color: #e8f1f3; padding: 4mm; border-radius: 2mm; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; break-inside: avoid; font-size: 8.5pt; }
pre code { background: none; color: inherit; padding: 0; }
figure { margin: 5mm 0; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 135mm; border: 1px solid var(--linea); border-radius: 2mm; }
figcaption { font-size: 8.5pt; color: var(--suave); margin-top: 1.5mm; }
.mermaid { text-align: center; margin: 5mm 0; break-inside: avoid; }
.mermaid svg { max-width: 100% !important; max-height: 215mm; width: auto; height: auto; }
hr { border: 0; border-top: 1px solid var(--linea); margin: 6mm 0; }
h2 + hr { display: none; }
ul, ol { padding-left: 6mm; }
`;
const base = 'file:///' + RAIZ.split(path.sep).join('/') + '/docs/';
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de usuario</title>
<base href="${base}"><style>${CSS}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.6.1/mermaid.min.js"></script></head><body>
<section class="portada"><div class="etiqueta">Facturas n8n · Guía de usuario</div><h1>Tus facturas y tu dinero, en claro</h1>
<p>Qué es la herramienta, cómo ponerla en marcha y cómo se usa cada pantalla de la web.</p><p>Para particulares, autónomos y gestorías.</p><div class="fecha">${fecha}</div></section>
<main id="doc"></main></body></html>`;

(async () => {
  const f = path.join(TMP, 'guia.html'); fs.writeFileSync(f, html);
  const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage();
  p.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
  await p.goto('file:///' + f.split(path.sep).join('/'), { waitUntil: 'load' });
  await p.evaluate(async md => {
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const doc = document.getElementById('doc'); doc.innerHTML = marked.parse(md, { gfm: true, headerIds: false, mangle: false });
    doc.querySelectorAll('h2,h3,h4').forEach(h => { h.id = h.textContent.toLowerCase().replace(/[.,:;()«»¿?¡!"'`]/g, '').trim().replace(/\s+/g, '-'); });
    const ind = [...doc.querySelectorAll('h2')].find(h => /^Índice/.test(h.textContent)); if (ind) ind.style.breakBefore = 'auto';
    const ids = new Map([...doc.querySelectorAll('[id]')].map(e => [norm(e.id), e.id]));
    doc.querySelectorAll('a[href^="#"]').forEach(a => {
      const k = decodeURIComponent(a.getAttribute('href').slice(1));
      if (!document.getElementById(k) && ids.has(norm(k))) a.setAttribute('href', '#' + ids.get(norm(k)));
    });
    // en vertical (A4) los diagramas anchos se leen mejor al girar su dirección
    doc.querySelectorAll('code.language-mermaid').forEach(c => { const d = document.createElement('div'); d.className = 'mermaid'; d.textContent = c.textContent.replace(/^flowchart (LR|TB)/, (m, x) => 'flowchart ' + (x === 'LR' ? 'TB' : 'LR'));  c.parentElement.replaceWith(d); });
    doc.querySelectorAll('p > img:only-child').forEach(i => { const fg = document.createElement('figure'); const cap = document.createElement('figcaption'); cap.textContent = i.alt; i.parentElement.replaceWith(fg); fg.append(i, cap); });
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', flowchart: { useMaxWidth: false, htmlLabels: true }, fontFamily: 'IBM Plex Sans, Segoe UI, Arial, sans-serif' });
    await mermaid.run({ querySelector: '.mermaid' });
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  }, md);
  const chk = await p.evaluate(() => ({
    rotas: [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')),
    diagramas: [...document.querySelectorAll('.mermaid')].map(d => !!d.querySelector('svg') && !/Syntax error/i.test(d.textContent)),
    enlacesRotos: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))).map(a => a.getAttribute('href')),
    imagenes: document.images.length,
  }));
  const pie = '<div style="width:100%;font-size:8px;color:#5a6b70;font-family:Arial,sans-serif;display:flex;justify-content:space-between;padding:0 16mm">' +
    '<span>Guía de usuario · Facturas n8n</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>';
  await p.pdf({ path: PDF, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: pie,
    margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' } });
  await b.close();
  console.log(JSON.stringify(chk), '->', PDF);
  if (chk.rotas.length || chk.diagramas.some(x => !x) || chk.enlacesRotos.length) { console.log('FALLO en la comprobación'); process.exit(1); }
})();
