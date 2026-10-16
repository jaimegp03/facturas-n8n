# Entrega · rediseño visual de «Facturas» (15/10/2026)

**Archivo:** `web/index.html` (123 KB, un solo archivo, se abre con doble clic). Copia del original: `tests/salida/index.pre-rediseno-2026-10-15.html`.
**Modo:** rápido, método del equipo `disenador-web-pro` seguido a mano sin instalarlo (ver «Lo que faltó»).

## Dirección elegida (`DIRECCION.md`, `design-system/MASTER.md`)
Herramienta moderna y densa: sin hero, barra superior fija y navegación lateral estrecha; lista de filas de 40 px en una línea con **un solo aviso destacado por fila**; IBM Plex Sans + Plex Mono (Fraunces solo en la marca); un único acento teal y chips pálidos; tablas sin cajas. Referencias: Stripe (lista de facturas), Holded (compras/conciliación), Linear (jerarquía por peso y gris), Pennylane y Ramp.

## Antes → después (medido a 1440×900, con 24 facturas)
| | Antes | Después |
|---|---|---|
| Filas de factura completas en la primera pantalla | 1,5 | **12** (a 1366×768: 8–9) |
| Altura de fila | ~75 px, en varias líneas | **40 px**, una línea |
| Estados por fila | 3–5 chips compitiendo | **1 destacado** + texto gris |
| Scroll horizontal a 390 px | no | **no** (el primer borrador sí lo tenía: 602 px) |
| axe-core WCAG 2.1 A/AA | 0 | **0** (el primer borrador: 3 violaciones) |
| Colores fuera de `:root` | — | **0** |
| Pruebas automáticas de la web | 29 | **19 + las del modo gestoría = todas en verde** |
Capturas: `auditorias/capturas/antes-*` y `despues-*`.

## Rondas
1. **Construcción** (constructor) → **auditoría técnica + crítica en paralelo, instancias nuevas** (`ronda-1-*.md`): ambas «corregir»; 2 bloqueantes (desborde móvil, 3 violaciones de axe) y 5 importantes. Consolidado en `ronda-1.md` (aplicar/descartar con motivo) → corrección + pulido.
2. **Auditoría final, instancias nuevas** (`ronda-2-*.md`): 0 bloqueantes; crítica **7,5 / 10** (tipografía 8, color 8, movimiento 8, texto 8, dirección 8). Consolidado en `ronda-2.md` → última corrección.
3. La última corrección se verificó con las pruebas automáticas y mediciones, **no con una tercera auditoría independiente** (modo rápido).

## Cambios de lógica (mínimos, todos declarados)
`pintarLista()` ya no abre la primera fila al cargar; `capituloActivo()` activa el primer capítulo cerca del inicio; `pintarOrden()` pone `aria-sort` en el `columnheader` (se ajustó **una línea** de `gestoria.spec.js`); la primera `<option>` de los filtros tiene texto corto; JS aditivo: pestañas de estado, botón `?` de ayuda, `Esc` cancela la corrección, no se pide miniatura sin archivo, gráfico redibujado al cambiar de tamaño. La mecánica del hover no se tocó.

## Pendiente / decidido no hacer
- **T3 (RESUELTO el 2026-10-16, ver addendum al final; texto original):** al barrer el ratón por la lista, la página se desplaza para mantener bajo el puntero la fila señalada (la anterior se pliega). Es inherente a un acordeón con expansión al pasar el ratón; las alternativas empeoran la experiencia o cambian el efecto pedido.
- T9 (error de red de la lista sin botón «Reintentar» y en gris) y T11 (barra de progreso de capítulos no monótona al inicio): menores.
- D7: resumen «IVA deducible / Retenciones» sobre las tablas del trimestre y ocultar filas a cero (contenido nuevo; las pruebas leen esas filas).
- Cabecera móvil: versión CSS compacta; plegarla en un `<details>` implicaría lógica nueva.
- Sin tema oscuro (no pedido).

## Lo que faltó
No estaban instaladas las skills Taste, UI UX Pro Max, Impeccable ni Emil Kowalski, ni el MCP `playwright`: `MASTER.md` lo redactó el director a mano, no se pasó el detector de Impeccable (exige `npx -y`, y se pidió no instalar nada) y el aspecto se juzgó con criterio propio frente a las referencias. Las referencias son imágenes públicas de producto, no apps reales con sesión.

