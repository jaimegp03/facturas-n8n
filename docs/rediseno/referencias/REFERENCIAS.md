# Referencias · rediseño de «Facturas» (herramienta densa, no landing)

Referencias de Jaime: ninguna (`referencias/` estaba vacía). Capturas a 1440×900 hechas con Playwright (Chrome) en `referencias/capturas/`; script: `capturas/capturar-referencias.js`.

**Aviso honesto:** las apps de facturación reales están tras login y no he iniciado sesión en ninguna. Lo que se ve son las imágenes de producto que cada marca publica en su web o en su ayuda. La de Stripe es una maqueta fiel de su panel; la de Linear es la app real en su portada; Holded, Pennylane y Ramp son ilustraciones de producto más estilizadas. Se aprenden principios, no píxeles. No he extraído tipografía ni hex con código (las interfaces son imágenes); lo que digo de tipos y color sale de verlo en la captura.

## 01 · Stripe Dashboard (lista de facturas) — https://stripe.com/es/invoicing
Por qué está aquí: es la mejor lista densa con estados que he visto, casi exactamente nuestro caso de «lista de facturas».
Qué cogemos:
- Composición: título de sección + botón primario a la derecha; debajo, **pestañas-filtro por estado** (Todas, Borrador, Abierta, Vencida, Pagada) y, en una segunda fila, **filtros en forma de píldora con «+»** (Estado, Emisión, Vencimiento) y a la derecha «Exportar» / «Editar columnas». Cabecera de tabla fina sin fondo, filas de unos 35 px sin tarjetas, solo líneas separadoras.
- Chips de estado: texto de ~11 px, borde fino del mismo tono y fondo muy pálido (verde pagada, naranja parcial, gris borrador, azul abierta, rojo reintento). Pequeños, rectangulares, radio mínimo.
- Números: importes alineados a la derecha, peso medio, moneda en gris más claro.
- Color: casi todo neutro (blanco, gris azulado, tinta oscura); un único acento violeta para lo activo/primario.
Qué NO cogemos: la barra lateral de producto con muchos grupos (nosotros tenemos 4 capítulos); la columna de correo del cliente; la moneda duplicada «USD/€» sin criterio (confunde).
Capturas: capturas/01-stripe-facturas.png

## 02 · Linear (app real en la portada) — https://linear.app/
Por qué está aquí: referencia de «herramienta rápida» actual: densidad, jerarquía con muy poco color y navegación lateral.
Qué cogemos:
- Composición: barra lateral estrecha con iconos pequeños y texto de ~13 px; grupos con etiqueta gris diminuta (Workspace, Favorites); el elemento activo solo cambia de fondo, sin color. Contenido en columna central y metadatos a la derecha.
- Tipografía: sans geométrica tipo Inter; jerarquía por **peso y gris**, no por tamaño; fechas relativas en gris («2 min ago»).
- Color: fondo casi negro y superficies de 1–2 tonos de gris; el color (amarillo, verde, azul) solo en iconos de estado minúsculos.
- Idea para nuestros capítulos 01–04: navegación lateral con estados como iconos pequeños, no como bloques grandes.
Qué NO cogemos: el tema oscuro (nuestro público trabaja con luz de oficina; claro por defecto); el panel de chat/IA flotante; el titular enorme de la portada.
Capturas: capturas/02-linear-app.png

## 03 · Holded (tesorería y ayuda de compras) — https://www.holded.com/es · https://intercom.help/holded/es/articles/6899952-gestionar-tus-compras
Por qué está aquí: software de contabilidad español de referencia, con nuestro vocabulario (compras, pendiente, vencido, conciliado).
Qué cogemos:
- Tabla de compras (ayuda): columnas **Subtotal · Total · Pendiente · Estado**, importes alineados y estado como píldora (amarillo Pendiente, rojo Vencido); acciones por fila en menú «⋮» a la derecha y selector de columnas en la cabecera.
- Panel de tesorería: bloque de **conciliación** con anillo y tres cifras (Conciliados 84 %, Con factura 62 %, Por revisar 18 %), punto de color + etiqueta + porcentaje alineado a la derecha, y aviso de una línea («3 gastos sin factura»). Etiquetas en mayúsculas pequeñas con tracking.
- Inspira el recuadro «qué necesita atención» del brief: una cifra por categoría, con punto de color.
Qué NO cogemos: las píldoras llenas saturadas (rojo/amarillo plano cansa en 50 filas; mejor chip pálido como Stripe); la tarjeta oscura con degradado y la cuadrícula de logos de bancos; los extras de marketing (botón flotante, avisos de «alguien se acaba de registrar»).
Capturas: capturas/03-holded-tesoreria.png · capturas/03b-holded-ayuda-lista.png

## 04 · Pennylane (conciliación y tesorería) — https://www.pennylane.com/es/
Por qué está aquí: pensado para empresa + asesoría, o sea nuestro doble público (autónomo y gestor).
Qué cogemos:
- Conciliación sugerida: tarjeta «movimiento ↔ factura» con importe grande (200,00 €), proveedor y fecha debajo, y chips lila con icono de destellos para lo **sugerido por la IA** (Desarrollo, Marketing). Sirve para distinguir «lo ha puesto la IA» de «lo has confirmado tú».
- KPI de caja: cifra principal grande (141 537,89 €) y dos mini-cifras con flecha en recuadro (verde sube, rosa baja), barras pareadas ingresos/gastos en tonos pastel.
- Formato español de cifras (espacio como separador de miles, € detrás).
Qué NO cogemos: el verde bosque oscuro de fondo y el marco con sombra desplazada; los textos de relleno de marketing; las fotos de personas.
Capturas: capturas/04-pennylane-conciliacion.png · capturas/04b-pennylane-kpi.png

## 05 · Ramp (presupuesto de proveedores) — https://ramp.com/accounts-payable
Por qué está aquí: panel de KPI + tabla jerárquica con barras de progreso, el tipo de resumen que queremos en «Analiza» y en el trimestre.
Qué cogemos:
- Resumen: anillo con el % (32 % gastado) y a su izquierda tres cifras apiladas con punto de color y etiqueta (Total, Gastado, Comprometido); a la derecha barras mensuales en un solo tono verde desaturado.
- Tabla debajo del gráfico con **barras de utilización finas dentro de la celda** (naranja cuando se pasa): legible sin color de fondo.
Qué NO cogemos: el texto minúsculo (es la maqueta reducida; nuestras cifras deben mantener ≥ 13 px y contraste AA); los avisos de «agente IA» y las ventanas emergentes de captación.
Capturas: capturas/05-ramp-presupuesto.png

## Síntesis · lo común que funciona
1. Tablas sin cajas: cabecera fina, líneas separadoras de 1 px, filas bajas (~35 px), nada de tarjetas por fila.
2. El estado es un **chip pequeño y pálido** (borde fino + fondo suave); el color vive casi solo ahí y el resto es neutro con un único acento.
3. Filtros por estado **arriba como pestañas**, los demás como píldoras, y las acciones de la tabla («Exportar», «Editar columnas», «⋮») a la derecha.
4. Importes alineados a la derecha con cifras tabulares, € en gris más suave, y las magnitudes grandes reservadas a 1–3 KPI.
5. KPI = una cifra grande + 2–3 mini-cifras con punto de color (Holded, Ramp, Pennylane), no una rejilla de tarjetas iguales, con una línea de aviso accionable debajo.
6. Navegación lateral estrecha con texto de ~13 px, jerarquía por peso y gris, y lo que viene de la IA marcado aparte (chip lila con destellos) para que se vea que hay que confirmarlo.
