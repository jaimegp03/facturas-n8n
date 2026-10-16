# Auditoría técnica · ronda 2
Veredicto: CORREGIR (0 bloqueantes, 5 importantes, 9 menores)

Método: Playwright (Chrome) sobre file://, clientes 2, 1 y 3, ratón real, rueda y teclado. No se modificó ningún dato (solo se abrieron diálogos, se filtró y se calculó el trimestre). Capturas en `auditorias/capturas/r2-tecnico-*.png`.

| ID | Gravedad | Dónde | Qué pasa | Evidencia | Arreglo |
|----|----------|-------|----------|-----------|---------|
| T1 | Importante | 390, `#list .row-head` `.fecha` + `.prov` | La fecha y el proveedor se pegan: «23/09/2026TEST·Materia…». La caja de la fecha mide 70 px y el texto mono 78 px, así que desborda y el hueco entre ambos es 0 px. Ocurre en las 24 filas. Con 768 y más no pasa. | Medido con Range (gap 0, boxW 70, textW 78). Captura `r2-tecnico-movil-lista.png` | Dar a la columna de fecha ≥ 86 px en móvil, o usar fecha corta («23/09/26»), o `gap` real. |
| T2 | Importante | 1440/1366/390, columna «Aviso» (`.chips.aviso`) | Los chips secundarios se cortan sin elipsis: «Rec», «Re» (Rectificativa, Ret. 15 %) junto a «Abono a compensar»; «Pagad» tras «Ticket»; «Ret. 7 %» cortado. El texto queda ilegible. | `r2-tecnico-fila-abierta-1440.png`, `r2-tecnico-preview-sin-original.png` y la captura móvil. `.chips` con overflow hidden y chips con `flex-shrink` | `flex-shrink:0` en los chips y ocultar los que no quepan (+N), o limitar a 2 chips. |
| T3 | Importante | 1440, `#list` al pasar el ratón | Al recorrer filas hacia abajo, la página se desplaza sola para compensar el colapso de la fila anterior. Con el ratón quieto en x=520 y subiendo por filas 1→3, `scrollY` pasa de 400 a 184 y a 0, y la lista termina a 464 px del borde superior (de 10 a 6 filas visibles). Al hacer scroll con rueda NO se abren filas solas ni la lista se mueve (comprobado: 8 pasos de rueda, fila abierta constante). | Script t4: `y 400→184→0` con `open 1→2→3`. `r2-tecnico-barrido-hover.png` | Es efecto de la compensación del hover (contrato: no tocar). Considerar no compensar cuando la fila abierta queda por encima, o aceptarlo. |
| T4 | Importante | 1366×768, primera pantalla | Solo 7 filas completas visibles (objetivo ≥ 8). 1440×900: 10; 1920×1080: 15. Altura de fila 40 px (cabecera de fila 39). | Medido: visibles 7 / 10 / 15; la primera fila empieza en y=464. `r2-tecnico-primera-1366.png` | Reducir ~40 px de cabecera de capítulo 01 / franja de subida o filtros en portátil bajo. |
| T5 | Importante | Todos los anchos, `#chartMes` (gráfico mensual) | Las etiquetas del eje Y se cortan por la izquierda: «10.000 €» y «20.000 €» salen como «.000 €» (x = −10 px respecto del contenedor). | `r2-tecnico-grafico-ejes-cortados.png`; medido en 5 anchos | Margen izquierdo del SVG ≥ 52 px o `text-anchor` adaptado a la anchura del texto. |
| T6 | Menor | 1440, `#preview` `.thumb` (facturas sin original) | El «facsímil» es un rectángulo blanco de 320×396 con 4 líneas arriba y el total abajo; repite lo que ya está en el título y en la lista de datos justo debajo. Parece vacío, no un documento. Con original (cliente 1) se ve bien. | `r2-tecnico-preview-sin-original.png` | Reducir altura (≈ 120 px), o quitar el facsímil y mostrar «Sin archivo original». |
| T7 | Menor | `#ayuda summary.sr-only` | Parada de Tab invisible (1×1 px, sin foco visible) justo tras las pestañas; duplica `#btnAyuda`. | Tab ×N, `SUMMARY.sr-only` 1x1; `r2-tecnico-foco-summary.png` | `tabindex="-1"` en ese summary. |
| T8 | Menor | 390, `#tabsEstado` | La pestaña «No deducibles» queda fuera de pantalla (464/358 px, scroll lateral) y sin pista de que hay más. | `r2-tecnico-movil-lista.png` | Degradado de borde o reducir paddings para que quepan 5. |
| T9 | Menor | Estados vacío y error | Error de red: el mensaje de la lista va en gris y no ofrece «Reintentar» (el de Analiza va en rojo). Vacío: la vista previa sigue diciendo «Pasa el ratón por una factura». | `r2-tecnico-error-red-1440.png`, `r2-tecnico-vacio-1440.png` | Color de error y botón de reintento; vista previa oculta si no hay filas. |
| T10 | Menor | Nav `.chap` 04 | Dice «Exporta» pero el capítulo se titula «Cierra el trimestre» (el brief usa este). | Capturas 1440 | Unificar el nombre. |
| T11 | Menor | `#chapBar` | La barra de progreso no es monótona: 18,9 % en y=0 y 16,0 % en y=261. | Muestreo de scroll | Revisar el cálculo en el inicio. |
| T12 | Menor | 390, cabecera de lista | Hay botón de orden «Vence» pero la columna no se muestra en móvil. | `r2-tecnico-movil-lista.png` | Ocultar «Vence» en móvil. |
| T13 | Menor | 1440, panel «Evolución mensual» | Gráfico de 200 px en un panel mucho más alto (se iguala al del reparto): ~300 px en blanco. | Captura completa 1440 | Altura del gráfico adaptada o alineación arriba sin estirar. |
| T14 | Menor | 390, `#btnAsesor` | 140×32 px (< 36 px táctil). El resto de objetivos móviles ≥ 36 (casillas con etiqueta 44×36). | Medido | `min-height:36px` en `.btn` móvil. |

