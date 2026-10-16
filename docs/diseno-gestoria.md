# Diseño: modo gestoría (implementación del backlog de la auditoría)

Fuente: `docs/auditoria-contable.md`. Decisiones del usuario (15/10/2026):
- **Holded:** fichero de importación (sin API).
- **A3:** CSV genérico de asientos con columnas configurables + plantilla A3 «a validar».
- **Banco:** Norma 43 (AEB/CSB43) + CSV genérico.
- **Datos existentes:** las 15 facturas pasan al cliente «Personal».

Orden: **A** (arreglos rápidos + esquema + multicliente + ingesta con desglose) → **B** (fiscal, libro registro, asientos, Excel) → **C** (pagos y banco). La web avanza en paralelo contra estos contratos.

## 1. Datos (Data Tables)

### fact_clientes (nueva)
| columna | tipo | notas |
|---|---|---|
| nombre | string | |
| nif | string | normalizado, sin «ES», mayúsculas |
| regimen_iva | string | `general` · `recargo_equivalencia` · `simplificado` · `particular` (sin derecho a deducir) |
| prorrata_pct | number | 100 por defecto |
| activo | boolean | |
| creado | string | ISO |

Fila inicial: `Personal` · nif `""` · `particular` · 100 · true.

### fact_facturas: columnas nuevas (las existentes no cambian de significado salvo lo dicho)
| columna | tipo | contenido |
|---|---|---|
| cliente_id | number | id de fact_clientes |
| destinatario_nif | string | NIF del destinatario leído en la factura (normalizado) |
| tipo_factura | string | `completa` · `simplificada` · `simplificada_cualificada` · `rectificativa` |
| rectifica_numero | string | nº de la factura rectificada |
| fecha_operacion | string | AAAA-MM-DD (= fecha_emision si no consta) |
| operacion | string | `interior` · `intracomunitaria` · `isp_nacional` · `extracomunitaria` · `importacion` · `exenta` |
| desglose_iva_json | string | JSON `[{base, tipo_iva, cuota_iva, tipo_re, cuota_re}]`, una por tipo |
| base_exenta | number | bases sin IVA (exenta / no sujeta / ISP / intracom.) |
| cuota_re | number | suma de recargo de equivalencia |
| irpf_tipo | number | % retención (0 si no hay) |
| irpf_cuota | number | importe retenido (positivo; negativo en rectificativas) |
| suplidos | number | |
| total_a_pagar | number | total − irpf_cuota |
| cuota_autorrepercutida | number | IVA a autorrepercutir (intracom., ISP, extracom.), 21 % salvo dato |
| nif_valido | boolean | dígito de control (DNI/NIE/CIF); null si extranjero |
| deducible | string | `si` · `no` · `parcial` · `dudoso` · `na` |
| motivo_deducible | string | |
| cuota_deducible | number | IVA (+ autorrepercutida) deducible × prorrata, 0 si no |
| cuenta_gasto | string | PGC, p. ej. `629` |
| cuenta_proveedor | string | `400` (compras 60x) o `410` (resto) |
| tipo_cambio | number | EUR por 1 unidad de moneda (BCE, fecha de emisión); 1 si EUR |
| total_eur | number | total × tipo_cambio |
| num_recepcion | string | correlativo por cliente y año: `2026-000123` |
| estado_pago | string | `pendiente` · `pagada` |
| fecha_pago | string | |
| movimiento_id | number | id de fact_movimientos (conciliación) |

**Compatibilidad:** `base` = Σ bases con IVA + base_exenta; `iva_tipo` = tipo de la base mayor; `iva_cuota` = Σ cuota_iva (sin recargo); `total` = **total de la factura** (no el total a pagar). Los totales del resumen, el asesor y el Excel usan **total_eur**.

### fact_reglas: columnas nuevas
`cliente_id` (null = vale para todos) y `cuenta_gasto`. La regla de cliente prevalece sobre la global.

