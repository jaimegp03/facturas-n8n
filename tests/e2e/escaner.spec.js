// Escáner de tickets (web/escaner.js) con fotos sintéticas de tests/escaner (ver tests/generar_escaner.py). Sin n8n ni Gemini.
// Precisión (IoU del cuadrilátero, giro, fondo, contraste, tiempo, tamaño) + interfaz (diálogo, teclado, Esc, original, unir fotos, axe, 390 px).
// Proyecto: npx playwright test --project=escaner
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { iniciar, RAIZ } = require('./servidor_web.js');

const VERDAD = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'escaner', 'verdad.json'), 'utf8'));
const FOTO = n => path.join(RAIZ, 'tests', 'escaner', n);
let srv;
test.use({ serviceWorkers: 'block' });
test.beforeAll(async () => { srv = await iniciar(); });
test.afterAll(async () => { await srv.cerrar(); });

let errores;
test.beforeEach(async ({ page }) => {
  errores = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('facturas.demo', 'true'); } catch {} });
});
test.afterEach(() => { expect(errores, 'errores en consola').toEqual([]); });
const abrir = async page => { await page.goto(srv.url + '/'); await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 }); };

/* ---- geometría (convexa) ---- */
const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const firmada = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
function recortarConvexo(sujeto, clip) {
  if (firmada(clip) < 0) clip = clip.slice().reverse();
  let sal = sujeto.slice(); if (firmada(sal) < 0) sal.reverse();
  for (let i = 0; i < clip.length && sal.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], ent = sal; sal = [];
    const dentro = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const inter = (p, q) => {
      const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [b[0] - a[0], b[1] - a[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
      const t = ((a[0] - p[0]) * d2[1] - (a[1] - p[1]) * d2[0]) / den; return [p[0] + t * d1[0], p[1] + t * d1[1]];
    };
    for (let j = 0; j < ent.length; j++) {
      const p = ent[j], q = ent[(j + 1) % ent.length];
      if (dentro(q)) { if (!dentro(p)) sal.push(inter(p, q)); sal.push(q); } else if (dentro(p)) sal.push(inter(p, q));
    }
  }
  return sal;
}
const iou = (a, b) => { const i = area(recortarConvexo(a, b)); return i / (area(a) + area(b) - i); };
const angulo = q => Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180 / Math.PI;
// giro: se alinean las esquinas detectadas con las reales (desplazamiento cíclico de mínima distancia) y se compara el ángulo de la arista superior
const errorGiro = (det, ver) => {
  let mejor = 0, md = Infinity;
  for (let k = 0; k < 4; k++) { const s = [0, 1, 2, 3].reduce((a, i) => a + Math.hypot(det[(i + k) % 4][0] - ver[i][0], det[(i + k) % 4][1] - ver[i][1]), 0); if (s < md) { md = s; mejor = k; } }
  const al = [0, 1, 2, 3].map(i => det[(i + mejor) % 4]);
  const d = Math.abs(((angulo(al) - angulo(ver)) % 360 + 540) % 360 - 180); return Math.min(d, 360 - d);
};

/* ---- medida dentro del navegador ---- */
async function medir(page, v, modo) {
  return page.evaluate(async ({ url, nombre, poli, modo }) => {
    const blob = await (await fetch(url)).blob(), f = new File([blob], nombre, { type: 'image/jpeg' });
    const r = await window.Escaner.procesarArchivo(f, { modo });
    const pct = (arr, p) => { arr.sort((a, b) => a - b); return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; };
    const luma = d => { const o = []; for (let i = 0; i < d.length; i += 4) o.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114); return o; };
    // salida
    const bm = await createImageBitmap(r.blob), s = Math.min(1, 600 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0, c.width, c.height);
    const ls = luma(x.getImageData(0, 0, c.width, c.height).data);
    // entrada: solo los píxeles dentro del cuadrilátero real
    const ob = await createImageBitmap(f, { imageOrientation: 'from-image' }), k = Math.min(1, 800 / Math.max(ob.width, ob.height));
    const ci = document.createElement('canvas'); ci.width = Math.round(ob.width * k); ci.height = Math.round(ob.height * k);
    const xi = ci.getContext('2d', { willReadFrequently: true }); xi.drawImage(ob, 0, 0, ci.width, ci.height);
    const m = document.createElement('canvas'); m.width = ci.width; m.height = ci.height; const xm = m.getContext('2d');
    xm.beginPath(); poli.forEach((p, i) => i ? xm.lineTo(p[0] * k, p[1] * k) : xm.moveTo(p[0] * k, p[1] * k)); xm.closePath(); xm.fill();
    const dm = xm.getImageData(0, 0, m.width, m.height).data, di = xi.getImageData(0, 0, ci.width, ci.height).data, dentro = [];
    for (let i = 0; i < dm.length; i += 4) if (dm[i + 3] > 200) dentro.push(di[i] * 0.299 + di[i + 1] * 0.587 + di[i + 2] * 0.114);
    const valores = new Set(); for (let i = 0; i < ls.length; i += 7) valores.add(Math.round(ls[i]));
    return {
      quad: r.quad, ok: r.ok, conf: r.conf, ms: r.ms, bytes: r.blob.size, w: r.w, h: r.h, origen: r.origen,
      fondoSalida: pct(ls.slice(), 0.7), contrasteSalida: pct(ls.slice(), 0.9) - pct(ls.slice(), 0.02),
      contrasteEntrada: pct(dentro.slice(), 0.9) - pct(dentro.slice(), 0.02), niveles: valores.size
    };
  }, { url: srv.url + '/__escaner/' + v.archivo, nombre: v.archivo, poli: v.esquinas, modo });
}

