# Crítica de diseño · ronda 2
Veredicto: CORREGIR (0 bloqueantes, 4 importantes, 4 menores)
5 segundos: A 1440 se entiende que es una herramienta de facturas (marca, capítulos 01–04, zona de subida y una lista densa que asoma). Falta que la lista empiece antes. A 390 se entiende, pero la lista queda enterrada bajo unos 600 px de cabecera y filtros.

Nota de método: Playwright con Chrome, cliente de prueba «2» (26 facturas, banco) y cliente «1» (Repsol por revisar). Sin escrituras. No se pudo ver la vista previa con archivo original en el cliente 2 (no tiene), solo en el cliente 1. Medido: 10 filas completas visibles a 1440×900 con el capítulo 02 alineado arriba, filas de exactamente 40 px, sin scroll horizontal a 390.

## Objetivos de DIRECCION.md

| Objetivo | Resultado |
|---|---|
| ≥ 8 filas visibles a 1440×900 | Cumple tras anclar «Clasifica» (10 filas, r2-diseno-d-c2). En la carga inicial solo se ven 7, porque 01 Sube ocupa 300 px (r2-diseno-d-primera) |
| Fila de 40 px en una línea | Cumple (40 px medido) |
| Un solo estado destacado por fila | Cumple a medias: ver D4 |
| Cabecera y filtros en ≤ 2 líneas | Cumple a 1440 (barra 53 px; pestañas + 7 filtros). No cumple a 390: ver D3 |
| Tablas sin cajas | Cumple en lista, trimestre y banco. Los paneles de Analiza siguen siendo cajas, razonable |

## Puntuación

| Área | Nota | Por qué |
|------|------|---------|
| Primera impresión | 7 | Sobria y clara, pero la zona de subida con borde discontinuo y su línea de ayuda consumen la mejor franja de pantalla antes de ver una sola factura |
| Originalidad | 7 | Marca serif + cifras en mono + nav 01–04 le dan carácter de libro de cuentas; el conjunto sigue siendo «SaaS beige correcto», sin un gesto propio (p. ej. la nav lateral solo es texto) |
| Tipografía | 8 | Plex Sans/Mono bien usada, cifras tabulares a la derecha, jerarquía por peso y gris. Resta: fechas en mono compiten con el proveedor, ejes del gráfico recortados |
| Color | 8 | Un solo acento teal y chips pálidos, fiel a la paleta. Resta que casi todos los chips son el mismo gris (D4) |
| Composición y ritmo | 7 | Rejilla y alineaciones sólidas en la lista y el banco; vacíos mal resueltos en la vista previa, el gráfico y el trimestre (D1, D2, D6) |
| Imagen | 6 | Sin fotos (correcto). Pero la vista previa sin archivo es un bloque blanco casi vacío de 400 px y el gráfico mensual deja medio panel vacío |
| Movimiento | 8 | La fila se expande a dos columnas sin saltos, la vista previa cambia a la vez, la nav lateral marca el capítulo y rellena su barra. Sobrio y con propósito |
| Texto | 8 | Concreto, en español, sin relleno («Hay 1 factura por revisar», «Por qué revisarla: …»). Resta el texto auxiliar de 01 y las cifras «0,00 €» sin contexto |
| Dirección | 8 | Cumple el concepto de libro de cuentas y casi todos los objetivos medibles; a la altura de Holded, por debajo de Stripe en el pulido de filtros y chips |
| **Global** | **7,5** | Correcta y funcional, con cuatro problemas importantes para llegar a «la enseñaría a un cliente» (8) |

## Hallazgos

