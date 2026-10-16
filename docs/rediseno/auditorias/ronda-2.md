# Ronda 2 · consolidación (director)

Fuentes: `ronda-2-tecnico.md` (0 bloqueantes, 5 importantes, 9 menores; axe 0 violaciones) y `ronda-2-diseno.md` (0 bloqueantes, 4 importantes, 4 detalles; nota global 7,5). Modo rápido: esta es la **última tanda de correcciones** (una corrección más y listo); se verificará con las pruebas automáticas y mediciones, **no** con una tercera auditoría independiente (se dirá en la entrega).

## APLICAR
| ID | Instrucción concreta |
|---|---|
| T1 + D3c | Móvil 390: la fecha y el proveedor no pueden tocarse. Fecha en Plex Sans 12 px `--muted` (no mono) en la 2.ª línea junto al aviso, o columna de fecha ≥ 86 px con `column-gap:12px`; el proveedor ocupa la 1.ª línea con el importe a la derecha; la categoría se oculta con `display:none` **solo en móvil** (el texto de la categoría no lo leen las pruebas en móvil; comprueba) o pasa a la 2.ª línea. |
| T2 + D4 + D3d | Avisos: **ningún chip se corta a mitad de palabra**. Chip con fondo/borde solo para: Revisar (warn), Vencida (bad), No deducible / NIF inválido (bad), Deducción dudosa (warn), Pendiente (info con borde). «Pagada», «Ret. x %», «Ticket», «USD», «Abono a compensar», «Rectificativa» como **texto `--muted` 12 px sin borde ni fondo** (siguen en el DOM; nada de `display:none`). Si un aviso no cabe, `overflow:hidden` + `text-overflow:ellipsis` sobre el contenedor, nunca recortar un chip a la mitad (`flex:none` en el primero; los demás se omiten visualmente por el borde con elipsis de la celda). Una factura con la fecha en rojo (vencida) debe llevar el chip «Vencida» en el aviso (sin fecha en negrita roja duplicada: fecha roja `--bad` peso 500 **y** chip es aceptable si el chip es el primero de la celda). Amplía la columna Aviso 24 px si hace falta. |
| T4 + D5 | Capítulo 01 más bajo: no mostrar «Las facturas que subas aparecerán aquí…» mientras la cola esté vacía; separación entre capítulos 32 px en vez de 56. Objetivo medible: a 1366×768 caben **≥ 8 filas completas** sin scroll con el cliente 2, y a 1440×900 ≥ 10. |
| T5 + D2 + T13 | Gráfico mensual: margen izquierdo del SVG ≥ 56 px para que «20.000 €» no se corte (comprobar con importes de hasta 6 cifras), etiquetas con `text-anchor:end`; barras que usen la altura del panel (alto del gráfico = alto útil, `min-height:260px`) o panel alineado arriba (`align-self:start`) para no dejar ~240 px en blanco; etiquetas de valor: todas las barras con valor > 0 si caben, si no solo máximo y mes en curso. **Mantén 1 `g.m` por mes.** |
| T6 + D1 | Vista previa de una factura **sin archivo original**: sustituir el facsímil de ~400 px por una caja de ~72 px con icono de documento (SVG de 20 px) y el texto «Sin documento original» en `--muted` 13 px; quitar el importe suelto y el nombre repetido. Las facturas con archivo no cambian. |
| T7 | `#ayuda summary.sr-only`: `tabindex="-1"` para que no sea una parada de Tab invisible (el botón `?` ya abre la ayuda). |
| T8 | Pestañas de estado en móvil: que «No deducibles» sea alcanzable con pista visual (fundido en el borde) o que quepan reduciendo padding. |
| T10 | Nombre coherente: en la navegación el capítulo 04 se llama «Cierra» (el título del capítulo es «Cierra el trimestre»). |
| T12 | En móvil ocultar el botón de orden «Vence» de la cabecera de lista (la columna no se muestra). |
| T14 | `.btn` ≥ 36 px de alto con `pointer: coarse`, incluido `#btnAsesor`. |
| D3a/b | Móvil: la barra superior más compacta (marca + Ajustes en una línea; el resto del periodo/cliente en una segunda línea de 32 px como máximo); los 6 selects en **una sola fila con scroll horizontal** (`overflow-x:auto; flex-wrap:nowrap`, selects con `flex:none`), buscador visible encima. |
| D6 | Selects de filtro con valor por defecto corto («Categoría», «Tipo», «Estado», «Deducible», «Pago», «Factura»; cambia solo el texto de la primera `<option>`), `max-width:150px`; con un valor elegido, borde y fondo `--accent-soft` (la clase `.on` ya existe). |
| D8 | Controles de la cabecera a 32 px de alto y 13 px; selector de cliente `max-width:240px` con elipsis; el régimen como chip `info` pegado al selector; el punto de conexión conserva su `title`. |
| D7 (solo parte) | `align-items:start` en la rejilla del trimestre; suscripciones vacías en un panel de 56 px con borde de 1 px (no flotante). |

## DESCARTAR (se listan como pendientes en la entrega)
| ID | Motivo |
|---|---|
| T3 | Es el comportamiento inherente de un acordeón con expansión al pasar el ratón: al abrirse una fila y plegarse la anterior, el contenido se desplaza; la compensación de scroll mantiene bajo el puntero la fila señalada (el contrato prohíbe tocar la mecánica del hover). Alternativas (detalle flotante que tape las filas de debajo, o no compensar y que la fila «huya» del puntero, que fue el fallo original) empeoran la experiencia o cambian el efecto pedido. Con el detalle ya de ~240 px el salto es moderado. **Se documenta.** |
| T9, T11 | Menores: color/botón «Reintentar» en el error de red de la lista, y monotonía de `#chapBar` al inicio. Quedan como pendientes. |
| D7 (resto) | Fila de resumen «IVA deducible / Retenciones» y ocultar filas con ceros: es contenido nuevo y las pruebas leen filas como «Modelo 111». Fuera del alcance de un rediseño visual. |
| D3a (parcial) | La compactación total de la cabecera móvil en un `<details>` implicaría nueva lógica; se hace la versión CSS descrita arriba. |

## Qué conservar
Las listas de «qué conservar» de la ronda 1 siguen vigentes, más: las 10 filas de 40 px a 1440×900, 0 violaciones de axe, ningún scroll horizontal en 390, tablas sin cajas, los dos efectos de scroll y el formulario de corrección ordenado.
