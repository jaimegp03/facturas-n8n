// Auditoría contable: tareas del contable en la web real a 1920×1080, midiendo clics, teclas, pantallas y segundos.
// Solo lee datos, salvo una corrección sobre una fila TEST que se deshace al final por la API.
// Ejecutar solo con el proyecto «auditoria»: npx playwright test auditoria_contable.spec.js --project=auditoria
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const OUT = path.join(RAIZ, 'tests', 'salida', 'auditoria-contable');
fs.mkdirSync(OUT, { recursive: true });
const metricas = {};

// Contador de esfuerzo: cada interacción suma clics/teclas y el tiempo de pared de la tarea.
function medidor(nombre) {
  const m = { clics: 0, teclas: 0, pantallas: 0, salidas_de_la_web: 0, notas: [], t0: Date.now() };
  metricas[nombre] = m;
  return {
    async click(loc) { m.clics++; await loc.click(); },
    async escribir(loc, txt) { m.teclas += txt.length; await loc.fill(txt); },
    async elegir(loc, val) { m.clics += 2; await loc.selectOption(val); },
    pantalla() { m.pantallas++; },
    salir(por) { m.salidas_de_la_web++; m.notas.push('Sale de la web: ' + por); },
    nota(t) { m.notas.push(t); },
    fin(resultado) { m.segundos = +((Date.now() - m.t0) / 1000).toFixed(1); m.resultado = resultado; delete m.t0; }
  };
}

test.use({ viewport: { width: 1920, height: 1080 }, channel: 'chrome' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-12-31'));
  }, [API, env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await expect(page.locator('#connTxt')).toHaveText('Conectado', { timeout: 20000 });
  await expect(page.locator('#list .row').first()).toBeVisible();
});

// Se guarda tras cada prueba (fusionando con lo anterior) para no perder métricas si una prueba falla.
test.afterEach(() => {
  const f = path.join(OUT, 'uso_metricas.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  fs.writeFileSync(f, JSON.stringify(Object.assign(prev, metricas), null, 2));
});

test('T12 · encontrar una factura por proveedor, NIF, número o importe y abrir el original', async ({ page }) => {
  const m = medidor('T12_busqueda');
  const buscar = page.locator('#fBuscar');
  const contar = async () => { await page.waitForTimeout(900); return page.locator('#list .row').count(); };
  await m.escribir(buscar, 'Materiales'); const porProveedor = await contar();
  await m.escribir(buscar, 'B9045612'); const porNif = await contar();
  await m.escribir(buscar, 'MCL-26-02210'); const porNumero = await contar();
  await m.escribir(buscar, '1161,60'); const porImporte = await contar();
  m.nota(`Resultados · proveedor «Materiales»: ${porProveedor} · NIF: ${porNif} · nº factura: ${porNumero} · importe: ${porImporte}`);
  await m.escribir(buscar, 'Materiales'); await contar();
  const fila = page.locator('#list .row').filter({ hasText: '4.404,34' });
  await fila.locator('.row-head').hover();
  m.pantalla();
  await page.locator('#preview iframe, #preview img').first().waitFor({ timeout: 8000 }).catch(() => {});
  const hayOriginal = await page.locator('#preview iframe, #preview img').count();
  await page.screenshot({ path: path.join(OUT, 'T12_busqueda.png') });
  m.fin({ porProveedor, porNif, porNumero, porImporte, original_visible_en_vista_previa: hayOriginal > 0 });
  expect(porProveedor).toBeGreaterThan(0);
});

test('T2 · revisar las facturas «revisar»: clics y segundos por factura', async ({ page }) => {
  const m = medidor('T2_revisar');
  await m.click(page.locator('#btnVerRevisar'));
  await page.waitForTimeout(1200);
  const n = await page.locator('#list .row').count();
  const test_ = page.locator('#list .row').filter({ hasText: 'Elena Ruiz' }).first();
  m.nota(`Facturas en «revisar»: ${n}`);
  await page.screenshot({ path: path.join(OUT, 'T2_revisar_lista.png') });
  if (await test_.count()) {
    const t0 = Date.now();
    await m.click(test_.locator('.row-head'));
    const motivo = (await test_.locator('.why.warn').textContent().catch(() => '')) || '';
    await m.click(test_.getByRole('button', { name: 'Corregir' }));
    m.pantalla();
    const sub = test_.locator('input[name="subcategoria"]');
    const original = await sub.inputValue();
    await m.escribir(sub, original + ' (revisado)');
    await m.click(test_.getByRole('button', { name: 'Guardar cambios' }));
    await expect(test_.locator('form[data-edit]')).toHaveCount(0, { timeout: 15000 });
    m.nota(`Una corrección completa: ${((Date.now() - t0) / 1000).toFixed(1)} s. Motivo mostrado: ${motivo.trim().slice(0, 160)}`);
    await page.screenshot({ path: path.join(OUT, 'T2_revisar_corregida.png') });
    // deshacer el cambio de prueba por la API (la web no tiene «deshacer»)
    const id = await test_.getAttribute('data-id');
    await fetch(`${API}/facturas?id=${id}`, { method: 'PATCH', headers: { 'X-API-Key': env.FACT_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ subcategoria: original || null }) });
    m.nota('No hay botón «deshacer»: el cambio se revirtió por la API.');
  }
  m.fin({ en_revisar: n });
});