| ID | Severidad | Dónde | Qué falla | Captura | Arreglo concreto |
|----|-----------|-------|-----------|---------|------------------|
| D1 | Importante | `#preview` cuando la factura no tiene archivo (cliente 2) | La vista previa es una tarjeta blanca de unos 400 px con el emisor arriba, la etiqueta «datos leídos» y el importe pegado abajo a la derecha; el 90 % es vacío. Además repite el nombre del proveedor tres veces (cabecera, tarjeta y el título superior). Con archivo (cliente 1) funciona bien, así que la falta de coherencia es visible | r2-diseno-d-fila-abierta, r2-diseno-d-primera vs r2-diseno-d-revisar-abierta | Sin archivo: sustituir la tarjeta por una caja de 72 px (`min-height:0`) con icono de documento 20 px, texto «Sin documento original» en `--muted` 13 px y la etiqueta «datos leídos» al lado. Quitar el importe suelto y el nombre repetido; dejar solo el bloque de datos (Fecha, Nº, Base, IVA, Total…) que ya está debajo |
| D2 | Importante | `#chartMes` y panel «Evolución mensual» | (a) Las etiquetas del eje Y se recortan por la izquierda («0.000 €», «0.000 €» en vez de «10.000 €», «5.000 €»). (b) Las barras ocupan solo el 40 % superior del panel; el panel se estira hasta la altura de «Reparto por categoría» y quedan ~240 px blancos. (c) La barra de jul tiene etiqueta pero feb, may, ago y sep no | r2-diseno-d-c3, r2-diseno-d-trimestre | (a) Margen izquierdo del SVG de 48 px (`padding-left` o `viewBox` con x desde 48) y etiquetas con `text-anchor:end`. (b) Alto del gráfico `height:100%` del panel con `min-height:260px`, o alinear el panel arriba con `align-self:start` y 300 px de alto. (c) Etiquetar todas las barras con valor ≥ 1 en 12 px `--muted`, o ninguna salvo el máximo |
| D3 | Importante | Móvil 390: cabecera, filtros y fila de lista | (a) Cabecera de 180 px en 4 líneas, no fija. (b) Los 6 selects + buscador se apilan en 5 filas (~170 px) antes de la primera factura. (c) En cada fila la fecha toca el proveedor sin hueco («23/09/2026TEST·Materiale…») y el proveedor queda en 8 caracteres, mientras la categoría ocupa media fila a la derecha. (d) El aviso extra se corta («Rect Rect») | r2-diseno-m-primera, r2-diseno-m-lista | (a) Compactar a una barra de 52 px: marca + botón «Ajustes»; fechas y cliente dentro de un `<details>` «Periodo y cliente». (b) Un solo botón «Filtros (n)» que despliega la rejilla; solo buscador visible. (c) `column-gap:12px` entre fecha y proveedor; fecha en Plex Sans 12 px `--muted` (no mono) en la línea 2 junto al chip; el proveedor ocupa la línea 1 entera con el importe a la derecha; ocultar la categoría. (d) Ocultar los avisos secundarios en móvil (`display:none` por debajo de 520 px) |
| D4 | Importante | Columna «Aviso» de `#list` | Se pedía un solo estado destacado, pero «Pendiente», «Ret. 19 %», «Ret. 15 %» y «Pagada» tienen el mismo chip gris con borde, así que a primera vista no se distinguen; solo Revisar, No deducible y Deducción dudosa destacan. Además el segundo aviso se corta en «Rec Re» (fila «Abono a compensar»), y hay filas vencidas (fecha en rojo) con la columna Aviso vacía | r2-diseno-d-primera, r2-diseno-d-fila-abierta | Chip solo para: Revisar (warn), Vencida (bad), No deducible/Deducción dudosa (bad/warn), Pendiente (info con borde). «Pagada» y «Ret. x %» como texto `--muted` 12 px sin borde ni fondo. Poner «Vencida» (chip bad) cuando la fecha esté en rojo. Ampliar la columna Aviso 24 px o no mostrar el segundo aviso si no cabe (`overflow:hidden` con `min-width:0`, sin cortar a mitad de palabra) |
| D5 | Detalle | Capítulo 01 «Sube» | Con 300 px de alto (título, franja, línea «Las facturas que subas aparecerán aquí…» y aire de 56 px), empuja la lista bajo el pliegue; la franja es de ~96 px y está bien, el resto sobra | r2-diseno-d-primera | Quitar la línea «Las facturas que subas…» cuando la cola esté vacía (mostrarla solo con elementos) y bajar el margen entre capítulos de 56 px a 32 px. Así la tabla empieza hacia y=330 y caben 10–11 filas en la primera pantalla |
| D6 | Detalle | Barra de filtros de 02 | Siete controles nativos con textos recortados («Todas las categorí…», «Pagadas y pendie…», «Todo tipo de factu…») y valores neutros que ocupan sitio; la referencia (Stripe) usa píldoras con «+ Estado» que solo se ven pobladas al activarse | r2-diseno-d-primera | Que el valor por defecto de cada select muestre solo la etiqueta corta («Categoría», «Tipo», «Estado», «Deducible», «Pago», «Factura») con `max-width:150px`; al elegir un valor, borde y fondo `--accent-soft` (ya existe en «Por revisar», r2-diseno-d-revisar-abierta) y texto «Categoría: Alquileres» |
| D7 | Detalle | Trimestre fiscal y Analiza (suscripciones) | Con datos reales el trimestre sale con muchos «0 / 0,00 €» y un vacío grande bajo «IVA soportado» frente a la columna derecha; la tabla 347 está sin relación visual con las otras y no hay una cifra resumen (IVA a ingresar o deducible) antes de las tablas. Las suscripciones vacías son una sola línea gris perdida entre el gráfico y el siguiente capítulo | r2-diseno-d-trimestre-cab, r2-diseno-d-trimestre2, r2-diseno-d-c3 | Fila de resumen encima: «IVA deducible» y «Retenciones» en 24 px mono con la etiqueta en 12 px, como el KPI de Analiza. Ocultar las filas con 0 y todo ceros. Alinear las tablas arriba (`align-items:start`) y dar a la 347 el mismo ancho que la rejilla. Suscripciones vacías: texto en `--muted` dentro de un panel de 56 px con borde de 1 px, no flotante |
| D8 | Detalle | Cabecera fija (`#top`) | La zona de periodo y cliente tiene tres tamaños de control distintos (fechas 40 px de alto, selector de cliente de 260 px recortado «TEST·Reformas García e Hijos, S.L. ·…»); el punto verde de conexión no lleva etiqueta y «Régimen general» flota sin significado. Se lee más cercana a un formulario que a una barra de herramienta | r2-diseno-d-primera | Controles a 32 px de alto y `font-size:13px`; selector de cliente con `max-width:240px` y el régimen como chip `info` pegado al selector (no suelto); punto de conexión con `title`/texto «Conectado» (visible solo en foco) |