---
# Addendum · v2 «Moderna y vibrante» + Modo demo (15/10/2026)
Copia previa: `tests/salida/index.pre-vibrante-2026-10-15.html`. Dirección y tokens: `design-system/MASTER.md` (sección v2).
- **Aspecto:** cabecera teal con logotipo SVG y selector de cliente protagonista, banda de resumen junto a la zona de subida, KPI en tarjetas tintadas con cifra Manrope, gráfico mensual con degradado/tooltip/entrada animada, donut de categorías, chips en píldora, tarjetas con relieve, tarjeta de exportación en teal con acento coral, estados vacíos con ilustración, entrada escalonada al hacer scroll. Sin cambios de lógica de negocio ni de llamadas a la API.
- **Modo demo:** interruptor en la cabecera; 4 clientes y ~110 facturas ficticias en memoria, todas las pantallas (lista, edición, lote, borrado, subida simulada, resumen, trimestre 303/111/115/349/347, banco con sugerencias, asesor, descargas CSV). Con la demo activa no se hace ninguna petición a n8n.
- **Medidas:** 12 / 11 filas completas a 1440×900 (real / demo) y 8 / 8 a 1366×768; fila 40 px; cabecera 56 px; banda 94 px; scroll horizontal a 390 = 0; axe 0 en ambos modos; 0 hex fuera de `:root`; 198 KB.
- **Pruebas:** escritorio+móvil 10/10, gestoria 9/9, demo 5/5, v2 6/6. Capturas: `auditorias/capturas/v2-demo-*.png`.

---
# Addendum · Exportaciones .xlsx en el navegador (15/10/2026)
Copia previa: `tests/salida/index.pre-xlsx-2026-10-15.html`.
- **Problema:** en demo el «Excel» era un CSV y los CSV de libro/asientos se abrían en Excel sin columnas ni formato. **Cambio:** ExcelJS 4.4.0 (cdnjs, con SRI) se carga solo al pulsar una exportación; sin conexión muestra un error claro. Mismo estilo que el Excel del servidor.
- **Demo:** el botón Excel genera `Gastos_AAAA-MM-DD.xlsx` con 7 hojas (Resumen con SUMIFS, Facturas con SUBTOTAL, Por mes, Suscripciones y contratos, Recomendaciones, Libro registro, IVA trimestre) del cliente y periodo activos. Aviso: «Excel de ejemplo con datos ficticios».
- **Libro registro y asientos:** botones nuevos `.xlsx` (demo y real) que convierten el CSV recibido. Los CSV, A3 y Holded siguen como importación, con un solo BOM UTF-8, y una línea de ayuda. El Excel real del servidor no se tocó.
- **Pruebas:** `--project=excel_web` 5/5 (openpyxl: hojas, relleno 0F4C5C, anchos, autofiltro, paneles, fórmulas con caché, formato €, fechas, 0 errores); escritorio+móvil 10/10, gestoria 9/9 (incluye .xlsx convertidos desde el CSV real), demo 5/5, v2 6/6; `verificar.py` 175/175. Abiertos en Excel real por COM (`tests/excel_com_web.ps1`): sin reparación, 0 errores, PDF ordenado.
- **Límite del archivo web** (prueba v2): 200 → 224 KiB (ahora ~219 KB por el código del generador).

## Addendum 2026-10-16: hover y scroll de la lista (T3 resuelto)
- **Problema:** con ~50 facturas reales la página «se bugeaba» al hacer scroll con la rueda y costaba señalar una factura. **Causa:** la compensación de scroll se animaba por `html{scroll-behavior:smooth}`, el filtro de movimiento sintético por coordenadas iguales fallaba con el temblor de la mano y cerca del inicio de la página la compensación era imposible.
- **Cambio:** intención de hover (130 ms quieto, movimiento real ≥ 4 px), bloqueo mientras hay scroll, compensación `instant` + `overflow-anchor:none`, fila que «sobra» cuando no se puede compensar y fila fijada por clic/Enter (Esc la suelta). Detalle y propiedades a conservar en `CLAUDE.md`. Se mantiene el efecto (fila que se expande y vista previa que cambia al pasar el ratón); táctil sin cambios.
- **Medidas** (`tests/salida/scroll-antes.json` / `scroll-despues.json`, demo, 50 filas): puntería con la página arriba 27-28/30 → 30/30 (también a 1366×768); resto igual o mejor (0 filas abiertas por la rueda, sin long tasks, CLS 0, 60 fps). Pruebas: `--project=scroll`.
