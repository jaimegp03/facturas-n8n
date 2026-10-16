# Sistema de diseño · «Facturas» (herramienta densa)

> Redactado a mano a partir de `referencias/REFERENCIAS.md` y del sistema actual. **No lo ha generado UI UX Pro Max** (la skill no está instalada en esta sesión).
> Es un contrato: el constructor usa estos tokens como variables CSS en `:root` y no inventa colores ni medidas fuera de aquí.

## Tipografía
| Uso | Familia | Peso · tamaño / interlínea |
|---|---|---|
| Interfaz | **IBM Plex Sans** (ya cargada; excelente con acentos y cifras) | 400/500/600 |
| Cifras e importes | **IBM Plex Mono**, `font-variant-numeric: tabular-nums` | 400/500 |
| Marca «Facturas» (único uso serif) | **Fraunces** 600 | 20 px |
| Texto base | Plex Sans | 14 / 20 |
| Tabla (filas) | Plex Sans | 13,5 / 20 |
| Etiquetas, cabeceras de tabla, chips | Plex Sans 500 | 12 / 16 (mínimo absoluto 12 px) |
| Título de capítulo (h2) | Plex Sans 600 | 20 / 26, `letter-spacing: -0.01em` |
| Cifra de KPI principal | Plex Mono 500 | 32 / 36 |
| Mini-cifras de KPI | Plex Mono 500 | 16 / 20 |
Jerarquía por **peso y gris**, no por tamaño. Sin cursivas decorativas, sin MAYÚSCULAS salvo etiquetas de estado de 12 px con `letter-spacing: .02em`.

## Color (un solo acento + semánticos solo para estados)
```
--bg:#F6F6F2;        /* fondo de la aplicación */
--surface:#FFFFFF;   /* paneles, tabla, diálogos */
--surface-2:#F1F1EC; /* hover de fila, cabeceras, campos deshabilitados */
--line:#E3E2DA;      /* separadores de 1 px */
--line-strong:#CCCABD;/* bordes de campos */
--ink:#17201F;  --ink-2:#44504D;  --muted:#5C6764;   /* texto (muted #5C6764: ≥ 5,2:1 sobre blanco y sobre --surface-2) */
--accent:#0F4C5C;  --accent-hover:#0B3843;  --accent-soft:#E3EFF1;  /* único acento: el teal de la marca y del Excel */
/* estados: texto sobre fondo pálido, siempre AA */
--ok:#1F6B3A;    --ok-bg:#E6F3EA;
--warn:#8A4B08;  --warn-bg:#FDF0DA;   --warn-line:#EBC27A;
--bad:#A3281E;   --bad-bg:#FBE6E2;
--info:#44504D;  --info-bg:#EEEEE9;   /* neutro: «Pagada», «Pendiente», tipo de factura */
--ia:#5B3A8C;    --ia-bg:#EFE9F7;     /* «regla aprendida» / sugerido por la IA */
```
Reglas: el fondo de página es `--bg`; todo lo que se lee o se edita vive en `--surface`. **Cero degradados** (salvo las barras de datos del Excel, que no son web), cero sombras decorativas.

## Forma y espacio
- Rejilla de **4 px**. Espaciados habituales: 4, 8, 12, 16, 24, 32.
- Radios: controles 6 px · paneles y diálogos 10 px · chips 4 px (casi rectos, como Stripe) · círculos solo en puntos de estado.
- Altura de controles: **32 px** (botones, selects, campos); botón primario 32 px; botón pequeño 28 px.
- Fila de tabla: **40 px** en una línea (44 px en táctil). Cabecera de tabla 32 px, sin fondo, `--muted` 12/500, borde inferior `--line-strong`.
- Bordes de 1 px `--line`; sombra únicamente en elementos flotantes: `0 8px 24px -12px rgba(23,32,31,.28)` (diálogo, barra de lote, toast).
- Foco visible: `outline: 2px solid var(--accent); outline-offset: 2px`.

## Componentes
- **Botón primario:** fondo `--accent`, texto blanco, 500; hover `--accent-hover`. **Secundario:** `--surface`, borde `--line-strong`, texto `--ink`. **Ghost:** sin borde, hover `--surface-2`. **Peligro:** texto `--bad`, borde `--bad-bg` más oscuro.
- **Chip de estado:** 12/500, padding 2×8, radio 4, borde 1 px del color del texto al 30 % y fondo pálido. Variantes: ok, warn, bad, info, ia.
- **Estado único visible en la fila** (el resto, discreto): prioridad Revisar → Vencida → No deducible → NIF inválido → Pendiente → Correcta/Pagada. Lo demás (retención, ticket, operación) como texto `--muted` de 12 px inline.
- **Importe:** mono, alineado a la derecha, signo «−» real, `€` en `--muted`.
- **Pestañas de estado** (nuevas, encima de la tabla): texto 14/500, activa con subrayado de 2 px `--accent`; cuentan solo «Por revisar».
- **Filtros** como píldoras de 28 px con borde (selects restilizados, mismos `id`).
- **KPI:** una cifra principal grande + 2–3 mini-cifras con punto de color y etiqueta; sin cajas iguales.
- **Tabla fiscal:** sin cajas, líneas de 1 px, cifras a la derecha, fila de total en 600.
- **Gráfico mensual:** barras de un solo tono (`--accent`), la del mes en curso `--accent-hover`, rejilla `--line`, etiquetas 12 px `--muted`.
- **Barra de lote:** flotante, fondo `--ink`, texto blanco, 36 px.
- **Diálogos y toast:** `--surface`, radio 10, sombra flotante.

