// Recorrido «dueño de un restaurante»: revisar las facturas del fin de semana (10-11/10/2026) usando la web como una persona.
// Crea el cliente y sube las facturas TEST_R* con Gemini real (máx. 10 ingestas). Los datos TEST se borran aparte.
// Uso: npx playwright test --project=restaurante
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).filter(l => l.includes('='))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const H = { 'X-API-Key': env.FACT_API_KEY };
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const DIR = path.join(RAIZ, 'tests', 'facturas-restaurante');
const OUT = path.join(RAIZ, 'tests', 'salida', 'restaurante');
fs.mkdirSync(OUT, { recursive: true });
const ESP = JSON.parse(fs.readFileSync(path.join(DIR, 'esperado_restaurante.json'), 'utf8'));
const informe = { pasos: [], hallazgos: [], tiempos: {} };
const nota = (t) => informe.hallazgos.push(t);
const fmt = n => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
let cid = null;

test.use({ viewport: { width: 1366, height: 768 }, channel: 'chrome' });
test.setTimeout(600000);

async function paso(page, nombre, fn) {
  const t0 = Date.now();
  try { await fn(); informe.pasos.push({ nombre, ok: true, s: +((Date.now() - t0) / 1000).toFixed(1) }); }
  catch (e) {
    informe.pasos.push({ nombre, ok: false, s: +((Date.now() - t0) / 1000).toFixed(1), error: String(e.message).split('\n')[0].slice(0, 220) });
    await page.screenshot({ path: path.join(OUT, `FALLO-${nombre.replace(/\W+/g, '_').slice(0, 40)}.png`) }).catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(informe, null, 2));
}
const getJSON = async r => (await fetch(API + r, { headers: H })).json();

