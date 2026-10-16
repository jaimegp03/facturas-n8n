// Mecánica del hover y del scroll en la lista de facturas (demo, sin n8n). Proyecto: npx playwright test --project=scroll
// Propiedades que se vigilan (ver CLAUDE.md, «Web»): no se abre/cierra nada por hover mientras se hace scroll, la fila abierta es la que está
// bajo el puntero, el scroll no se compensa a la fuerza ni da saltos, la fila fijada resiste al hover y Esc la suelta.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { una } = require('./medir_scroll.js');
const URL_WEB = 'file:///' + path.join(__dirname, '..', '..', 'web', 'index.html').split(String.fromCharCode(92)).join('/');

for (const [w, h] of [[1440, 900], [1366, 768]]) {
  test(`scroll y puntería a ${w}x${h}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const m = await una(browser, w, h);
    expect(m.filas).toBe(50);
    expect(m.filasCompletas).toBeGreaterThanOrEqual(8);
    for (const fase of [m.rueda, m.ruedaConTemblor]) {
      expect(fase.filasAbiertasCerradas, 'filas abiertas/cerradas por hover durante la rueda').toBe(0);
      expect(fase.scrollProgramatico, 'scroll programático durante la rueda').toBe(0);
      expect(fase.longTaskMax).toBeLessThan(50);
      expect(fase.layoutShift).toBeLessThan(0.05);
      expect(fase.fps).toBeGreaterThan(40);
    }
    expect(m.punteria.aciertos, JSON.stringify(m.punteria.fallos)).toBe(30);
    expect(m.punteriaArriba.aciertos, JSON.stringify(m.punteriaArriba.fallos)).toBe(30);
  });
}

test.describe('fila fijada y teclado', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('facturas.demo', 'true'));
    await page.goto(URL_WEB);
    await expect(page.locator('#list .row').first()).toBeVisible();
  });
  const abierta = page => page.locator('#list .row.open').evaluateAll(rs => rs.map(r => r.dataset.id));
  test('clic fija, el hover no la cierra, Esc la suelta', async ({ page }) => {
    const fila = n => page.locator('#list .row').nth(n);
    await fila(2).locator('.row-head').hover();
    await expect.poll(() => abierta(page)).toEqual([await fila(2).getAttribute('data-id')]);
    await fila(2).locator('.row-head').click();
    await expect(fila(2)).toHaveClass(/fijada/);
    await expect(page.locator('#preview')).toContainText('Fijada');
    await fila(5).locator('.row-head').hover();
    await page.waitForTimeout(500);
    expect(await abierta(page)).toEqual([await fila(2).getAttribute('data-id')]);
    await page.keyboard.press('Escape');
    await expect(fila(2)).not.toHaveClass(/fijada/);
    await fila(6).locator('.row-head').hover({ position: { x: 30, y: 10 } });
    await expect.poll(() => abierta(page)).toEqual([await fila(6).getAttribute('data-id')]);
    // otro clic fija la nueva y un segundo clic en la misma la suelta
    await fila(6).locator('.row-head').click(); await expect(fila(6)).toHaveClass(/fijada/);
    await fila(6).locator('.row-head').click(); await expect(fila(6)).not.toHaveClass(/fijada/);
  });
  test('teclado: j/k mueven la fila abierta, x selecciona, e edita', async ({ page }) => {
    await page.locator('#list .row-head').first().focus();
    await page.keyboard.press('j');
    await expect(page.locator('#list .row.open')).toHaveCount(1);
    const id = await page.locator('#list .row.open').getAttribute('data-id');
    await page.keyboard.press('x');
    await expect(page.locator(`#list .row[data-id="${id}"]`)).toHaveClass(/sel/);
    await page.keyboard.press('e');
    await expect(page.locator(`#list .row[data-id="${id}"] input[name="proveedor"]`)).toBeFocused();
  });
});

test.describe('táctil (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('un toque abre la fila y otro la pliega, sin fijarla ni scroll horizontal', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('facturas.demo', 'true'));
    await page.goto(URL_WEB);
    const fila = page.locator('#list .row').nth(1);
    await expect(fila).toBeVisible();
    await fila.locator('.row-head').tap();
    await expect(fila).toHaveClass(/open/);
    await expect(fila).not.toHaveClass(/fijada/);
    await fila.locator('.row-head').tap();
    await expect(fila).not.toHaveClass(/open/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