### fact_categorias: columna nueva
`cuenta_pgc` (cuenta por defecto: Suministros → 628, Seguros → 625, Transporte y combustible → 628, Software y apps → 629, Formación → 629, Impuestos y tasas → 631, resto → 629). Se añaden categorías de empresa: «Compras y materiales» (601), «Mercaderías» (600), «Servicios profesionales» (623), «Alquileres» (621), «Reparaciones y mantenimiento» (622), «Subcontratas» (607), «Publicidad» (627), «Gastos financieros» (626).

### fact_movimientos (nueva, tanda C)
`cliente_id, cuenta (IBAN o nº), fecha, fecha_valor, concepto, importe (− cargos), referencia, factura_id, estado (pendiente|conciliado|ignorado), origen (n43|csv), hash (dedupe), creado`.

## 2. Reglas de negocio (Code, céntimos enteros)

- **Validación** (bloque COMÚN Ingesta/API): Σ(base + cuota_iva + cuota_re) + base_exenta + suplidos = total ±0,02; total − irpf = total_a_pagar ±0,02; total ≠ 0; total < 0 solo si `rectificativa`; fecha no futura; confianza ≥ 0,75 (solo Ingesta).
- **NIF:** DNI (8 dígitos + letra mod 23), NIE (X/Y/Z), CIF (letra + 7 + control). Extranjero (prefijo de país UE ≠ ES, o «EIN»…) → `nif_valido = null`.
- **Deducibilidad** (orden): cliente `particular` → `na` · cliente `recargo_equivalencia` → `no` · `simplificada` sin destinatario_nif → `no` · `nif_valido = false` → `no` (subsanable) · falta número → `no` (subsanable) · categoría restauración/viajes → `dudoso` · sin IVA y sin autorrepercusión → `na` · resto → `si`. `cuota_deducible` = (Σ cuota_iva + cuota_autorrepercutida) × prorrata si `si`.
- **Operación y autorrepercusión:** proveedor con NIF UE no ES y sin IVA → `intracomunitaria`; mención de inversión del sujeto pasivo → `isp_nacional`; proveedor de fuera de la UE sin IVA → `extracomunitaria`. En las tres, cuota_autorrepercutida = base_exenta × 21 % (o el tipo indicado).
- **Cuentas:** regla (cliente → global) > categoría.cuenta_pgc > 629. cuenta_proveedor = 400 si la cuenta empieza por 60, si no 410.
- **Moneda:** si moneda ≠ EUR, tipo de cambio del BCE del día de emisión (o el último hábil anterior): `https://data-api.ecb.europa.eu/service/data/EXR/D.<MON>.EUR.SP00.A?startPeriod=<fecha-7d>&endPeriod=<fecha>&format=csvdata`. El BCE da unidades de moneda por 1 €, así que tipo_cambio = 1/valor. Solo se envían la moneda y la fecha. Si falla: total_eur null, estado `revisar` («sin tipo de cambio»), y los totales excluyen la factura y lo avisan.
- **Recepción:** num_recepcion se asigna al guardar: siguiente correlativo del cliente en el año de fecha_emision.
- **Cliente en la ingesta:** parámetro `cliente_id` (multipart o query). Si falta, se busca el cliente cuyo NIF = destinatario_nif. Si no hay ninguno → cliente «Personal».
- **Modelo Gemini:** principal `gemini-3.5-flash-lite`, respaldo `gemini-3.5-flash` (el principal actual da 429 siempre).

## 3. Contratos de la API (todas con X-API-Key y CORS común; la web usa siempre rutas estáticas con `?id=`)