## Comprobado sin fallos
- Sin scroll horizontal a 1920, 1440, 1366, 768 y 390 (las tablas anchas, p. ej. modelo 347, tienen scroll propio dentro de `.tscroll` con foco).
- Consola limpia: solo el 404 esperado de `/recomendaciones`; 0 errores de JS ni peticiones fallidas.
- axe-core WCAG 2.1 A/AA: 0 violaciones en clientes 2, 1 y 3, a 1440 y 390. Contraste calculado propio: 0 fallos en cientos de textos (chips, gris, botones).
- Navegación de capítulos: cambia de 01→04 al hacer scroll, se queda fija (top 69) y el último capítulo es alcanzable.
- Hover: la fila se expande (256 px) y la vista previa cambia a la fila señalada. Con rueda y el ratón quieto no se abren filas ni la lista se mueve sola.
- Teclado: j/k, Enter (foco en «Corregir»), e abre el formulario, Esc lo cancela devolviendo el foco, x selecciona y muestra el lote, / enfoca la búsqueda. Foco visible (outline 2 px teal) en todos los controles salvo T7; diálogos se cierran con Esc y devuelven el foco, sin trampa.
- `prefers-reduced-motion: reduce`: transiciones ≈ 0, `scroll-behavior:auto`, 0 animaciones activas.
- Estado «Revisar» (cliente 1): chip ámbar, aviso «Hay 1 factura por revisar», pestaña con contador, vista previa con original correcta.
- Rendimiento: lista visible en ~1,1–1,2 s (incluye las respuestas de n8n), DOMContentLoaded 185 ms; archivo 125 KB, una sola petición externa (Google Fonts).
- Estados: vacío, cargando («Cargando…») y error de red presentes.

Capturas: `C:\ProyectosClaude\facturas\docs\rediseno\auditorias\capturas\r2-tecnico-*.png` (primera-1440/1366/1920/390, completa-1440/768/390, fila-abierta-1440, corregir-1440, movil-lista, movil-fila-tap, grafico-ejes-cortados, preview-sin-original, vacio, error-red, carga, cliente1-1440, diálogos, ayuda).