test('el dueño revisa las facturas del fin de semana', async ({ page }) => {
  const consola = [];
  page.on('console', m => { if (m.type() === 'error') consola.push(m.text()); });
  page.on('pageerror', e => consola.push('JS: ' + e.message));
  await page.addInitScript(([base, token]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-10-09'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-15'));
  }, [API, env.FACT_API_KEY]);
  await page.goto(URL_WEB);
  await expect(page.locator('#connTxt')).toHaveText('Conectado', { timeout: 20000 });

  // 1. Alta del cliente (el restaurante)
  await paso(page, '01 Dar de alta el restaurante como cliente', async () => {
    await page.locator('#btnNuevoCliente').click();
    await page.locator('#cliNombre').fill(ESP.cliente.nombre);
    await page.locator('#cliNif').fill(ESP.cliente.nif);
    await page.locator('#cliRegimen').selectOption('general');
    await page.screenshot({ path: path.join(OUT, '01_alta_cliente.png') });
    await page.locator('#cliForm button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('Cliente creado', { timeout: 15000 });
    cid = await page.locator('#selCliente').inputValue();
    expect(cid).not.toBe('');
  });

  // 2. Subir el lote de facturas
  const archivos = fs.readdirSync(DIR).filter(f => /^TEST_R/.test(f)).map(f => path.join(DIR, f));
  await paso(page, `02 Subir ${archivos.length} facturas de golpe`, async () => {
    const t0 = Date.now();
    await page.locator('#c1').scrollIntoViewIfNeeded();
    await page.locator('#fileInput').setInputFiles(archivos);
    await expect(page.locator('#queue .qi')).toHaveCount(archivos.length);
    await page.waitForFunction(n => document.querySelectorAll('#queue .qi.fin').length >= n, archivos.length, { timeout: 480000 });
    informe.tiempos.subida_lote_s = +((Date.now() - t0) / 1000).toFixed(1);
    await page.screenshot({ path: path.join(OUT, '02_cola_subida.png'), fullPage: false });
    const filas = await page.locator('#queue .qi').evaluateAll(ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    informe.cola = filas;
  });

  // 3. ¿Qué hay guardado? (comparación con lo esperado)
  let guardadas = [];
  await paso(page, '03 Comprobar lo guardado contra las facturas originales', async () => {
    guardadas = (await getJSON(`/facturas?cliente_id=${cid}&desde=2000-01-01&hasta=2100-12-31&por_pagina=200`)).items;
    informe.guardadas = guardadas.map(f => ({ archivo: f.archivo_nombre, proveedor: f.proveedor, numero: f.numero, fecha: f.fecha_emision, vence: f.fecha_vencimiento,
      base: f.base, iva: f.iva_cuota, total: f.total, a_pagar: f.total_a_pagar, estado: f.estado, deducible: f.deducible, operacion: f.operacion,
      tipo_factura: f.tipo_factura, categoria: f.categoria, cuenta: f.cuenta_gasto, pago: f.estado_pago, errores: f.errores_validacion, nif_valido: f.nif_valido,
      desglose: f.desglose_iva_json }));
    const faltan = ESP.facturas.filter(e => e.total_factura !== undefined && !guardadas.some(g => g.archivo_nombre === e.archivo));
    informe.no_guardadas = faltan.map(f => f.archivo);
    const dif = [];
    for (const e of ESP.facturas.filter(x => x.total_factura !== undefined)) {
      const g = guardadas.find(x => x.archivo_nombre === e.archivo); if (!g) continue;
      const malo = [];
      if ((g.numero || '') !== e.numero) malo.push(`nº ${g.numero} ≠ ${e.numero}`);
      if (g.fecha_emision !== e.fecha) malo.push(`fecha ${g.fecha_emision} ≠ ${e.fecha}`);
      if (Math.abs((g.total ?? 0) - e.total_factura) > 0.02) malo.push(`total ${g.total} ≠ ${e.total_factura}`);
      if (Math.abs((g.iva_cuota ?? 0) - e.cuota_iva_total) > 0.02) malo.push(`IVA ${g.iva_cuota} ≠ ${e.cuota_iva_total}`);
      if (Math.abs((g.base ?? 0) - e.base_total) > 0.02) malo.push(`base ${g.base} ≠ ${e.base_total}`);
      if (malo.length) dif.push({ archivo: e.archivo, estado: g.estado, diferencias: malo });
    }
    informe.diferencias_extraccion = dif;
  });

  // 4. Revisar las que quedan «por revisar»
  await paso(page, '04 Ver las facturas que piden revisión', async () => {
    await page.reload();
    await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20000 });
    await page.locator('#c2').scrollIntoViewIfNeeded();
    const aviso = await page.locator('#revisarNote').isVisible();
    informe.aviso_revisar_visible = aviso;
    await page.screenshot({ path: path.join(OUT, '04_lista_cliente.png') });
    if (aviso) { await page.locator('#btnVerRevisar').click(); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(OUT, '04_solo_revisar.png') }); }
    informe.filas_revisar = await page.locator('#list .row').count();
    await page.locator('#fEstado').selectOption('');
  });

  // 5. Buscar y filtrar como lo haría en el día a día
  await paso(page, '05 Buscar por proveedor, importe y nº de factura', async () => {
    const buscar = async (txt) => { await page.locator('#fBuscar').fill(txt); await page.waitForTimeout(1300); return page.locator('#list .row').count(); };
    informe.busquedas = { pescado: await buscar('pescados'), importe_pescado: await buscar(fmt(470.14)), numero_bebidas: await buscar('DB-26-091522'), nif_gas: await buscar(ESP.facturas.find(f => /gas/.test(f.archivo)).nif), sin_resultados: await buscar('zzzz') };
    await page.locator('#fBuscar').fill(''); await page.waitForTimeout(1300);
  });
  await paso(page, '06 Filtrar pendientes de pago y vencimientos', async () => {
    await page.locator('#fPago').selectOption('pendiente'); await page.waitForTimeout(1300);
    informe.pendientes = await page.locator('#list .row').count();
    await page.screenshot({ path: path.join(OUT, '06_pendientes.png') });
    await page.locator('#fPago').selectOption(''); await page.waitForTimeout(1000);
    await page.locator('#fDed').selectOption('no'); await page.waitForTimeout(1300);
    informe.no_deducibles = await page.locator('#list .row').evaluateAll(rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 140)));
    await page.locator('#fDed').selectOption('');
  });

  // 6. Abrir el detalle de una factura con desglose y de la rectificativa
  await paso(page, '07 Abrir el detalle de la factura de bebidas (varios IVA)', async () => {
    await page.locator('#fBuscar').fill('DB-26-091522'); await page.waitForTimeout(1300);
    const fila = page.locator('#list .row').first();
    await fila.locator('.row-head').click();
    await page.waitForTimeout(500);
    informe.detalle_bebidas = (await fila.innerText()).replace(/\s+/g, ' ').slice(0, 700);
    await page.screenshot({ path: path.join(OUT, '07_detalle_bebidas.png') });
    await page.locator('#fBuscar').fill('');
  });

  // 7. Cierre del periodo: IVA del trimestre
  await paso(page, '08 Calcular el IVA del 4.º trimestre', async () => {
    await page.locator('#fAnio').fill('2026'); await page.locator('#fTrim').selectOption('4');
    await page.locator('#c4').scrollIntoViewIfNeeded();
    await page.locator('#btnFiscal').click();
    await expect(page.locator('#fiscalOut table').first()).toBeVisible({ timeout: 25000 });
    informe.fiscal_texto = (await page.locator('#fiscalOut').innerText()).replace(/\s+/g, ' ').slice(0, 1500);
    await page.locator('#trimestre').screenshot({ path: path.join(OUT, '08_trimestre.png') });
  });
  await paso(page, '09 Descargar libro registro, asientos y Excel', async () => {
    const baja = async (sel, nombre) => {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator(sel).click()]);
      const ruta = path.join(OUT, nombre + '-' + d.suggestedFilename()); await d.saveAs(ruta); return ruta;
    };
    informe.descargas = {
      libro: await baja('[data-descarga="libro"]', 'libro'),
      asientos: await baja('[data-descarga="csv"]', 'asientos'),
      excel: await baja('#btnExport', 'excel'),
    };
  });

  // 8. Banco: importar un extracto y conciliar
  await paso(page, '10 Importar el extracto del banco y conciliar un pago', async () => {
    const pesc = ESP.facturas.find(f => /pescado/.test(f.archivo)), carne = ESP.facturas.find(f => /carne/.test(f.archivo));
    const csv = ['Fecha;Concepto;Importe',
      `12/10/2026;TRANSFERENCIA PESCADOS MAR DE LEVANTE FRA ${pesc.numero};-${pesc.total_factura.toFixed(2).replace('.', ',')}`,
      `13/10/2026;TRANSF CARNES SELECTAS ${carne.numero};-${carne.total_factura.toFixed(2).replace('.', ',')}`,
      '13/10/2026;COMISION MANTENIMIENTO CUENTA;-12,50'].join('\n');
    const f = path.join(OUT, 'extracto_restaurante_TEST.csv'); fs.writeFileSync(f, csv, 'utf8');
    await page.locator('#bancoArchivo').setInputFiles(f);
    await expect(page.locator('#msgBanco')).toContainText('importado', { timeout: 20000 });
    informe.banco_mensaje = await page.locator('#msgBanco').innerText();
    await page.waitForTimeout(1200);
    await page.locator('#banco').screenshot({ path: path.join(OUT, '10_banco.png') });
    const botones = await page.locator('#bancoOut [data-conciliar]').count();
    informe.banco_sugerencias = botones;
    if (botones) { await page.locator('#bancoOut [data-conciliar]').first().click(); await expect(page.locator('#toast')).toContainText('Conciliado', { timeout: 15000 }); }
  });

  // 9. Corregir una factura mal leída (si la hay): la de menor confianza / en revisar
  await paso(page, '11 Corregir una factura desde la lista', async () => {
    await page.locator('#c2').scrollIntoViewIfNeeded();
    await page.locator('#fEstado').selectOption('revisar'); await page.waitForTimeout(1500);
    const n = await page.locator('#list .row').count();
    informe.revisar_para_corregir = n;
    if (!n) return;
    const fila = page.locator('#list .row').first();
    await fila.locator('.row-head').click();
    informe.motivo_revisar_primera = (await fila.locator('.why.warn').innerText().catch(() => '(sin motivo visible)')).slice(0, 300);
    await fila.getByRole('button', { name: /Corregir/ }).click();
    await page.screenshot({ path: path.join(OUT, '11_formulario_correccion.png') });
  });

  informe.errores_consola = consola;
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(informe, null, 2));
});
