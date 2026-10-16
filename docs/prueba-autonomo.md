# Prueba «autónomo» (15/10/2026)

Recorrido con la web real como un diseñador/reformista autónomo en régimen general (IRPF) con sus gastos personales aparte. Método copiado de
`docs/prueba-restaurante.md`, sin gastar Gemini (0 llamadas): datos reales de prueba con `tests/fixture_gestoria.py crear` (clientes TEST·Reformas García y
TEST·Panadería Lucía, 26 facturas, extractos N43/CSV) y, para lo personal, `tests/auditoria/autonomo_datos.py crear` (cliente particular `TEST·Autónomo personal` con
3 ingresos —dos facturas emitidas cobradas como «extra»/«otros» y una paga anual—, 2 presupuestos, 1 meta y 2 deudas: hipoteca y préstamo del coche). Chrome con
Playwright en 1440, 1366 y 390 (móvil táctil), por clics y teclado; sondas en `tests/e2e/sonda_a*.js` (no son tests). Copia previa de las tablas en
`tests/salida/backup-pre-autonomo-2026-10-15/`; todo se borró al terminar.

## Qué se recorrió
Facturas de la empresa (lista, filtros, búsqueda, edición con importes raros, lote), trimestre fiscal 3T y 4T (303/111/115/349/347), libro registro y asientos
(.xlsx, CSV, A3, Holded), Excel, banco con CSV (sugerencias), cliente nuevo (NIF inválido), periodo invertido y 31/12, cliente particular sin facturas, Mi dinero
(resumen, ingresos, presupuestos, metas, deudas con simulador, renta, finiquito y nómina), navegación por mes y por hash, recarga, Atrás, teclado, Esc y foco en
diálogos, axe, recortes y scroll horizontal en 3 tamaños, errores de consola y peticiones fallidas.

## Cuadre entre pantallas (todo coincide)
Total del periodo de la empresa 19.097,68 € y 24 facturas = `/resumen` = hoja Resumen del Excel (la suma de la columna Total de «Facturas» duplica porque incluye la fila
de totales); 303 del 3T: total deducible 2.904,65 € = suma de las filas de la pantalla = `/fiscal`; ingresos del mes de Mi dinero 2.523,38 € = `/mi-dinero`; deudas:
capital pendiente, cuotas y 37,8 % de carga = `/deudas/resumen`. Sin scroll horizontal, axe 0 y sin errores de consola salvo el 404 de A-01.

## Hallazgos
| Id | Gravedad | Dónde | Pasos | Esperado → obtenido | Estado |
|---|---|---|---|---|---|
| A-01 | menor | Consola | Elegir un cliente sin recomendaciones | `GET /recomendaciones` devuelve 404 (contrato: «no hay») y Chrome lo pinta como error en consola; la web lo trata bien | Pendiente: cambiar el contrato afectaría a la API, al Asesor y a sus pruebas; no se ve en pantalla |
| A-02 | importante | Mi dinero, botones de mes y cambio de cliente | Pulsar › varias veces seguidas (o cambiar de cliente rápido) | La pantalla debe enseñar el mes elegido → podía enseñar KPIs de otro mes (respuestas que llegan desordenadas) mientras el selector decía otro | Corregido: cada carga (resumen, metas, resumen mensual, renta, deudas) ignora respuestas ya obsoletas. Prueba `autonomo.spec.js` A-02 (retrasa la primera respuesta) |
| A-03 | importante | Todos los formularios con «Guardar» | Doble clic en «Guardar» de «Añadir ingreso» | Un registro → se creaban dos | Corregido: un segundo envío idéntico en 1,2 s se ignora (global); si cambian datos se procesa (recalcular finiquito). Prueba A-03 |
| A-04 | importante | Capítulo 04, descargas | Descargar libro/asientos de un trimestre sin facturas (el por defecto es el trimestre en curso) | Aviso → «Descargado: …» sin más y un CSV de 1 línea | Corregido para CSV y .xlsx de libro/asientos/A3/Holded: añade «sin datos: no hay facturas en este trimestre». Prueba A-04. El botón «Exportar Excel» con 0 facturas sigue diciendo solo «Descargado» (menor, pendiente: habría que consultar el total antes) |
| A-05 | importante | Formularios de ingreso, meta, deuda, simulador, finiquito y nómina | Enviar vacío, importe negativo o fecha de fin anterior | Mensaje en lenguaje normal → `"fecha_fin" no puede ser anterior a "fecha_inicio"`, `"salario_bruto_anual" debe estar entre 0.01 y 10000000`, `…mayor que 0. Falta "importe".` | Corregido: se muestran las etiquetas del formulario («Fecha de fin»…), se quita el «Falta» redundante y el punto decimal pasa a coma. Prueba A-05; los specs de metas, deudas y mi_dinero ahora comparan sin distinguir mayúsculas |
| A-06 | menor | Lista y KPIs de un cliente sin facturas | Elegir el cliente particular nuevo | Invitar a subir la primera / «Nada que revisar» → «No hay facturas con estos filtros…» (sin filtros) y «Todas revisadas» con 0 facturas | Corregido. Prueba A-06 |
| A-07 | menor | Diálogo «Nuevo cliente» | Corregir un NIF inválido y guardar | «Guardando…» → seguía el error anterior hasta cerrarse el diálogo | Corregido |
| A-08 | menor | Periodo (Desde/Hasta) | Poner Desde posterior a Hasta | Mensaje claro → toast «El periodo no es válido» y fechas inválidas en los campos | Mejorado el texto del aviso; los campos no se revierten (pendiente, menor) |
| A-09 | menor | Renta | Ver «Ingresos del año» con una paga anual | Aclarar si cuenta los meses futuros → 4.350,99 € incluye 7 de 12 mensualidades (hasta diciembre) de la paga anual | Pendiente: es decisión de diseño de la fase 4b (previsión anual); documentado aquí |

9 hallazgos: 0 bloqueantes, 4 importantes (A-02 a A-05) y 5 menores (A-01 y A-06 a A-09). Corregidos 6 (los 4 importantes, A-06 y A-07) y A-08 en parte; quedan pendientes A-01, A-09, el campo de A-08 y el Excel vacío de A-04, todos menores y con su motivo.

## Qué no se pudo probar
Subida real de facturas por Gemini (0 llamadas: la cuota diaria está casi agotada y los fixtures cubren la API con filas ya calculadas), importación real en a3/Holded
(formatos «a validar»), rendimiento con miles de filas (cubierto por `tests/auditoria/rendimiento_api.py` en la auditoría anterior) y el modo demo solo por las
pruebas existentes más las nuevas A-03, A-05 y A-06.

## Capturas
Referencia del estado final (sin fallos visuales): `docs/rediseno/auditorias/capturas/aut-390-facturas-empresa.png` (fila abierta de la empresa en móvil) y `aut-1440-mi-dinero-autonomo.png` (Mi dinero del autónomo). Los fallos A-02 a A-05 son de comportamiento (carreras, doble envío, textos y avisos) y los cubren las pruebas de `tests/e2e/autonomo.spec.js`, no una captura.
