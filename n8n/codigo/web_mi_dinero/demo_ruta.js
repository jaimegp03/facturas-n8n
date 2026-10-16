/* demo Mi dinero */
if (ruta === '/metas' || ruta === '/metas/aportar' || ruta === '/resumen-mensual') return demoMetas(D, ruta, met, q, body, fallo);
if (ruta.startsWith('/deudas')) return demoDeudas(D, ruta, met, q, body, fallo);
if (ruta === '/renta') return demoRenta(D, q, fallo);
if (['/ingresos', '/presupuestos', '/mi-dinero', '/nomina/simular'].includes(ruta)) return demoMiDinero(D, ruta, met, q, body, fallo);
/* fin demo Mi dinero */
