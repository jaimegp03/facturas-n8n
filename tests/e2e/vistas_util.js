// Ayuda común de las pruebas: ir a una sección de la vista «Mi dinero» por hash (#/mi-dinero/<sección>).
const { expect } = require('@playwright/test');
async function irMD(page, sec) {
  await page.evaluate(s => { location.hash = '#/mi-dinero/' + s; }, sec);
  await expect(page.locator('#md-' + sec)).toBeVisible();
}
module.exports = { irMD };
// Pruebas funcionales antiguas (capítulo 05 de una sola página): muestra TODAS las secciones de Mi dinero a la vez.
// Así comprueban la lógica sin depender de en qué sección está cada panel; la navegación por secciones se prueba en vistas.spec.js.
async function verTodoMD(page) {
  await page.evaluate(() => { location.hash = '#/mi-dinero/resumen'; });
  await expect(page.locator('#md-resumen')).toBeVisible();
  await page.addStyleTag({ content: '.mdsec[hidden]{display:block!important}#mdBar[hidden]{display:flex!important}' });
}
module.exports = { irMD, verTodoMD };