test('precisión: IoU, giro, fondo, contraste, tiempo y tamaño sobre 11 fotos sintéticas', async ({ page }) => {
  test.setTimeout(240_000);
  await abrir(page);
  const filas = [];
  for (const v of VERDAD) {
    const m = await medir(page, v, 'color');
    const i = iou(m.quad, v.esquinas), g = errorGiro(m.quad, v.esquinas);
    filas.push({ archivo: v.archivo, fondo: v.fondo, mp: +(v.ancho * v.alto / 1e6).toFixed(1), iou: +i.toFixed(3), giro: +g.toFixed(2), ok: m.ok, fondoSalida: Math.round(m.fondoSalida),
      contrasteSalida: Math.round(m.contrasteSalida), contrasteEntrada: Math.round(m.contrasteEntrada), msTotal: Math.round(m.ms.total), msDetectar: Math.round(m.ms.detectar),
      bytes: m.bytes, salida: m.w + 'x' + m.h });
  }
  fs.mkdirSync(path.join(RAIZ, 'tests', 'salida'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'tests', 'salida', 'escaner-medidas.json'), JSON.stringify(filas, null, 1));
  console.table(filas);
  const buenos = filas.filter(f => f.iou >= 0.9);
  expect(buenos.length / filas.length, 'fracción con IoU ≥ 0,90').toBeGreaterThanOrEqual(0.8);
  for (const f of filas.filter(f => f.iou >= 0.9)) expect(f.giro, 'giro ' + f.archivo).toBeLessThan(2);
  for (const f of filas) {
    expect(f.fondoSalida, 'fondo ' + f.archivo).toBeGreaterThanOrEqual(200);
    expect(f.contrasteSalida, 'contraste ' + f.archivo).toBeGreaterThan(f.contrasteEntrada);
    expect(f.bytes, 'tamaño ' + f.archivo).toBeLessThan(1.2 * 1024 * 1024);
    if (f.mp >= 11.5) expect(f.msTotal, 'tiempo 12 MP ' + f.archivo).toBeLessThan(2500);
  }
});

test('modos: color, grises y blanco y negro (solo 0 y 255)', async ({ page }) => {
  await abrir(page);
  const v = VERDAD.find(x => x.archivo.startsWith('03'));
  const col = await medir(page, v, 'color'), gri = await medir(page, v, 'grises'), bn = await medir(page, v, 'bn');
  expect(gri.fondoSalida).toBeGreaterThanOrEqual(200); expect(bn.fondoSalida).toBeGreaterThanOrEqual(250);
  expect(bn.niveles, 'blanco y negro: pocos niveles tras JPEG').toBeLessThan(col.niveles + 1);
  expect(bn.bytes).toBeLessThan(1.2 * 1024 * 1024);
});

