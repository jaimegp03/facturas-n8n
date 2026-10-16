// Capítulo 05 «Mi dinero» de web/index.html (ingresos, presupuestos, alertas, simulador de nómina). Proyecto: npx playwright test --project=mi_dinero
// Prueba en vivo contra n8n (cliente «Personal»: crea ingresos TEST· y un presupuesto y los deja como estaban), en modo demo (sin ninguna petición a n8n)
// y la paridad de la copia JS «COMÚN Mi dinero» de la web con GET /mi-dinero y POST /nomina/simular con los mismos datos.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { irMD, verTodoMD } = require('./vistas_util');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_WEB = 'file:///' + path.join(RAIZ, 'web', 'index.html').replace(/\\/g, '/');
const BASE = (env.N8N_BASE_URL || 'http://localhost:5678') + '/webhook';
const CASOS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'tests', 'casos_mi_dinero.json'), 'utf8'));

async function n8n(metodo, ruta, cuerpo) {
  const r = await fetch(BASE + ruta, { method: metodo, headers: { 'X-API-Key': env.FACT_API_KEY, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const mesMas = (m, k) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

let errores, peticionesN8n;
async function abrirWeb(page, demo) {
  errores = []; peticionesN8n = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errores.push(m.text()); });
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (r.url().startsWith(BASE)) peticionesN8n.push(r.method() + ' ' + r.url()); });
  await page.addInitScript(([base, token, demo]) => {
    if (window.top !== window || location.protocol !== 'file:') return;
    localStorage.setItem('facturas.base', JSON.stringify(base));
    localStorage.setItem('facturas.token', JSON.stringify(token));
    localStorage.setItem('facturas.desde', JSON.stringify('2026-01-01'));
    localStorage.setItem('facturas.hasta', JSON.stringify('2026-10-14'));
    if (demo) localStorage.setItem('facturas.demo', 'true'); else localStorage.removeItem('facturas.demo');
  }, [BASE, env.FACT_API_KEY, !!demo]);
  await page.goto(URL_WEB);
  await expect(page.locator('#list .row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#mdKpis .md-kpi')).toHaveCount(4, { timeout: 20_000 });
}
test.afterEach(() => { expect(errores.filter(t => !/status of (400|422)/.test(t)), 'errores en consola').toEqual([]); });
const sinScrollH = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const axe = async page => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(' | '));

