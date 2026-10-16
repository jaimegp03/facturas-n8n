# Ronda 1 · consolidación (director)

Fuentes: `ronda-1-tecnico.md` (T1–T13) y `ronda-1-diseno.md` (D1–D9, notas por área 5–7). Veredicto de ambos: **CORREGIR**.
Se fusionan duplicados (T1=D1, T4=D4, T5=D2, T7=D5, T3 entra en T2) y se decide cada uno. **Se aplica lo marcado «APLICAR»; lo marcado «DESCARTAR» no se toca.**

## Bloqueantes
| ID | Decisión | Instrucción concreta |
|---|---|---|
| T1 = D1 | **APLICAR** | A 390 px no puede haber scroll horizontal (hoy 602). Origen: pestañas de estado (`#tabsEstado`: `overflow-x:auto`, `flex-wrap:nowrap`, `.tab{flex:none}` + fundido en el borde derecho), `#chartMes svg{max-width:100%;height:auto}`, y las tablas de `#fiscalOut` (347, retenciones, 349), `#bancoOut` y `#tablaRec`: dentro de un contenedor `overflow-x:auto` y, en ≤ 480 px, filas apiladas legibles (fecha+importe arriba, concepto debajo, botones a ancho completo). No tapar con `overflow-x:hidden` global salvo como red de seguridad. |
| T2 | **APLICAR** | axe debe volver a **0 violaciones**. (a) `nested-interactive`: el checkbox `.sel-fila` (y su `label.pick`) sale de `.row-head[role=button]`: la fila `li.row` pasa a rejilla `[pick][head]` y `.row-head` queda sin hijos enfocables. Conserva `.row-head` como elemento enfocable con `role="button"`, `aria-expanded`, `tabindex="0"` y todas las clases. (b) `aria-sort` no es válido en `button`: cada `button.th[data-orden]` va dentro de un `<div role="columnheader">` (con `#listHead` como `role="row"`) y `aria-sort` pasa a ese `columnheader`; `pintarOrden()` se ajusta para escribir ahí. **Se autoriza ajustar la prueba** `gestoria.spec.js` («orden por total y atajos») para leer `aria-sort` del `columnheader` padre; decláralo. (c) contraste: ver T3. |

## Importantes
| ID | Decisión | Instrucción concreta |
|---|---|---|
| T3 | **APLICAR** | `--muted` → `#5C6764` (≥ 4,8:1 también sobre `--surface-2` `#F1F1EC`; actualiza `MASTER.md`). Comprueba cada par texto/fondo nuevo. |
| T4 = D4 | **APLICAR** (a, b, d, e); (c) parcial | (a) **No abrir ninguna fila al cargar**: `pintarLista()` deja `S.abierta = null` y muestra en `#preview` los datos de la primera factura **sin** poner `.open` (la vista previa cambia al pasar el ratón como hasta ahora). (b) Quitar el hueco del capítulo 01: **eliminar el `min-height: 38svh`** y compensarlo en `capituloActivo()`: si `scrollY < 80` el activo es el primero (cambio mínimo de lógica, declárarlo). La cola de subida vacía no ocupa espacio. (c) Cabecera del capítulo 02 en **≤ 2 líneas**: línea 1 = título «02 Clasifica» + icono `?` (abre el `<details>` de ayuda) + pestañas; línea 2 = búsqueda y los 6 selects en una fila (`flex:1 1 0; min-width:0`; los selects como píldoras de 28–32 px). Sin popover «Filtros». (d) La barra de cabecera de cada capítulo pasa de h2 grande a un título de ~40 px («01  Sube»). |
| T5 = D2 | **APLICAR** | Los avisos no pueden recortarse ni pisar la categoría. Celda «Aviso» con columna propia en la rejilla de la fila (~190 px): **primer chip = el de mayor prioridad** (Revisar → Vencida → No deducible → NIF inválido → Pendiente), completo y con `flex:none`; los demás avisos (Ret. 15 %, Ticket, USD, Abono…) siguen en el DOM como **texto gris de 12 px sin fondo**, a continuación, con elipsis en el borde de la celda. **No ocultar con `display:none`** (las pruebas leen su texto). La categoría pasa a su propia columna en texto gris. |
| D3 | **APLICAR** | Un solo estado destacado por fila: **«Correcta» no se muestra como chip verde**: déjalo en el DOM visualmente oculto con la técnica sr-only (no `display:none`) y sin punto verde. «Pagada» y «Pendiente» pasan a neutros (`--info`), solo «Revisar», «Vencida» y «No deducible/NIF inválido» llevan color. La fecha de vencimiento de una factura vencida: `--bad` peso 500 **o** chip, no las dos cosas (déjala en rojo 500 sin chip duplicado). |
| T6 | **APLICAR** | `@media (pointer: coarse)`: área clicable ≥ 36×36 px en `label.pick`, `.th`, `summary`, `#fPorPagina`, `a.brand` y `btn-sm`; sin cambiar la densidad en escritorio. |
| T7 = D5 | **APLICAR** | Detalle de la fila abierta en **rejilla de 4 columnas de pares etiqueta/valor** (etiqueta 12 px `--muted`, valor 13,5 px) para bajar a ≈ 190–230 px (hoy 363); no repetir en la fila lo que la vista previa ya muestra (total/base/IVA). Vista previa: quitar la «ficha» interior (tarjeta dentro de tarjeta), `.facs .tag` («datos leídos») en la esquina sin pisar el título, miniatura a ancho completo y los datos debajo como lista; cabeceras de `.iva-tabla` con `padding` y alineadas a la derecha como sus cifras. |
| D6 | **APLICAR** (parcial) | Gráfico mensual: eje Y a la izquierda en 12 px `--muted`; etiquetas de mes en 12 px sin montarse (si no caben, solo la inicial); etiquetas de valor en Plex Sans 500 12 px `--ink-2` solo en la barra máxima y la del mes en curso; barra de 0 € como línea de 2 px `--line-strong`. **Mantén 1 `g.m` por mes** (las pruebas cuentan 10). KPI: la cifra principal 32 px y las otras tres como mini-cifras del mismo estilo, sin celdas con borde. «Suscripciones vacías»: una línea gris, sin panel. **DESCARTADO: «abrir por defecto el último trimestre con facturas»** (ya sigue el periodo elegido arriba; añadir esa heurística es lógica nueva fuera del alcance). |

