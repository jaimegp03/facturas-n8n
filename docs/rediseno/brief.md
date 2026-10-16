# Brief · rediseño visual de «Facturas»

Fecha: 2026-10-15 · Modo: **rápido** (1 ronda de auditoría) · Equipo: método de `disenador-web-pro` seguido a mano (sin instalar nada; ver «Lo que falta»).

## Qué es
No es una landing: es una **aplicación de una sola página** (`web/index.html`, un archivo con CSS y JS dentro, que se abre con doble clic) para gestionar facturas recibidas. Habla con un n8n local por webhooks. Estado actual: cuatro capítulos en una página (01 Sube · 02 Clasifica · 03 Analiza · 04 Cierra el trimestre y exporta), con la barra lateral de capítulos fija (sticky) y la lista con vista previa lateral.

## Objetivo de la web (lo que más importa)
Que quien trabaja con decenas de facturas al día **vea de un vistazo qué necesita atención** (por revisar, vencidas, no deducibles, NIF inválido), **corrija sin salir de la lista** y **cierre el trimestre con confianza**. Un hostelero la usa 10 minutos a la semana; un gestor, horas.

## Público
- **Gestor/contable de una gestoría** (varios clientes de autónomos y pymes): rápido, denso, teclado, cifras fiables.
- **Autónomo o dueño de un restaurante** que sube sus propias facturas: necesita claridad, no jerga.
Los dos son lectores de números y tablas. Pantalla de portátil (1366–1440) y, ocasionalmente, móvil para subir fotos de tickets.

## Tono visual pedido por Jaime
**Herramienta moderna y densa**: limpia, rápida de leer, tablas claras, poco adorno. Referencias mentales: software de facturación/contabilidad actual (no una web de marketing).

## Qué se rediseña
Todo el aspecto: tipografía, paleta, espaciado, composición de la cabecera y los capítulos, componentes (botones, campos, chips/estados, tablas, tarjetas de KPI, gráficos, diálogos, barra de acciones en lote, toasts), estados vacíos y de carga, y el responsive.

## Lo que NO se puede romper (contrato con el código y las pruebas)
Las 29 pruebas automáticas de la web y la lógica JS dependen de esto. **Conserva tal cual:**
1. **Todos los `id`** de `web/index.html` (hay ~100) y los nombres de clase que usa el JS: `.row`, `.row-head`, `.row.open`, `.row.revisar`, `.row.sel`, `.chap`, `.chap.active`, `.chapters`, `.chapter`, `.kpi`, `.rec`, `.qi`, `.qi.fin`, `.chip`, `.st`, `.why.warn`, `.eq`, `.form-msg`, `.sel-fila`, `.th`, `.lote`, `.pager`, `.toast.show`, `.preview`, `.thumb`, `.edit`, `.iva-linea`, `.cats li`, `.chart g.m`, `[data-orden]`, `[data-act]`, `[data-descarga]`, `[data-pag]`, `[data-edit]`, `[data-ir]`, `[data-conciliar]`, `[data-ignorar]`, `[data-thumb]`, `[data-confirm]`, `[data-chap]`, `[aria-sort]`.
2. **Estructura de datos de las filas:** el JS genera el HTML de cada fila (`filaHTML`, `detalleHTML`, `editHTML`, `previewHTML`, `fiscalHTML`…). Se puede cambiar su CSS y reordenar el marcado que genera **sin cambiar nombres de clase ni atributos `data-*`**.
3. **Dos efectos de scroll ya implementados y obligatorios:** (a) escena sticky con capítulos numerados 01–04 que cambian de estado al hacer scroll; (b) lista donde, al pasar el ratón, la fila se expande y cambia la vista previa lateral. Hay lógica delicada de hover (ignora el scroll, no mueve la fila señalada): **no tocar el JS del hover**.
4. **Accesibilidad ya conseguida** (axe-core WCAG 2.1 AA sin violaciones; foco visible; `aria-sort`, `aria-live`, `aria-current`, diálogos `<dialog>`; salto «Saltar a la lista»): **no empeorar**, contraste AA como mínimo.
5. **Responsive:** móvil 390 sin scroll horizontal; la vista previa lateral se oculta en móvil y se abre en un diálogo.
6. `prefers-reduced-motion` respetado.
7. Un único `index.html` autocontenido. Se permiten Google Fonts (con fuentes del sistema de respaldo) y librerías por CDN, pero **sin build**.
8. **No cambiar la lógica ni las llamadas a la API.** Solo CSS y marcado estático (el `<body>` fuera de los fragmentos que genera el JS), y, si hace falta, funciones puramente visuales (p. ej. los SVG de los gráficos) sin cambiar lo que calculan.

## Contenido real (no inventar)
Textos de la interfaz ya escritos en español: se pueden afinar (microcopy) pero **no inventar datos, cifras, reseñas ni contactos**. No hay logo ni fotos: solo la marca de texto «Facturas».

## Referencias dadas por Jaime
Ninguna. Cualquier referencia que busque el cazador pesa lo que pese su calidad.

## Cómo se comprueba
- Pruebas existentes: `npx playwright test --project=escritorio --project=movil` (10) y `--project=gestoria` (9) en `tests/e2e/`, más `capturas_secciones.js` para ver secciones concretas.
- Capturas a 1440 y a 390 de las cuatro secciones, la fila abierta, el formulario de corrección, el lote, el trimestre y el banco.
- Datos: n8n local con las 14 facturas reales de ejemplo; para ver más casos, `tests/fixture_gestoria.py crear` (clientes y 26 facturas TEST; después `borrar`).

## Lo que falta (se dirá en la entrega)
No están instaladas en esta sesión las skills Taste, UI UX Pro Max, Impeccable y Emil Kowalski, ni el MCP `playwright`. El equipo trabaja con Playwright como librería de Node (Chrome instalado), el navegador integrado y criterio propio, y **no se afirmará haber usado** lo que no esté.
