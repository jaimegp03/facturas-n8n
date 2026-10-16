# Finanzas personales: hoja de ruta por fases

Objetivo: ampliar la herramienta de facturas hacia finanzas personales sin romper el modo gestoría. Cada fase es autocontenida y se prueba antes de pasar a la siguiente. Reglas comunes: todo número sale de Code nodes (céntimos enteros), sin LLM salvo redacción controlada, API con `X-API-Key`, copia de las tablas antes de cambiar el esquema.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Calculadora de finiquito (sin datos persistentes) | **Hecha (2026-10-15)** |
| 2 | Sueldo + presupuestos + «Mi dinero» + simulador de nómina | **Hecha (2026-10-15)** |
| 3 | Tickets (compras pequeñas: foto, lectura, categorías personales) | **Hecha (2026-10-15)** |
| 4a | Metas de ahorro + resumen mensual | **Hecha (2026-10-15)** |
| 4b | Ayuda para la renta y deudas/préstamos (**hechas 2026-10-15**); resumen mensual programado por correo (pendiente) | Parcial |
| 5 | Rediseño de la web en dos modos: Personal / Gestoría | Pendiente |
| 6 | Banco automático (PSD2 / Open Banking) | Pendiente |

## Fase 1: finiquito (hecha)
- Workflow `FACT — Finiquito` (`VV4Oty7R5x95CAKV`): `POST /webhook/finiquito`, Header Auth «FACT API Key», CORS con la lista común, errorWorkflow = FACT — Errores. Un único Code «Calcular finiquito» (`n8n/codigo/finiquito.js`), sin LLM ni datos persistentes.
- Web: botón «Finiquito» en la cabecera (`#btnFiniquito`, `#dlgFiniquito`). Con Modo demo no se llama a n8n: la web lleva una copia idéntica de la función (`// === COMÚN Finiquito`, inyectada con `n8n/codigo/inyectar_finiquito_web.py`; si cambias `finiquito.js`, vuelve a ejecutarlo y sube el Code con `actualizar_code.py`).
- Pruebas: `tests/probar_finiquito.py` (27 comprobaciones contra un cálculo independiente en Python con `Fraction`, casos en `tests/casos_finiquito.json`) y `tests/e2e/finiquito.spec.js` (`--project=finiquito`, 5 pruebas, incluida la comparación web = n8n con los mismos casos).

### Criterios de cálculo (limitaciones legales)
Estimación orientativa, sin valor de asesoramiento: el convenio colectivo o el contrato pueden mejorar todo lo siguiente.
- Antigüedad con ambos días incluidos. En la indemnización, el mes incompleto cuenta como mes entero (prorrata por meses).
- Salario diario de la indemnización = anual / 365 (con pagas extra prorrateadas). Vacaciones: valor del día sobre el salario sin pagas extra si no están prorrateadas. Salario del último mes = paga ordinaria / 30 × días trabajados (mes completo = 30).
- Vacaciones devengadas = días anuales × días trabajados del año natural de la baja / días del año, menos las disfrutadas (si es negativo se descuenta, con aviso).
- Pagas extra (si no están prorrateadas): 14 pagas se suponen de verano (1 ene-30 jun) y Navidad (1 jul-31 dic): solo se liquida la del semestre en curso; la tercera paga de 15 se devenga por año natural. Es una hipótesis: las fechas de pago reales dependen del convenio.
- Despido improcedente: 33 días/año, tope 720 días. Contratos anteriores al 12/02/2012: 45 días/año hasta esa fecha + 33 después; si el tramo anterior ya supera 720 días se conserva (tope 42 mensualidades) y no se suma el tramo posterior; si no, tope 720 días del total. El mes incompleto del tramo anterior se imputa al tramo de 45 días.
- Despido objetivo: 20 días/año, tope 12 mensualidades. Fin de contrato temporal y de obra o servicio: 12 días/año (los contratos anteriores a 2015 pueden tener 8 días, solo se avisa). Dimisión, mutuo acuerdo y disciplinario procedente: 0 salvo indemnización pactada (días/año), que se aplica si supera la legal.
- IRPF: indemnización legal exenta en despido improcedente y objetivo hasta el mínimo legal y 180.000 €; el exceso y la pactada tributan. La del fin de contrato temporal, el mutuo acuerdo y lo pactado se tratan como sujetas. La retención usa el porcentaje que da el usuario (no se calcula el tipo real ni la reducción del 30 % de rentas irregulares). Seguridad Social: porcentaje editable (def. 6,5 %) solo sobre el finiquito, no sobre la indemnización.
- No cubre: salarios de tramitación, readmisión, FOGASA, ERE, convenios con cálculos propios, antigüedad con interrupciones, retribución variable o en especie.

## Fase 2: sueldo, presupuestos, «Mi dinero» y simulador de nómina (hecha 2026-10-15)
Workflow `FACT — Mi dinero` (`IqouBXc2YCFH2xEm`), tablas `fact_ingresos` (`Ua1CCVMNjxVBHfJM`) y `fact_presupuestos` (`7QutL5z5jbyFPoYc`), capítulo «05 Mi dinero» y botón «Nómina» en la web. Endpoints y estructura en CLAUDE.md («Fase 2: Mi dinero»). Todo en Code (céntimos enteros, EUR, sin LLM); código en `n8n/codigo/mi_dinero_comun.js`.