test('en vivo: añadir, editar y borrar ingreso, editar presupuesto y ver alertas', async ({ page }) => {
  test.setTimeout(150_000);
  const cli = (await n8n('GET', '/clientes')).json.items.find(c => c.regimen_iva === 'particular') || (await n8n('GET', '/clientes')).json.items[0];
  const presOrig = (await n8n('GET', '/presupuestos?cliente_id=' + cli.id)).json.items.map(p => ({ categoria: p.categoria, limite_mensual: p.limite_mensual }));
  const ingOrig = new Set((await n8n('GET', '/ingresos?cliente_id=' + cli.id)).json.items.map(i => i.id));
  const mes = hoyMadrid().slice(0, 7);
  const base = (await n8n('GET', `/mi-dinero?cliente_id=${cli.id}&mes=${mes}`)).json;
  try {
    await abrirWeb(page, false);
    await verTodoMD(page);
    await expect(page.locator('#mdCliente')).toContainText(cli.nombre);
    if (!ingOrig.size) await expect(page.locator('#mdVacio')).toContainText('Añade tu sueldo para empezar');
    // añadir ingreso
    await page.locator('#mdAddIngreso').click();
    await expect(page.locator('#dlgIngreso')).toBeVisible();
    await page.locator('#ingConcepto').fill('TEST·Sueldo web');
    await page.locator('#ingImporte').fill('1500');
    await page.locator('#ingIni').fill(mesMas(mes, -1) + '-01');
    await page.locator('#ingGuardar').click();
    await expect(page.locator('#dlgIngreso')).toBeHidden();
    const fila = page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' });
    await expect(fila).toBeVisible();
    const esperadoIng = Math.round((base.ingresos.total + 1500) * 100) / 100;
    await expect(page.locator('#mdKpis .md-kpi').first()).toContainText(esperadoIng.toLocaleString('es-ES', { minimumFractionDigits: 2, useGrouping: true }));
    await expect(page.locator('#mdVacio')).toBeHidden();
    // validación del servidor visible (importe 0)
    await fila.getByRole('button', { name: /Editar/ }).click();
    await page.locator('#ingImporte').fill('0');
    await page.locator('#ingGuardar').click();
    await expect(page.locator('#ingMsg')).toContainText(/importe/i);
    await page.locator('#ingImporte').fill('1600');
    await page.locator('#ingGuardar').click();
    await expect(page.locator('#dlgIngreso')).toBeHidden();
    await expect(page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' })).toContainText('1.600,00');
    // presupuesto: límite de 1 € en la categoría con más gasto => superado y alerta
    const cat = base.gasto.por_categoria.length ? base.gasto.por_categoria[0].categoria : 'Hogar';
    if (base.presupuesto.items.some(i => i.categoria === cat)) await page.locator(`#mdPres tr:has-text("${cat}") [data-md="quitar"]`).click();
    await page.locator('#mdPresCat').selectOption(cat);
    await page.locator('#mdPresLim').fill('1');
    await page.locator('#mdPresAdd').click();
    await expect(page.locator('#mdPres tr', { hasText: cat })).toContainText('Sin guardar');
    await page.locator('#mdPresGuardar').click();
    if (base.gasto.por_categoria.length) {
      await expect(page.locator('#mdPres tr', { hasText: cat })).toContainText('Superado');
      await expect(page.locator('#mdAlertas')).toContainText('Has superado el presupuesto de ' + cat);
      await expect(page.locator('#mdPres tr', { hasText: cat }).locator('[role=progressbar]')).toHaveAttribute('aria-valuenow', '100');
    } else {
      await expect(page.locator('#mdPres tr', { hasText: cat })).toContainText('En orden');
    }
    await expect(page.locator('#md532 .fila')).toHaveCount(3);
    await expect(page.locator('#mdPrev')).toContainText(base.es_mes_actual ? 'Gasto previsto a fin de mes' : 'solo está disponible');
    await sinScrollH(page);
    expect(await axe(page)).toEqual([]);
    // mes pasado: sin previsión
    await page.locator('#mdMesAnt').click();
    await expect(page.locator('#mdMes')).toHaveValue(mesMas(mes, -1));
    await expect(page.locator('#mdPrev')).toContainText('solo está disponible para el mes en curso');
    // borrar con confirmación en dos pasos
    await page.locator('#mdMesSig').click();
    const f2 = page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' });
    await f2.getByRole('button', { name: /Borrar/ }).click();
    await expect(page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' }).getByRole('button', { name: /Borrar/ })).toContainText('¿Seguro?');
    await page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' }).getByRole('button', { name: /Borrar/ }).click();
    await expect(page.locator('#mdIngresos tr', { hasText: 'TEST·Sueldo web' })).toHaveCount(0);
  } finally {
    for (const i of (await n8n('GET', '/ingresos?cliente_id=' + cli.id)).json.items) if (!ingOrig.has(i.id)) await n8n('DELETE', '/ingresos?id=' + i.id);
    await n8n('PUT', '/presupuestos', { cliente_id: cli.id, presupuestos: presOrig });
  }
});

test('simulador de nómina: diálogo accesible, cálculo en n8n, axe 0, Esc devuelve el foco', async ({ page }) => {
  await abrirWeb(page, false);
  await irMD(page, 'herramientas');
  const boton = page.locator('#btnNomina');
  await boton.focus(); await boton.press('Enter');
  await expect(page.locator('#dlgNomina')).toBeVisible();
  await page.locator('#nomBruto').fill('30000'); await page.locator('#nomPagas').selectOption('14'); await page.locator('#nomIrpf').fill('15');
  await page.locator('#nomCalcular').click();
  await expect(page.locator('#nomRes table.fin-tbl')).toBeVisible();
  await expect(page.locator('#nomRes')).toContainText('1.682,14');
  await expect(page.locator('#nomRes')).toContainText('Estimación: el IRPF real depende de tu situación');
  expect(await axe(page)).toEqual([]);
  await page.locator('#nomBruto').fill('-3'); await page.locator('#nomCalcular').click();
  await expect(page.locator('#nomMsg')).toContainText(/bruto anual/i);
  await page.keyboard.press('Escape');
  await expect(page.locator('#dlgNomina')).toBeHidden();
  await expect(boton).toBeFocused();
});

test('390 px: la sección Mi dinero no desborda ni en la página ni en los diálogos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirWeb(page, false);
  await verTodoMD(page);
  await sinScrollH(page);
  await page.locator('#mdAddIngreso').click();
  expect(await page.locator('#dlgIngreso').evaluate(d => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await irMD(page, 'herramientas');
  await page.locator('#btnNomina').click();
  expect(await page.locator('#dlgNomina').evaluate(d => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await sinScrollH(page);
});

test('demo: datos ficticios, edición completa y ninguna petición a n8n', async ({ page }) => {
  await abrirWeb(page, true);
  await verTodoMD(page);
  await expect(page.locator('#mdIngresos tbody tr')).toHaveCount(3);
  await expect(page.locator('#mdPres tbody tr')).toHaveCount(9);
  await expect(page.locator('#mdKpis .md-kpi').first()).toContainText('€');
  await expect(page.locator('#mdAlertas li').first()).toBeVisible();
  await expect(page.locator('#md532 .fila')).toHaveCount(3);
  await expect(page.locator('#mdPrev')).toContainText('Gasto previsto a fin de mes');
  // añadir ingreso
  await page.locator('#mdAddIngreso').click();
  await page.locator('#ingConcepto').fill('Clases particulares'); await page.locator('#ingImporte').fill('250'); await page.locator('#ingPer').selectOption('mensual');
  await page.locator('#ingGuardar').click();
  await expect(page.locator('#mdIngresos tbody tr')).toHaveCount(4);
  // editar presupuesto: límite 1 € en Mercaderías => superado o en orden y alerta
  const fila = page.locator('#mdPres tr', { hasText: 'Mercaderías' });
  await fila.locator('input').fill('1');
  await page.locator('#mdPresGuardar').click();
  await expect(page.locator('#mdPres tr', { hasText: 'Mercaderías' })).toContainText(/Superado|En orden/);
  const d = await page.evaluate(() => window.__miDinero && true);
  expect(d).toBe(true);
  // simulador en demo
  await irMD(page, 'herramientas');
  await page.locator('#btnNomina').click();
  await page.locator('#nomBruto').fill('30000'); await page.locator('#nomIrpf').fill('15'); await page.locator('#nomCalcular').click();
  await expect(page.locator('#nomRes')).toContainText('1.682,14');
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await sinScrollH(page);
  expect(peticionesN8n, 'peticiones a n8n en modo demo').toEqual([]);
});

test('paridad: la copia JS de la web calcula igual que n8n (mi-dinero y nómina)', async ({ page }) => {
  test.setTimeout(150_000);
  await abrirWeb(page, false);
  const clientes = (await n8n('GET', '/clientes')).json.items;
  const cli = clientes.find(c => c.regimen_iva === 'particular') || clientes[0];
  const presOrig = (await n8n('GET', '/presupuestos?cliente_id=' + cli.id)).json.items.map(p => ({ categoria: p.categoria, limite_mensual: p.limite_mensual }));
  const ingOrig = new Set((await n8n('GET', '/ingresos?cliente_id=' + cli.id)).json.items.map(i => i.id));
  const hoy = hoyMadrid(), mes = hoy.slice(0, 7);
  try {
    for (const x of [
      { tipo: 'nomina', concepto: 'TEST·Paridad nómina', importe: 2000.55, periodicidad: 'mensual', fecha_inicio: mesMas(mes, -6) + '-01', dia_cobro: 28 },
      { tipo: 'extra', concepto: 'TEST·Paridad anual', importe: 1234.57, periodicidad: 'anual', fecha_inicio: mesMas(mes, -2) + '-15' },
      { tipo: 'otros', concepto: 'TEST·Paridad puntual', importe: 99.99, periodicidad: 'puntual', fecha_inicio: mes + '-02' },
    ]) expect((await n8n('POST', '/ingresos', { cliente_id: cli.id, ...x })).status).toBe(201);
    const cats = (await n8n('GET', '/categorias')).json.items;
    expect((await n8n('PUT', '/presupuestos', { cliente_id: cli.id, presupuestos: cats.slice(0, 9).map((c, i) => ({ categoria: c.nombre, limite_mensual: 10 * (i + 1) + 0.5 })) })).status).toBe(200);
    const ingresos = (await n8n('GET', '/ingresos')).json.items;
    const presupuestos = (await n8n('GET', '/presupuestos?cliente_id=' + cli.id)).json.items.map(p => ({ ...p, cliente_id: cli.id }));
    const facturas = (await n8n('GET', '/facturas?cliente_id=' + cli.id + '&por_pagina=200')).json.items;
    const categorias = cats.map(c => ({ nombre: c.nombre, orden: c.orden, activa: true }));
    for (const m of [mes, mesMas(mes, -1), mesMas(mes, -4)]) {
      const remoto = (await n8n('GET', `/mi-dinero?cliente_id=${cli.id}&mes=${m}`)).json;
      const local = await page.evaluate(([e]) => JSON.parse(JSON.stringify(window.__miDinero.calcularMiDinero(e))), [{ cliente: cli, mes: m, hoy, ingresos, presupuestos, categorias, facturas }]);
      expect(local, 'mi-dinero ' + m).toEqual(remoto);
    }
    for (const cs of CASOS.nomina) {
      const remoto = (await n8n('POST', '/nomina/simular', cs)).json;
      const local = await page.evaluate(b => JSON.parse(JSON.stringify(window.__miDinero.simularNomina(b).body)), cs);
      expect(local, 'nómina ' + JSON.stringify(cs)).toEqual(remoto);
    }
  } finally {
    for (const i of (await n8n('GET', '/ingresos?cliente_id=' + cli.id)).json.items) if (!ingOrig.has(i.id)) await n8n('DELETE', '/ingresos?id=' + i.id);
    await n8n('PUT', '/presupuestos', { cliente_id: cli.id, presupuestos: presOrig });
  }
});