test('T3/T5/T6 · trimestre: 303, 347 y libro registro solo vía Excel', async ({ page }) => {
  const m = medidor('T3_T5_T6_trimestre');
  await m.escribir(page.locator('#desde'), '2026-07-01'); m.teclas -= 0;
  await page.locator('#desde').fill('2026-07-01');
  await page.locator('#hasta').fill('2026-09-30'); m.teclas += 20;
  await m.click(page.getByRole('button', { name: 'Aplicar' }));
  await page.waitForTimeout(2000);
  m.pantalla();
  await page.locator('#c3').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'T3_resumen_trimestre.png') });
  const kpis = await page.locator('#kpis').innerText();
  const desgloseIva = await page.locator('text=/IVA soportado|21 %.*10 %|por tipo de IVA/i').count();
  m.nota(`¿La web muestra IVA soportado por tipo? ${desgloseIva ? 'sí' : 'no'} · KPIs: ${kpis.replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.locator('#c4').scrollIntoViewIfNeeded();
  const [descarga] = await Promise.all([page.waitForEvent('download'), m.click(page.locator('#btnExport'))]);
  await descarga.saveAs(path.join(OUT, 'T3_export_web.xlsx'));
  m.salir('Excel para sumar IVA por tipo (303), agrupar por NIF (347) y montar el libro registro');
  m.salir('Calculadora/hoja propia para retenciones (111/115): la web no las tiene');
  m.fin({ desglose_iva_en_web: !!desgloseIva });
});

test('T10 · vencimientos y pagos', async ({ page }) => {
  const m = medidor('T10_vencimientos');
  const filtros = await page.locator('#fEstado option').allInnerTexts();
  const hayFiltroPago = filtros.some(t => /pagad|pendiente/i.test(t));
  const hayFiltroVenc = await page.locator('select, input').filter({ hasText: /venc/i }).count();
  await page.locator('#c4').scrollIntoViewIfNeeded(); m.pantalla();
  const recs = await page.locator('#recs').innerText();
  await page.screenshot({ path: path.join(OUT, 'T10_vencimientos.png') });
  m.nota(`Filtro por estado de pago: ${hayFiltroPago ? 'sí' : 'no'} · filtro por vencimiento: ${hayFiltroVenc ? 'sí' : 'no'}`);
  m.nota('Vencimientos solo aparecen como recomendación del asesor (próximos 15 días): ' + (/venc/i.test(recs) ? 'sí aparece' : 'no aparece'));
  m.salir('Extracto del banco: no hay importación ni marcado de pagos');
  m.fin({ filtro_pago: hayFiltroPago });
});

test('Capacidades de trabajo en volumen: lote, orden, atajos, deshacer, cliente', async ({ page }) => {
  const m = medidor('volumen_y_productividad');
  const checks = await page.locator('#list input[type=checkbox]').count();
  const ordenables = await page.locator('[aria-sort], th button, [data-sort]').count();
  const selectorCliente = await page.locator('select, input').filter({ hasText: /cliente|empresa/i }).count()
    + await page.locator('[id*=cliente], [name*=cliente]').count();
  const editarEnLinea = await page.locator('#list [contenteditable], #list .row-head input').count();
  m.nota(`Casillas para acciones en lote: ${checks} · controles de orden: ${ordenables} · selector de cliente/empresa: ${selectorCliente} · edición en línea en la fila: ${editarEnLinea}`);
  await page.locator('#c2').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'volumen_lista.png') });
  m.fin({ acciones_en_lote: checks > 0, ordenar: ordenables > 0, multicliente: selectorCliente > 0 });
});

test('Rendimiento de la web con 500+ facturas', async ({ page }) => {
  const m = medidor('rendimiento_web');
  const t0 = Date.now();
  await page.reload();
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#kpis .kpi').first()).toBeVisible({ timeout: 30000 });
  const carga = Date.now() - t0;
  // con paginación numerada: elegir 200 por página y recorrer las páginas
  let pulsaciones = 0;
  const t1 = Date.now();
  await page.locator('#fPorPagina').selectOption('200'); m.clics += 2;
  await page.waitForResponse(r => r.url().includes('/facturas?'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  let vistas = await page.locator('#list .row').count();
  while (await page.locator('#pager [aria-label="Página siguiente"]:not([disabled])').count() && pulsaciones < 40) {
    await m.click(page.locator('#pager [aria-label="Página siguiente"]')); pulsaciones++;
    await page.waitForResponse(r => r.url().includes('/facturas?'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    vistas += await page.locator('#list .row').count();
  }
  const todas = Date.now() - t1;
  const filas = vistas;
  const tHover = Date.now();
  await page.locator('#list .row').last().locator('.row-head').hover();
  await expect(page.locator('#list .row').last()).toHaveClass(/open/);
  const hover = Date.now() - tHover;
  await page.screenshot({ path: path.join(OUT, 'rendimiento_lista_completa.png') });
  m.nota(`Carga inicial (lista + KPIs): ${carga} ms · páginas recorridas (200 por página): ${pulsaciones} veces para ver ${filas} filas en ${todas} ms · hover en la última fila: ${hover} ms`);
  m.fin({ carga_ms: carga, pulsaciones_cargar_mas: pulsaciones, filas, ver_todas_ms: todas, hover_ultima_ms: hover });
});

test('Accesibilidad (axe-core) y mensajes de error', async ({ page }) => {
  const m = medidor('accesibilidad_y_errores');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const resumen = r.violations.map(v => ({ id: v.id, impacto: v.impact, nodos: v.nodes.length, ayuda: v.help }));
  fs.writeFileSync(path.join(OUT, 'axe.json'), JSON.stringify(resumen, null, 2));
  m.nota(`Violaciones axe WCAG 2.1 AA: ${resumen.length} (${resumen.map(v => v.id + '×' + v.nodos).join(', ') || 'ninguna'})`);
  // error: corregir con un total no numérico
  const fila = page.locator('#list .row').filter({ hasText: 'TEST·' }).first();
  const id = await fila.getAttribute('data-id');
  const antes = await (await fetch(`${API}/facturas?desde=2000-01-01&hasta=2100-12-31&por_pagina=200`, { headers: { 'X-API-Key': env.FACT_API_KEY } })).json();
  const original = antes.items.find(x => String(x.id) === id);
  await fila.locator('.row-head').click();
  await fila.getByRole('button', { name: 'Corregir' }).click();
  await fila.locator('input[name="total"]').fill('abc');
  await fila.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.waitForTimeout(3000);
  const sigueAbierto = await fila.locator('form[data-edit]').count();
  const msg = sigueAbierto ? await fila.locator('.form-msg').innerText() : '(el formulario se cerró: se guardó)';
  const tras = (await (await fetch(`${API}/facturas?desde=2000-01-01&hasta=2100-12-31&por_pagina=200`, { headers: { 'X-API-Key': env.FACT_API_KEY } })).json()).items.find(x => String(x.id) === id);
  m.nota(`Total «abc» → mensaje: ${msg} · total guardado: ${tras.total} (antes ${original.total}) · estado: ${tras.estado}`);
  await page.screenshot({ path: path.join(OUT, 'error_total_invalido.png') });
  if (sigueAbierto) await fila.getByRole('button', { name: 'Cancelar' }).click();
  if (tras.total !== original.total) {   // deshacer en la fila TEST
    await fetch(`${API}/facturas?id=${id}`, { method: 'PATCH', headers: { 'X-API-Key': env.FACT_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ total: original.total }) });
    m.nota('BUG: «abc» se convierte en 0 y se guarda; fila TEST restaurada por la API.');
  }
  m.fin({ violaciones_axe: resumen.length });
});
