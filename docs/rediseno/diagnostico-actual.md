# Diagnóstico del diseño actual (visto en capturas `auditorias/capturas/antes-*`)

Medido a 1440×900 con la lista de 14 facturas. Lo que funciona y lo que resta para una **herramienta densa**.

## Lo que hay que conservar
- Paleta cálida y legible, buen contraste, cifras en monoespaciada (`tabular-nums`): las columnas de importes se leen bien.
- El efecto de capítulos sticky y la vista previa del documento al pasar el ratón: son la seña de identidad y funcionan.
- Estados con color (Correcta / Revisar) y la franja ámbar de las facturas por revisar: se ven de un vistazo.

## Lo que resta (con evidencia)
1. **Aspecto de web de marketing, no de herramienta.** Un titular serif de 40 px («Cada factura, en su sitio») más un párrafo de 4 líneas con atajos ocupan ~330 px antes de ver la primera factura. En 900 px de alto, la lista arranca en y≈490: **se ve 1 fila y media**.
2. **Filas demasiado altas e irregulares.** Cada fila ocupa ~75 px porque el nombre del proveedor, la categoría y el chip de «Pagada» se apilan; el nombre se corta («Basic-Fit Spain, S…») mientras hay sitio de sobra a la derecha. Las columnas «Vence» y «Estado» no se alinean con sus cabeceras.
3. **Redundancia de estados.** «CORRECTA» + «Pagada» + categoría + «Ticket» + «Ret. 15 %» compiten en la misma celda; el estado importante (Revisar, Vencida, No deducible) se pierde entre los neutros.
4. **Barra de filtros pesada.** Siete controles en dos filas, todos `<select>` nativos del mismo peso visual que la búsqueda.
5. **Panel lateral de capítulos de 260 px** fijo: bueno como idea, caro en anchura (la lista pierde ancho y el nombre se trunca). La vista previa (340 px) también compite por la misma anchura.
6. **El detalle de la fila abierta** (fiscal, 12 datos en 3 columnas, párrafos) es largo: una factura abierta ocupa casi una pantalla; el formulario de corrección, más de dos.
7. Jerarquía tipográfica con muchas voces (serif de display, sans, mono) para una app que se usa horas: cansa y no ayuda a escanear.
8. En móvil la cabecera (periodo, cliente, estado) ocupa ~25 % de la pantalla antes del contenido.

## Objetivos medibles del rediseño
- Ver **≥ 8 filas** de factura a la vez a 1440×900 (hoy: 1,5).
- Fila de 40–44 px en una línea: fecha · proveedor · categoría · estado · vence · importe, alineados con la cabecera.
- Un solo estado visible por fila (el más importante); el resto, en el detalle o como icono con `title`.
- Cabecera y filtros en ≤ 2 líneas; la introducción larga pasa a una ayuda plegable.
- Mantener contraste AA y todas las pruebas (29) en verde.
