// Revisión de web/index.html en escritorio y móvil con el Chrome instalado
// (channel "chrome": no descarga navegadores). Lee FACT_API_KEY de ../../.env.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../salida/e2e-resultados',
  use: { channel: 'chrome', headless: true, acceptDownloads: true, locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  projects: [
    { name: 'escritorio', testIgnore: /auditoria|gestoria|restaurante|autonomo|demo|v2|excel_web|finiquito|mi_dinero|metas|renta|deudas|tickets|vistas|suministros|scroll/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'movil', testIgnore: /auditoria|gestoria|restaurante|autonomo|demo|v2|excel_web|finiquito|mi_dinero|metas|renta|deudas|tickets|vistas|suministros|scroll/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    // Modo gestoría (crea y borra datos TEST con tests/fixture_gestoria.py): --project=gestoria
    { name: 'gestoria', testMatch: /gestoria\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Calculadora de finiquito (sin datos; compara la copia JS con n8n): --project=finiquito
    { name: 'finiquito', testMatch: /finiquito\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Mi dinero (ingresos, presupuestos, simulador de nómina; crea y borra datos TEST· de Personal): --project=mi_dinero
    { name: 'mi_dinero', testMatch: /mi_dinero\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Metas de ahorro y resumen mensual (fase 4a; crea y borra una meta TEST· de Personal): --project=metas
    { name: 'metas', testMatch: /metas\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Ayuda para la renta (fase 4b, solo lectura): --project=renta
    { name: 'renta', testMatch: /renta\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Deudas y préstamos (fase 4b, etapa 2; crea y borra una deuda TEST· de Personal): --project=deudas
    { name: 'deudas', testMatch: /deudas\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Tickets (fase 3, demo, sin n8n): --project=tickets (escritorio) y --project=tickets_movil (390)
    { name: 'tickets', testMatch: /tickets\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tickets_movil', testMatch: /tickets\.spec\.js/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    // Categorías de suministros (demo, sin n8n): --project=suministros
    { name: 'suministros', testMatch: /suministros\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Mecánica del hover y del scroll en la lista (demo, sin n8n): --project=scroll
    { name: 'scroll', testMatch: /scroll\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Modo demo (sin n8n; el último test apaga la demo y lee los datos reales): --project=demo
    { name: 'demo', testMatch: /demo\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Exportaciones .xlsx en el navegador (demo; guarda en tests/salida/excel_web y valida con openpyxl): --project=excel_web
    { name: 'excel_web', testMatch: /excel_web\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Medidas, axe y capturas del diseño v2 (demo apagada y encendida): --project=v2
    { name: 'v2', testMatch: /v2\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Vistas Facturas | Mi dinero por hash (demo, sin n8n): --project=vistas
    { name: 'vistas', testMatch: /vistas\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Regresión de la prueba «autónomo» (carreras en Mi dinero, doble envío, mensajes, descargas vacías): --project=autonomo
    { name: 'autonomo', testMatch: /autonomo\.spec\.js/, use: { viewport: { width: 1440, height: 900 } } },
    // Recorrido «dueño de un restaurante» con Gemini real (--project=restaurante)
    { name: 'restaurante', testMatch: /restaurante.spec.js/, use: { viewport: { width: 1366, height: 768 } } },
    // Auditoría contable a 1920×1080 (solo bajo demanda: --project=auditoria)
    { name: 'auditoria', testMatch: /auditoria_contable\.spec\.js/, use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