### Reglas del cálculo
- **Gasto del mes**: facturas del cliente en estado ok, revisar o posible_duplicada (no borrada ni duplicada) con `fecha_emision` en el mes, en `total_eur`. Sin tipo de cambio (otra moneda): no suma, se avisa y su id va en `excluidas_sin_cambio`. Nunca se suman monedas distintas.
- **Ingresos del mes** (importe = euros netos): mensual cuenta el importe entero cada mes entre `fecha_inicio` y `fecha_fin` (null = indefinido, comparando por mes); anual cuenta importe/12 (redondeado al céntimo) en esos meses; puntual cuenta solo en el mes de `fecha_inicio`. Los ingresos con `activo=false` no cuentan. Vale para cualquier cliente.
- **Balance** = ingresos − gasto. **Tasa de ahorro** = balance / ingresos (1 decimal; null si no hay ingresos).
- **Presupuesto** por categoría (nombre exacto de `fact_categorias`): consumido = gasto de esa categoría; restante = límite − consumido (puede ser negativo); % = consumido/límite (1 decimal); estado `ok` por debajo del 80 %, `aviso` desde el 80 % (incluido) hasta el 100 % (incluido), `superado` por encima del límite. Con límite 0 hay `superado` si hay gasto. Las categorías con gasto y sin presupuesto se listan en `sin_presupuesto`.
- **Comparación**: media (redondeada) del gasto de los 3 meses anteriores al pedido, total y por categoría.
- **Regla 50/30/20**: necesidades ≤ 50 % de los ingresos, deseos ≤ 30 %, ahorro ≥ 20 % (objetivos sobre los ingresos del mes: 50 % y 30 % redondeados y el ahorro es el resto). Real: necesidades y deseos = gasto de las categorías de cada grupo; ahorro = max(balance, 0). Necesidades: Agua, Luz, Gas, Telefonía e internet (y «Suministros», categoría antigua, por compatibilidad), Seguros, Alimentación y supermercado, Transporte y combustible, Salud y farmacia, Hogar, Formación, Impuestos y tasas y las categorías de empresa (Compras y materiales, Mercaderías, Servicios profesionales, Alquileres, Reparaciones y mantenimiento, Subcontratas, Publicidad, Gastos financieros). Deseos: Ropa y calzado, Videojuegos y ocio digital, Streaming y música, Software y apps, Restaurantes y comida a domicilio, Deporte y gimnasio, Tecnología y electrónica, Viajes y Otros. Una categoría nueva no listada cuenta como deseos y se avisa (`categorias_sin_mapa`). El mapa está en `MD_NECESIDADES` / `MD_DESEOS`.
- **Previsión de fin de mes** (solo si el mes pedido es el actual): gasto acumulado + recurrentes pendientes + gasto variable del resto del mes. Recurrente pendiente = para cada `proveedor_norm` con facturas suscripción/contrato y periodicidad conocida, su última factura, si sigue activa (días desde la última ≤ intervalo + margen, margen = mitad del intervalo entre 10 y 45 días), no está ya en este mes y su siguiente fecha (última + periodo) cae en el mes o antes; su importe es el de la última factura. Gasto variable = lo no recurrente acumulado; resto = variable × días restantes / días transcurridos (incluido hoy). Limitaciones: los recurrentes semanales cuentan una sola vez; a principios de mes (< 7 días) la previsión variable es poco fiable y se avisa.
- **Alertas** (plantillas): presupuesto superado (error), ≥ 80 % (aviso), balance negativo (error), previsión por encima de los ingresos (aviso), gasto > media 3 meses + 25 % y + 10 € (aviso), gasto sin presupuesto, necesidades por encima del 50 %, sin ingresos, sin presupuestos (info).
- **Simulador de nómina**: bruto mensual = bruto anual / 12 (12 pagas o 14 prorrateadas) o / 14 (14 pagas sin prorrateo, con 2 pagas extra de igual importe); SS = bruto × ss_pct (def. 6,5 %), IRPF = bruto × irpf_pct, neto = bruto − SS − IRPF − otros descuentos mensuales (los otros solo en las 12 nóminas ordinarias). Neto anual = 12 nóminas + 2 pagas extra netas. Es una estimación: no usa bases ni topes de cotización ni la tabla real de retenciones del IRPF (hijos, situación familiar…).
- Pruebas: `tests/probar_mi_dinero.py` (89) y `tests/e2e/mi_dinero.spec.js` (5; incluye la paridad web = n8n).