## Movimiento
- Hover y foco: 120 ms `ease-out` en `background-color`, `border-color` y `color`.
- Expandir fila: 200 ms `ease-out` (ya implementado con `grid-template-rows`; **no tocar el JS del hover**).
- Solo `transform` y `opacity` donde se anime algo más. Toast: 160 ms. Nada de animaciones de entrada decorativas.
- `prefers-reduced-motion: reduce` desactiva todo salvo el cambio de estado.

## Accesibilidad (no negociable)
Contraste AA en todo (texto ≥ 4,5:1; chips comprobados); objetivos táctiles ≥ 36 px en móvil; foco visible; `aria-*` y `<dialog>` existentes intactos; el rediseño no puede empeorar el resultado de axe-core (0 violaciones).

## Notas de ronda 1
- En tablet (≤ 900 px) la barra superior deja de ser fija a propósito: roba altura; solo se queda fija la navegación de capítulos.
- Lista: «Aviso» es una columna propia; su primer chip es el de mayor prioridad y el resto son texto gris. «Correcta» no se muestra (solo para lectores de pantalla).

---

# v2 · «Moderna y vibrante» (15/10/2026)

> Pedido: menos sobria y más atractiva para enseñarla a futuros clientes (gestoría / hostelería), aspecto fintech, **sin perder funcionalidad ni densidad**. La v1 de arriba sigue siendo el contrato de **estructura, medidas de fila y accesibilidad**; esta sección sustituye su paleta, su forma, su movimiento y la regla «cero degradados / cero sombras decorativas». Copia previa del archivo: `tests/salida/index.pre-vibrante-2026-10-15.html`.

## Qué cambia y qué no
- **No cambia:** ids, clases, `data-*`, `aria-*`, mecánica del hover (`xyRaton`, `activar()`, `.cierra-ya`), capítulos sticky 01–04, fila de 40 px en una línea, un aviso destacado por fila, textos de avisos en el DOM, sin Inter, sin degradado morado-azul.
- **Cambia:** color (segundo acento cálido), superficies (tarjetas con relieve), cabecera (banda teal con marca), KPI (tarjetas tintadas con cifra grande), gráficos (barras con degradado, donut, tooltip, entrada animada), chips (más color), estados vacíos (ilustración), microinteracciones y una banda de bienvenida compacta.

## Tipografía v2
| Uso | Familia |
|---|---|
| Interfaz y tablas | **IBM Plex Sans** (sin cambios) |
| Cifras e importes en listas | **IBM Plex Mono** tabular |
| **Display (nuevo, una sola fuente):** titulares de capítulo, cifras grandes de KPI y de la banda, nombre de marca | **Manrope** 700/800 (Google Fonts; respaldo `system-ui`). Fraunces deja de usarse en la marca (se sustituye por el logotipo SVG + Manrope) |

## Paleta v2 (todo son tokens en `:root`; 0 colores hexadecimales fuera)
Base teal de marca + un acento cálido. Los pares texto/fondo se han comprobado a AA (≥ 4,5:1 texto normal; ≥ 3:1 gráficos).
```
Teal      --teal-900 #0A3340   --accent #0F4C5C   --accent-hover #0B3843
          --teal-600 #146B7E   --teal-500 #1A8296   --teal-300 #6CC3CF   --accent-soft #DDF0F3
Coral     --coral #C8431F (relleno con texto blanco 4,9:1)   --coral-ink #A8381A (texto sobre claro)
          --coral-bright #F2704A (decorativo)   --coral-soft #FDE9E2
Ámbar     --amber #F5A524 (decorativo)   --amber-soft #FFF1D6
Estados   --ok #1F6B3A/--ok-bg #E2F3E8 · --warn #8A4B08/--warn-bg #FDF0DA · --bad #A3281E/--bad-bg #FBE6E2
          --sky #1D5F8F/--sky-bg #E1EFFA (pendiente) · --ia #5B3A8C/--ia-bg #EFE9F7
Neutros   --bg #F2F6F5 · --surface #FFFFFF · --surface-2 #EEF3F2 · --line #DCE5E3 · --line-strong #B9C8C5
          --ink #14201F · --ink-2 #3F4E4C · --muted #566361
Series    --c1 #1A8296 --c2 #F2704A --c3 #F5A524 --c4 #3FA66B --c5 #4C9BD6 --c6 #8A6BB0 (reparto por categoría; solo decorativos, siempre con etiqueta de texto)
```
- **Fondo de página:** `--bg` con dos manchas radiales muy suaves (teal arriba-izquierda, coral arriba-derecha) hechas con `color-mix` sobre tokens; sin imagen.
- **Cabecera:** degradado teal `--teal-900 → --accent` (texto blanco, 9:1), logotipo SVG, selector de cliente protagonista, interruptor «Modo demo».
- **Coral** se usa para: llamada a la acción secundaria («Por revisar» en la banda), barra del mes en curso, indicador de demo, cifras destacadas de ahorro. Nunca para texto sobre blanco por debajo de `--coral-ink`.