test('fallos: sin ticket detectable las esquinas quedan editables y no hay excepciones', async ({ page }) => {
  await abrir(page);
  // imágenes imposibles: gris liso, negro, blanco, ruido y una diminuta
  const casos = await page.evaluate(async () => {
    const mk = (w, h, pintar) => new Promise(res => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); pintar(x, w, h); c.toBlob(b => res(new File([b], 'x.png', { type: 'image/png' })), 'image/png'); });
    const lista = [
      await mk(800, 600, (x, w, h) => { x.fillStyle = 'rgb(120,120,120)'; x.fillRect(0, 0, w, h); }),
      await mk(800, 600, (x, w, h) => { x.fillStyle = 'rgb(0,0,0)'; x.fillRect(0, 0, w, h); }),
      await mk(800, 600, (x, w, h) => { x.fillStyle = 'rgb(255,255,255)'; x.fillRect(0, 0, w, h); }),
      await mk(800, 600, (x, w, h) => { const d = x.createImageData(w, h); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); }),
      await mk(10, 10, (x, w, h) => { x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, w, h); })
    ];
    const out = [];
    for (const f of lista) { try { const r = await window.Escaner.analizar(f); out.push({ ok: r.ok, quad: r.quad, conf: r.conf }); } catch (e) { out.push({ error: String(e) }); }
    }
    return out;
  });
  for (const c of casos) { expect(c.error, JSON.stringify(c)).toBeUndefined(); expect(c.quad).toHaveLength(4); }
  expect(casos.filter(c => !c.ok).length, 'al menos gris, negro, blanco y ruido no se detectan').toBeGreaterThanOrEqual(3);
  // y por la interfaz: el diálogo se abre con el aviso «Ajusta las esquinas» y las 4 esquinas movibles
  const gris = path.join(RAIZ, 'tests', 'salida', 'gris-liso.png');
  fs.mkdirSync(path.dirname(gris), { recursive: true });
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = 'rgb(120,120,120)'; x.fillRect(0, 0, 900, 600); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(gris, Buffer.from(b64, 'base64'));
  await page.locator('#fileInput').setInputFiles(gris);
  await expect(page.locator('#dlgEscaner')).toBeVisible();
  await expect(page.locator('#escMsg')).toContainText('Ajusta las esquinas');
  await expect(page.locator('#dlgEscaner .esc-asa')).toHaveCount(4);
  const h0 = page.locator('#dlgEscaner .esc-asa').nth(0);
  const antes = await h0.evaluate(e => e.style.left);
  await h0.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  expect(await h0.evaluate(e => e.style.left)).not.toBe(antes);
  await page.locator('#escDescartar').click();
  await expect(page.locator('#dlgEscaner')).toBeHidden();
});

test('interfaz: diálogo accesible, teclado, Esc, original, aceptar, rotar, modos', async ({ page }) => {
  await abrir(page);
  const foto = FOTO('03_gris_clara.jpg');
  await page.locator('#fileInput').setInputFiles(foto);
  const dlg = page.locator('#dlgEscaner');
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAttribute('aria-labelledby', 'escTit');
  await expect(page.locator('#escMsg')).toContainText('Esquinas detectadas');
  // foco dentro del diálogo
  expect(await page.evaluate(() => document.getElementById('dlgEscaner').contains(document.activeElement))).toBe(true);
  // las 4 esquinas tienen nombre accesible y se mueven con flechas (Shift = salto grande)
  const asas = dlg.locator('.esc-asa');
  await expect(asas).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(asas.nth(i)).toHaveAttribute('aria-label', /Esquina .* Flechas/);
  const a0 = asas.nth(0), x0 = parseFloat(await a0.evaluate(e => e.style.left));
  await a0.focus(); await page.keyboard.press('Shift+ArrowLeft');
  expect(parseFloat(await a0.evaluate(e => e.style.left))).toBeLessThan(x0);
  // arrastre con el ratón
  const caja = await asas.nth(2).boundingBox();
  const y0 = parseFloat(await asas.nth(2).evaluate(e => e.style.top));
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2); await page.mouse.down();
  await page.mouse.move(caja.x + caja.width / 2 - 25, caja.y + caja.height / 2 - 25, { steps: 4 }); await page.mouse.up();
  expect(parseFloat(await asas.nth(2).evaluate(e => e.style.top))).toBeLessThan(y0);
  // rotar cambia las proporciones del resultado
  const dim = () => page.locator('#escResultado').evaluate(c => [c.width, c.height]);
  const [w1, h1] = await dim(); await page.locator('#escRotar').click();
  await expect.poll(async () => { const [w, h] = await dim(); return w > h; }).toBe(w1 <= h1);
  await page.locator('#escRotar').click(); await page.locator('#escRotar').click(); await page.locator('#escRotar').click();
  // modo blanco y negro: el resultado solo tiene negro y blanco
  await dlg.getByLabel('Blanco y negro').check();
  await expect.poll(() => page.locator('#escResultado').evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let o = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) o++; return o / (d.length / 4) < 0.02;
  })).toBe(true);
  await dlg.getByLabel('Color mejorado').check();
  // Esc cierra y descarta (nada en la cola)
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('#queue .qi')).toHaveCount(0);
  // Usar original: se sube el archivo tal cual
  await page.locator('#fileInput').setInputFiles(foto);
  await expect(dlg).toBeVisible(); await page.locator('#escOriginal').click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#queue .qi .name').first()).toHaveText('03_gris_clara.jpg');
  // Aceptar: se sube el JPEG escaneado con el nombre nuevo
  await page.locator('#fileInput').setInputFiles(foto);
  await expect(dlg).toBeVisible(); await page.locator('#escAceptar').click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#queue .qi .name').first()).toHaveText('03_gris_clara_escaneado.jpg');
});