## Fase 3: tickets
**Hecha (2026-10-15).** Subida rápida de tickets desde móvil usando la Ingesta con un cliente «Personal», categorías personales y asignación por reglas. Detalle en CLAUDE.md, «Tickets de compra (fase 3)».
- Hecho: botón «Hacer foto» (cámara del móvil), líneas del ticket en el detalle, hora, propina/redondeo, ticket sin NIF ni número, borroso ⇒ revisar, duplicado de ticket sin número (proveedor + fecha + total + hora), demo con 8 tickets.
- Límites: un ticket sin tabla de IVA ni tipo (solo el total) queda en «revisar» (no se inventa el IVA); la propina se guarda como suplido; la hora es solo informativa y se guarda desde ahora (los tickets anteriores no la tienen); dos tickets idénticos sin hora legible se marcan como posible duplicada; el límite de 40 líneas recorta tickets enormes; no hay detección de varios tickets en una foto; categoría por línea (no por ticket) queda para más adelante. Probado con 6 llamadas a Gemini reales (sin la gasolinera ni el ticket rotado suelto).

## Fase 4: metas, alertas, previsión, renta y deudas
**4a hecha (2026-10-15)**: metas de ahorro (`fact_metas`, `/metas`, `/metas/aportar`) y `/resumen-mensual` con texto para copiar; reglas, estados y reparto del ahorro libre sin doble contabilidad en CLAUDE.md «Fase 4a». Las alertas y la previsión ya existían en «Mi dinero» (fase 2). **4b pendiente**: borrador de renta (IRPF), seguimiento de deudas/préstamos y envío programado del resumen mensual por correo (Schedule + Gmail con el `texto`; no hecho).

## Fase 5: rediseño modo Personal / Gestoría
Interruptor de modo que muestre solo lo relevante (personal: mi dinero, presupuestos, tickets; gestoría: clientes, fiscal, banco). Mantener el contrato de la web (ids, aria, hover) y las pruebas.

**Hecho (parcial, 2026-10-15): vista aparte.** «Mi dinero» ya no es el capítulo 05: es una vista del mismo `index.html` (`#/mi-dinero/<sección>`: resumen, ingresos, metas, deudas, renta, herramientas) con selector «Facturas | Mi dinero» en la cabecera; Facturas conserva los capítulos 01-04. **Pendiente:** cambiar el nombre/marca «Facturas» por algo más general (la herramienta ya no es solo de facturas) y, si se decide, un modo Gestoría separado (clientes, fiscal, banco) como tercera vista.

## Fase 6: banco automático (PSD2)
Sustituir la importación manual N43/CSV por conexión Open Banking con un agregador autorizado. Requiere proveedor, consentimiento del usuario y gestión de credenciales fuera del repositorio.

### Fase 4b, etapa 1: ayuda para la renta (hecha 2026-10-15)
`GET /renta?cliente_id&anio` en «FACT — Mi dinero» y tarjeta «Renta» en el capítulo 05. Resume el año para llevarlo a la gestoría: ingresos (nóminas anualizadas con los meses activos), gasto por categoría, retenciones de IRPF soportadas en facturas, conceptos con posible tratamiento fiscal (tabla `RENTA_CONCEPTOS`, todo «A revisar con tu gestor»), facturas que conviene corregir antes (por revisar, sin archivo, NIF inválido), texto copiable y CSV de gastos. Orientativo: no presenta nada ni sustituye a la declaración; no promete ahorro fiscal. Limitaciones: las retenciones y cotizaciones de la nómina no se conocen; los gastos de salud o formación en general no deducen en la renta de un asalariado (solo se informan); no se calcula ni la cuota ni el resultado de la declaración. Detalle en CLAUDE.md «Fase 4b etapa 1».

### Fase 4b, etapa 2: deudas y préstamos (hecha 2026-10-15)
Tabla `fact_deudas`, endpoints `/deudas`, `/deudas/simular` y `/deudas/resumen` en «FACT — Mi dinero» y tarjeta «Deudas y préstamos» en el capítulo 05. Cuota por sistema francés (o la indicada), capital pendiente a hoy, intereses pagados y por pagar, fecha de fin, efecto de una amortización extra (reducir plazo o cuota) y carga mensual sobre los ingresos con aviso por encima del 35 %. Limitaciones: orientativo (sin comisiones, seguros vinculados ni revisiones de tipo variable: el interés es fijo); las tarjetas revolving se tratan como un préstamo simple; las amortizaciones anticipadas ya hechas se resumen en `amortizado_extra` (se aplican hoy, no en su fecha real); el día de pago fija todas las fechas. Detalle en CLAUDE.md «Fase 4b etapa 2».

### Siguiente fase propuesta: Comparador de mercado (idea, 2026-10-16)
Las categorías Agua, Luz, Gas y Telefonía e internet (2026-10-16) son la base. Haría falta: (1) un catálogo propio de tarifas (tabla con compañía, plan, tipo de suministro, precio, fecha de vigencia y fuente, mantenido a mano o por importación); (2) extraer de las facturas el consumo (kWh, potencia contratada, m³, GB/tarifa de telefonía) como campos nuevos de la Ingesta; (3) comparar en Code el coste anual actual con el de cada tarifa del catálogo. Sin LLM en las cifras: el modelo solo extrae el consumo y, como mucho, redacta el resultado.