## Forma, relieve y espacio v2
- Radios: controles **8**, paneles/tarjetas **16**, chips **999** (píldora), diálogos 16.
- Sombra de tarjeta `--shadow-card` (doble capa, tinte teal, ≤ 18 % de opacidad) y `--shadow-lift` al pasar el ratón por tarjetas y botones primarios. Sombra flotante igual que en v1.
- **Medidas intactas:** fila de lista 40 px (44 en táctil), controles 32 px, cabecera ≤ 64 px de alto en escritorio (más 22 px de tira «DEMO» solo con la demo activa).
- Tarjetas (`.panel`, `.listbox`, `.export`, KPI) blancas con borde `--line`; las antiguas `.panel.flat` pasan a tarjetas.

## Gráficos v2
- **Evolución mensual:** barras con degradado vertical `--teal-500 → --accent`, la del mes en curso en degradado coral; esquinas superiores redondeadas; rejilla `--line`; **tooltip propio** (`.tip`) al pasar el ratón o enfocar un `g.m`; animación de entrada `scaleY` desde la base (transform, 450–700 ms, escalonada), solo la primera vez y sin `prefers-reduced-motion`. Sigue habiendo un `g.m` por mes.
- **Reparto por categoría:** donut SVG (decorativo, `aria-hidden`) con el total en el centro + lista con barras de color (`--c1…--c6`, mismo color por categoría en la lista de facturas gracias a un punto en `.cat`).

## Movimiento v2
- Hover en filas, botones, KPI y tarjetas: 120–200 ms, solo `transform` (≤ 2 px), `opacity`, `color`, `background-color` y sombra.
- **Entrada escalonada al hacer scroll** (`IntersectionObserver`, una sola vez) en tarjetas de los capítulos 03 y 04. El contenido solo se oculta (`.pre`) si el observador está activo y la tarjeta está bajo el pliegue; si el JS falla no se oculta nada. Cada elemento lleva `--d` (retardo) escalonado.
- `prefers-reduced-motion: reduce` apaga entradas, barras y transformaciones.
- Los dos efectos obligatorios (capítulos sticky 01–04, fila que se expande con vista previa) conservan su mecánica.

## Componentes nuevos
- **Banda de resumen** (`#bienvenida`, ≤ 96 px, dentro del capítulo 01 **a la derecha de la zona de subida** —así no añade altura y no resta filas visibles—; en ≤ 1100 px pasa debajo): cliente activo, gasto del periodo (cifra Manrope grande), nº de facturas, botón coral «N por revisar» (lleva a la lista filtrada) y mini gráfico de 12 meses. Oculta el mini gráfico en móvil.
- **Estados vacíos** (`.vacio-il`): ilustración SVG de 56 px con trazo teal y un toque coral + frase amable. Se mantiene el texto original de cada mensaje.
- **Interruptor «Modo demo»** (`#btnDemo`, `role="switch"`): punto coral cuando está activo; con demo activa aparece la tira «DEMO · datos ficticios» (20 px) pegada a la cabecera. El selector de cliente arranca en «Taberna La Esquina» (cliente 2). Estado en `localStorage` `facturas.demo`, apagado por defecto.

## Modo demo (contrato)
Capa fina dentro de `api()` y de `subirUno()`: con demo activo **no hay ninguna petición de red a n8n** y no se escribe ningún ajuste ni dato real (el almacén de ajustes ignora las escrituras). Datos 100 % ficticios generados en el cliente (3 clientes, ~35 facturas, banco, recomendaciones, trimestre fiscal calculado desde esas mismas facturas). Al apagarlo la página se recarga y vuelve a los ajustes reales sin residuos.

## Medidas v2 (15/10/2026, Chrome, `tests/e2e` proyecto `v2`)
Filas completas en la primera pantalla: 1440×900 → 12 (real) / 11 (demo); 1366×768 → 8 / 8. Fila 40 px, cabecera 56 px (+20 px la tira demo), banda 94 px, scroll horizontal a 390 px = 0, axe WCAG 2.1 A/AA = 0 (demo apagada y encendida, con la página recorrida y con el formulario y el diálogo abiertos), 0 colores hexadecimales fuera de `:root`, `web/index.html` ≈ 198 KB. Para esquivar el desplazamiento por el scroll, las tarjetas con entrada animada se miden ya reveladas.