test('interfaz: unir dos fotos de un ticket largo', async ({ page }) => {
  await abrir(page);
  await page.locator('#fileInput').setInputFiles(FOTO('02_oscura_vertical.jpg'));
  const dlg = page.locator('#dlgEscaner');
  await expect(dlg).toBeVisible();
  await dlg.locator('#escOtraArchivo').setInputFiles(FOTO('04_madera_clara.jpg'));
  await expect(dlg.locator('#escPaginas button', { hasText: 'Foto 2' })).toBeVisible();
  await expect(page.locator('#escAyuda')).toContainText('Se unirán 2 fotos');
  await dlg.locator('#escAceptar').click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#queue .qi .name').first()).toHaveText('02_oscura_vertical_escaneado.jpg');
  await expect(page.locator('#queue .qi').first()).toContainText(/Ticket|Correcta|Revisar/, { timeout: 15_000 });
});

test('varias imágenes: procesado automático sin diálogo y aviso; PDF y HEIC pasan; el ajuste lo desactiva', async ({ page }) => {
  await abrir(page);
  await page.locator('#fileInput').setInputFiles([FOTO('01_oscura_12mp.jpg'), FOTO('05_apaisada.jpg')]);
  await expect(page.locator('#queue .qi')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('#dlgEscaner')).toBeHidden();
  const nombres = await page.locator('#queue .qi .name').allInnerTexts();
  expect(nombres.sort()).toEqual(['01_oscura_12mp_escaneado.jpg', '05_apaisada_escaneado.jpg']);
  await expect(page.locator('#toast')).toContainText('Escaneadas 2 fotos');
  // PDF: sin diálogo
  const pdf = path.join(RAIZ, 'tests', 'facturas-ejemplo', '01_zara_ropa.pdf');
  if (fs.existsSync(pdf)) { await page.locator('#fileInput').setInputFiles(pdf); await expect(page.locator('#dlgEscaner')).toBeHidden(); await expect(page.locator('#queue .qi')).toHaveCount(3); }
  // HEIC (no decodificable aquí): se sube tal cual
  const heic = path.join(RAIZ, 'tests', 'salida', 'falsa.heic'); fs.writeFileSync(heic, Buffer.from('no es una imagen'));
  await page.locator('#fileInput').setInputFiles(heic);
  await expect(page.locator('#dlgEscaner')).toBeHidden();
  await expect(page.locator('#queue .qi .name').first()).toHaveText('falsa.heic');
  // desactivar el ajuste: una sola foto ya no abre el escáner
  await page.evaluate(() => localStorage.setItem('facturas.escanear', 'false'));
  await page.locator('#fileInput').setInputFiles(FOTO('03_gris_clara.jpg'));
  await expect(page.locator('#dlgEscaner')).toBeHidden();
  await expect(page.locator('#queue .qi .name').first()).toHaveText('03_gris_clara.jpg');
});

test('axe 0 con el diálogo abierto y sin scroll horizontal a 390 px', async ({ page }) => {
  await abrir(page);
  await page.locator('#fileInput').setInputFiles(FOTO('07_sombra_fuerte.jpg'));
  await expect(page.locator('#dlgEscaner')).toBeVisible();
  await expect(page.locator('#escMsg')).not.toBeEmpty();
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const d = await page.locator('#dlgEscaner').evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(d[0]).toBeLessThanOrEqual(d[1]);
  const caja = await page.locator('#dlgEscaner').boundingBox();
  expect(caja.x).toBeGreaterThanOrEqual(0); expect(caja.x + caja.width).toBeLessThanOrEqual(390.5);
  await page.locator('#escDescartar').click();
});