| Método | Ruta | Parámetros | Respuesta |
|---|---|---|---|
| GET | /clientes | — | `{items:[{id,nombre,nif,regimen_iva,prorrata_pct,activo}]}` |
| POST | /clientes | JSON {nombre,nif,regimen_iva,prorrata_pct} | `{cliente}` (422 si el NIF no es válido o está duplicado) |
| PATCH | /clientes?id= | JSON parcial | `{cliente}` |
| POST | /facturas | multipart `archivo`(s) + `cliente_id` | igual que hoy; `factura` con los campos nuevos |
| GET | /facturas | + `cliente_id`, `q` (busca en proveedor, NIF, número y total: «1161,60» o «1161.60»), `deducible`, `estado_pago`, `vencidas=1`, `tipo_factura`, `orden` (`fecha`,`-fecha`,`total`,`-total`,`proveedor`,`-proveedor`,`vencimiento`) | igual + campos nuevos |
| PATCH | /facturas?id= | + campos nuevos editables: cliente_id, tipo_factura, rectifica_numero, fecha_operacion, operacion, desglose_iva_json (array o string), base_exenta, irpf_tipo, irpf_cuota, suplidos, cuenta_gasto, cuenta_proveedor, deducible (forzado manual), estado_pago, fecha_pago | `{factura, revalidacion, regla}`; recalcula total_a_pagar, cuota_re, deducibilidad, total_eur. Cambiar cuenta_gasto guarda regla proveedor → cuenta (por cliente) |
| PATCH | /facturas/lote | JSON `{ids:[…], cambios:{categoria?, cuenta_gasto?, estado_pago?, fecha_pago?, cliente_id?, estado?}}` | `{actualizadas, errores:[{id,error}]}` (máx. 500) |
| GET | /resumen | + `cliente_id` | igual; totales en EUR; `excluidas_sin_cambio:[ids]` |
| GET | /fiscal | `cliente_id`, `anio`, `trimestre` (1–4) | ver §4 |
| GET | /libro-registro | `cliente_id`, `desde`, `hasta`, `formato=json\|csv` | una fila por factura y tipo (§4) |
| GET | /asientos | `cliente_id`, `desde`, `hasta`, `formato=csv\|a3\|holded` | fichero (CSV `;`, UTF-8 con BOM, decimales con coma) |
| GET | /exportar | + `cliente_id` | XLSX con las hojas nuevas (§5) |
| POST | /banco/importar | multipart `extracto` (n43 o csv) + `cliente_id` | `{importados, duplicados, sugerencias:[{movimiento_id, factura_id, confianza}]}` |
| GET | /banco/movimientos | `cliente_id`, `estado` | `{items:[{id, fecha, concepto, importe, estado, factura_id, sugerencia:{factura_id, proveedor, numero, total, total_a_pagar, confianza} \| null}]}`; la sugerencia es la mejor factura pendiente del cliente: importe = −total_a_pagar (±0,01) y fecha del movimiento ≥ fecha de emisión; confianza mayor si el concepto contiene el proveedor o el número |
| PATCH | /banco/conciliar | JSON `{movimiento_id, factura_id \| null, estado}` | marca la factura pagada (fecha_pago = fecha del movimiento) o deshace |

## 4. Cálculos fiscales (/fiscal)

```
{cliente, periodo:{anio,trimestre,desde,hasta},
 iva_303:{
   interior:[{tipo_iva, base, cuota, cuota_deducible}],          // casillas 28-29 (corrientes)
   recargo:[{tipo_re, base, cuota}],                             // informativo (no deducible)
   intracomunitarias:{base, cuota_devengada, cuota_deducible},   // casillas 10-11 y 36-37
   isp:{base, cuota_devengada, cuota_deducible},                 // casillas 12-13 y 28-29
   total_deducible, no_deducible:[{id, motivo, cuota}]},
 retenciones:{modelo_111:{num_perceptores, base, retencion, detalle[]},
              modelo_115:{num_perceptores, base, retencion, detalle[]}},
 modelo_349:[{nif, nombre, clave:"I", base}],
 modelo_347_anual:[{nif, nombre, total_anual, por_trimestre:[t1,t2,t3,t4]}],   // > 3.005,06 € IVA incl.,
                                                                             // por NIF normalizado, neto de abonos,
                                                                             // excluye operaciones con retención y del 349
 avisos:[…]}
```
Las casillas del 303 se indican solo como referencia («para revisar»): el contable presenta con su programa.