## Menores
| ID | Decisión | Instrucción |
|---|---|---|
| T8 | **APLICAR** | `Esc` dentro de `.edit` pulsa «Cancelar» (JS aditivo). |
| T9 | **APLICAR** | No pedir la miniatura (`/archivo?id=`) si la factura no tiene `archivo_ruta` (ya hay facsímil). Sin tocar nada más del flujo. |
| T10 | **DESCARTAR** | La insignia refleja la última petición: tras abortar `/facturas`, otras peticiones siguen respondiendo. Es coherente. |
| T11 | **APLICAR** | Dentro de D1 (pestañas con scroll y fundido; gráfico con su `viewBox`). |
| T12 | **APLICAR** | Fila de 40 px **incluido** el borde (`box-sizing:border-box`); filtros en una línea (T4). |
| T13 | **DESCARTAR** | A 768 la cabecera deja de ser fija a propósito (en tablet roba altura); se documenta en `MASTER.md`. |
| D7 | **APLICAR** | Tablas del capítulo 04 (banco, 347, retenciones): columna Importe `text-align:right; padding-right:24px; width:120px`, columna «Factura sugerida» con `padding-left:16px`, acciones en una sola línea (`Conciliar` secundario con borde, `Ignorar` ghost, 28 px). Trimestre, Pagos y Excel **sin caja**: línea superior de 1 px y 32 px de aire; solo el gráfico mensual y el reparto conservan panel. |
| D8 | **APLICAR** | Formulario de corrección: sin `fieldset` con borde; título de grupo 12/500 `--muted` + línea fina; rejilla de 4 columnas iguales; `Base`/`Cuota` con `min-width:96px`; barra de acciones pegajosa abajo con «Guardar cambios» a la derecha. |
| D9 | **APLICAR** (parcial) | Quitar el subtítulo «tus gastos en claro»; selector de cliente de ≥ 260 px con elipsis; punto de color + `title` para la conexión (el texto «Conectado» **debe seguir en el DOM**, p. ej. sr-only). **DESCARTADO: fundir las dos fechas en un solo control** (las pruebas rellenan `#desde` y `#hasta`) y **quitar los subtítulos del lateral** (`#s1–#s4` los usan las pruebas y comunican estado). |

## Qué conservar (del crítico, más lo del director)
1. Marca Fraunces + teal único `#0F4C5C` con botones primarios llenos.
2. Filas de 40 px en una línea con importes en mono alineados a la derecha y cabecera fina sin fondo.
3. Reparto por categoría con barras finas dentro de la tabla y pestañas de estado con subrayado teal.
4. Lo que el auditor técnico dio por bueno: foco visible, diálogos sin trampa, `prefers-reduced-motion`, estados vacío/carga/error, descargas, y los dos efectos de scroll (sin filas que se abren solas al hacer scroll).

## Nota de cobertura
Ningún auditor pudo juzgar el estado «Por revisar» con el cliente 2 (no tiene facturas en revisión). La comprobación final debe usar el cliente 1 (Personal), cuya Repsol está en «Revisar».