## Comparación con las referencias
- **Stripe**: nos supera en pulido de filtros y chips (píldoras que se activan, chips con significado de color claro). Aquí los chips son casi todos iguales (D4, D6). En cambio nuestra fila abierta en dos columnas es más rica que su lista.
- **Holded**: la conciliación del banco con chip violeta «Sugerida» y botones «Conciliar/Ignorar» está al nivel o mejor. Les falta, a nosotros, el aviso accionable de una línea bajo los KPI y la cifra resumen del trimestre (D7).
- **Linear**: la navegación lateral estrecha acierta en peso y gris, pero es solo texto; le faltan los iconos de estado pequeños (punto o check por capítulo) para que «01–04» cuente algo más que un número.
- **Señales de plantilla IA**: ninguna grave (sin degradados, sin tarjetas por fila, sin emojis, sin morado-azul). Solo el aspecto genérico de «SaaS beige» y la rejilla de dos paneles iguales en Analiza.

## Efectos de scroll
- **Navegación lateral 01–04**: se ve y se siente bien; el capítulo activo se resalta con tarjeta blanca y borde teal, y la barra de abajo avanza con el scroll. Muestra datos útiles («24 clasificadas», «19.097,68 €», «1 por revisar»). Conservar.
- **Fila que se expande**: se abre sin saltos a dos columnas, mantiene las 10 filas del resto y la vista previa cambia a la vez; la fila «Revisar» abre con la franja ámbar y el motivo. Con dos filas distintas activas (r2-diseno-d-fila-abierta y -2) no hay cortes. Solo flojea la vista previa sin archivo (D1).

## Qué conservar
1. La fila de 40 px con la cabecera de tabla fina, la fecha/importe en Plex Mono tabular y las líneas de 1 px: es lo que hace la lista legible y densa.
2. La fila abierta en dos columnas (datos + tabla de IVA + «Por qué revisarla» en ámbar + acciones «Corregir e / Marcar pagada / Ver documento / Borrar») y el formulario de corrección, ordenado en secciones con etiquetas pequeñas.
3. La navegación lateral 01–04 con estado vivo y las pestañas de estado con el contador «Por revisar 1» y el aviso ámbar «Hay 1 factura por revisar» con su botón.