**Libro registro de recibidas** (art. 64.4 RIVA): `num_recepcion, fecha_expedicion, fecha_operacion, numero, nif, nombre, tipo_factura, operacion, base, tipo_iva, cuota_iva, tipo_re, cuota_re, cuota_deducible, total` (una fila por tipo; las exentas o ISP con tipo 0 y su clave).

**Asientos** (CSV genérico; una línea por apunte): `asiento, fecha, cuenta, concepto, debe, haber, documento, nif`. Factura: debe 6xx (base + IVA no deducible + recargo + suplidos si no son 555), debe 472 (cuota deducible), haber 4751 (irpf), haber 400/410 (total a pagar). Intracom./ISP: además debe 472 y haber 477 por la autorrepercutida. **A3** = mismo contenido con la cabecera de plantilla documentada como «a validar». **Holded** = CSV de compras: fecha, nº, proveedor, NIF, concepto, base, % IVA, IVA, % retención, retención, total, cuenta, con una fila por tipo de IVA.

## 5. Excel (/exportar): hojas nuevas

«Libro registro», «IVA trimestre» (303 por tipo, con fórmulas SUMIFS sobre Libro registro), «Retenciones», «347», «Asientos» y «Pendientes de pago». Se mantienen las de antes. Columnas de Facturas: + cliente, tipo factura, operación, retención, total a pagar, deducible, cuenta y estado de pago.

## 6. Web

- **Selector de cliente** en la cabecera (persistente), con «Todos» y alta rápida de clientes.
- **Lista en tabla densa** con orden por columna, casillas y barra de acciones en lote (categoría, cuenta, marcar pagadas, borrar), paginación numerada (50/100/200) y búsqueda única por proveedor, NIF, número o importe. Atajos: `/` buscar, `j`/`k` mover, `e` corregir, `x` seleccionar, `Ctrl+Z` deshacer el último cambio.
- **Formulario de corrección** con líneas de IVA (añadir o quitar tipo), retención, recargo, suplidos, tipo de factura, rectifica a, operación, fecha de operación, cuenta y pago. Validación de importes (B1).
- **Badges:** deducible / no deducible (motivo), NIF inválido, moneda con su equivalente en €, pendiente / vencida / pagada.
- **Nuevo capítulo «Trimestre»:** 303 por tipo, retenciones 111/115, 349, 347 anual, no deducibles y descargas (libro registro CSV, asientos CSV/A3/Holded, Excel).
- **Pagos:** filtros de pendientes y vencidas, importar extracto, sugerencias de conciliación con aceptar/rechazar.

## 7. Notas de implementación (tandas B y C, 2026-10-15)

Detalle en CLAUDE.md («Modo gestoría — tandas B y C»). Desviaciones o precisiones respecto a lo anterior:
- `cliente_id` es **obligatorio** en /fiscal, /libro-registro y /asientos (400 si falta); /fiscal sin `trimestre` = año completo; las facturas cuentan por `fecha_emision` y se incluyen las `revisar` y `posible_duplicada` (con aviso).
- /fiscal añade `num_facturas`, `base_deducible` por tipo, `exentas_no_sujetas`, `casillas_referencia` y `avisos` como `[{codigo, mensaje, ids}]`; `isp` incluye los servicios extracomunitarios (casillas 12-13).
- Libro registro: columna extra `cuota_autorrepercutida`; el `total` de cada fila es base + cuota + recargo (los suplidos no van al libro).
- Asientos: el 6xx se calcula como cuadre (Σ haber − 472) y la factura se excluye si difiere más de 0,02 € del 6xx esperado (cabecera `X-Excluidas`).
- Holded: en lugar de las columnas simplificadas de §4 se usa la **plantilla oficial de facturas de compra** de Holded (una fila por tipo de IVA); Holded calcula el IVA a partir del precio y la clave `p_iva_<tipo>`.
- /banco/importar devuelve además `formato`, `errores` y `avisos`, y cada sugerencia lleva proveedor, número, fecha y totales; en /banco/movimientos `total` y `total_a_pagar` de la sugerencia van en EUR.
