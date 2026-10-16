# Dirección visual · «Facturas»

## Concepto
**Un libro de cuentas que se lee de un vistazo**: una herramienta de trabajo sobria y rápida, donde lo único con color es lo que necesita tu atención.

## Tipografía
**IBM Plex Sans** para la interfaz y **IBM Plex Mono** (cifras tabulares) para importes y números de factura; Fraunces queda **solo en la marca**. Por qué: una familia sola da coherencia y rapidez de lectura durante horas; la mono alinea las columnas de dinero; el serif en la marca conserva la identidad sin gastar atención en los datos.

## Paleta (un solo acento)
Fondo `#F6F6F2`, superficies `#FFFFFF`, texto `#17201F`, apoyo `#66716E`, líneas `#E3E2DA`. **Acento único: teal `#0F4C5C`** (el de la marca y el Excel). Color semántico solo en estados: verde `#1F6B3A`, ámbar `#8A4B08`, rojo `#A3281E`, violeta `#5B3A8C` para lo aprendido/sugerido por la IA, siempre como chip pálido.

## Hero
**No hay hero.** Se elimina el titular grande y el párrafo de introducción. Arriba, una barra fija de 52 px (marca · periodo · cliente · conexión · ajustes). Debajo, la barra de capítulos pasa a ser una navegación lateral **estrecha (184 px)** y el contenido empieza ya en el trabajo.

## Mapa de secciones (el orden y los 4 capítulos se mantienen)
- **01 Sube:** una franja de 96 px: zona de arrastre en una línea («Arrastra facturas o elige archivos») y la cola de subida justo debajo. **Efecto de scroll 1: la navegación lateral sticky con capítulos 01–04** que cambian de estado al desplazarse (ya implementada; se compacta).
- **02 Clasifica:** pestañas de estado (Todas · Por revisar · Pendientes · Vencidas · No deducibles) + píldoras de filtro + búsqueda; tabla de **filas de 40 px en una línea**; vista previa de 320 px a la derecha. **Efecto de scroll 2: al pasar el ratón la fila se expande y la vista previa cambia** (ya implementado; el expandido se rehace en dos columnas para ocupar la mitad de alto).
- **03 Analiza:** KPI como una cifra grande + mini-cifras; gráfico mensual y reparto por categoría en dos paneles; tabla de suscripciones sin cajas.
- **04 Cierra el trimestre y exporta:** trimestre fiscal en tablas limpias con totales; descargas como barra de botones; banco con la tabla de movimientos y las sugerencias marcadas con el chip violeta; recomendaciones del asesor y Excel.

## Movimiento
Se anima: hover/foco (120 ms), expandir fila (200 ms), toast. **No se anima:** entradas de sección, números que cuentan, parallax. Todo respeta `prefers-reduced-motion`.

## Tres cosas que NO vamos a hacer
1. **No** un hero de marketing, titulares serif de 40 px ni párrafos de bienvenida: esto es una herramienta, no una landing.
2. **No** tarjetas por fila, sombras ni degradados decorativos: tablas sin cajas, con líneas de 1 px.
3. **No** chips ni botones con colores saturados llenos, ni más de un acento: el color es información, no decoración.
(Tampoco: tema oscuro — no pedido — ni tocar la lógica, la API ni el JS del hover.)

## Lo que Jaime dijo que quería
Herramienta moderna y densa; rediseño visual completo conservando todas las funciones; modo rápido (1 ronda).

## Objetivos medibles (de `diagnostico-actual.md`)
≥ 8 filas visibles a 1440×900 (hoy 1,5) · fila de 40 px en una línea alineada con su cabecera · un solo estado destacado por fila · cabecera y filtros en ≤ 2 líneas · contraste AA · 29 pruebas en verde.

## Pequeña ampliación permitida al contrato del brief
Se permite **JS puramente aditivo** para las pestañas de estado (fijan los `<select>` existentes `#fEstado`, `#fPago`, `#fDed` y lanzan su evento `change`) y para plegar la ayuda larga en un `<details>`. Los selects conservan sus `id`. No se modifica nada de la lógica existente.
