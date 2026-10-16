// Demo: el selector de categoría ofrece Agua, Luz, Gas y Telefonía e internet (no el antiguo Suministros) y el
// reparto por categoría las muestra por separado. Sin n8n ni Gemini. axe 0 en la vista.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('path');
const URL = "file:///" + path.resolve(__dirname, "../../web/index.html").split(path.sep).join("/");

test('demo: categorías de suministros por separado', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('facturas.demo', 'true'));
  await page.goto(URL);
  await page.waitForSelector('.row:not(.row-head)', { timeout: 15000 });
  // selector de categoría de la web (filtros y edición): alguna <select> con las 4 opciones
  const opciones = await page.evaluate(() => [...document.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.textContent.trim())));
  const conCats = opciones.filter((o) => o.includes('Agua') && o.includes('Luz') && o.includes('Gas') && o.includes('Telefonía e internet'));
  expect(conCats.length).toBeGreaterThan(0);
  expect(conCats.every((o) => !o.some((t) => t.startsWith('Suministros')))).toBe(true);
  // reparto por categoría (donut + barras)
  const txt = await page.locator('#c3').innerText();
  expect(txt).toContain('Luz'); // la demo abre con la Taberna (solo Luz); Agua, Gas y Telefonía salen en Personal y en la Gestoría
  expect(txt).not.toContain('Suministros');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});
