# Auditoría contable de «Facturas» (web + n8n)

**Fecha:** 15/10/2026 · **Perfil evaluado:** gestoría con varios clientes (autónomos y pymes), solo facturas **recibidas**, exportación genérica (CSV/Excel) + A3 + Holded.
**Método:** 27 facturas TEST con casos contables reales, de las que 10 se ingirieron de verdad con Gemini y 17 se cargaron como filas sintéticas (16 más una duplicada); tareas reales del contable en Chrome a 1920×1080 con Playwright; 520 filas extra para rendimiento. Todas las cifras de este informe salen de un fichero de `tests/salida/auditoria-contable/` o de un test que se cita.

---

## 1. Resumen ejecutivo

1. **Hoy no le sirve a un contable para cerrar un trimestre.** Lee bien los datos de cabecera (proveedor, NIF, número y fechas: 10/10), pero el modelo de datos guarda **una sola base y un solo tipo de IVA por factura**. No guarda retenciones, recargo, suplidos, tipo de factura, cliente, deducibilidad, cuenta contable ni pagos.
2. Ninguna de las tareas fiscales clave (303, 111/115, 347, libro registro, asientos) se puede hacer dentro de la web. Todas obligan a exportar a Excel y rehacer cálculos a mano. 7 de las 10 facturas ingeridas acabaron en «revisar», en su mayoría por limitaciones del modelo y no porque la factura estuviera mal.
3. **Los 3 cambios con más impacto:**
   - **Desglose fiscal por factura:** líneas de IVA por tipo, retención, recargo, suplidos, tipo de factura y operación, con extracción y validación coherentes.
   - **Multicliente:** separar los datos por cliente de la gestoría, con reglas y Excel por cliente.
   - **Exportaciones contables:** libro registro de recibidas, resúmenes 303/111/115/347/349 y asientos PGC para A3/Holded/CSV.

---

## 2. Inventario (Fase 1)

### 2.1 Qué permite la web hoy

| Función | Dónde en la web | Endpoint (n8n) | Campos que usa |
|---|---|---|---|
| Subir facturas (varias, arrastrar) | 01 Sube | `POST /facturas` (FACT — Ingesta) | archivo → todos los de la factura |
| Listar y filtrar | 02 Clasifica | `GET /facturas` | desde, hasta, proveedor (subcadena), categoria, tipo, estado, pagina |
| Ver detalle y original | 02, al abrir la fila o en la vista previa lateral | `GET /archivo?id=N` | archivo_ruta, mime + los de la fila |
| Corregir una factura | 02, «Corregir» | `PATCH /facturas?id=N` | proveedor, nif, numero, fechas, base, iva_tipo, iva_cuota, total, categoría, subcategoría, tipo, periodicidad |
| Aprender categoría por proveedor | al corregir la categoría | `PATCH` → fact_reglas | proveedor_norm → categoría |
| Borrar (lógico) | 02, «Borrar» | `DELETE /facturas?id=N` | estado = borrada |
| KPIs y gráficos | 03 Analiza | `GET /resumen` | total, por categoría, por mes, top 5 proveedores, recurrentes |
| Recomendaciones de ahorro | 04 Exporta | `POST /asesor`, `GET /recomendaciones` | totales y recurrentes |
| Excel | 04 Exporta | `GET /exportar` | 5 hojas: Resumen, Facturas, Por mes, Suscripciones, Recomendaciones |

### 2.2 Modelo de datos de una factura (`fact_facturas`)

`id, usuario_id, hash_sha256, archivo_ruta, archivo_nombre, mime, proveedor, proveedor_norm, nif, numero, fecha_emision, fecha_vencimiento, lineas_json, base, iva_tipo, iva_cuota, total, moneda, metodo_pago, categoria, subcategoria, tipo_gasto (puntual|suscripcion|contrato), periodicidad, confianza, motivo, estado (ok|revisar|posible_duplicada|borrada), errores_validacion, origen_categoria, creado, actualizado`.

**Lo que no existe:**
- varias bases y cuotas por tipo de IVA;
- recargo de equivalencia;
- retención (tipo y cuota) y total a pagar;
- suplidos;
- fecha de operación;
- tipo de factura (completa, simplificada o rectificativa) y factura que rectifica;
- tipo de operación (interior, intracomunitaria, ISP, extracomunitaria) y cuota autorrepercutida;
- deducibilidad;
- cliente o empresa de la gestoría, con su NIF;
- cuenta contable de gasto y de proveedor;
- trimestre;
- estado, fecha y medio de pago;
- tipo de cambio.

Evidencia: el PATCH de esos campos devuelve **400 «Campos no permitidos»** (`patch_modelo_datos.json`).

---

## 3. Requisitos contables usados (Fase 2) y fuentes oficiales

| Requisito | Fuente |
|---|---|
| Datos obligatorios de factura completa (número y serie, fechas de expedición y operación, NIF y domicilio, base, tipo, cuota, menciones de exención e ISP) | RD 1619/2012, art. 6 — [BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) |
| Factura simplificada: límites de 400 € y 3.000 €; para deducir, NIF y domicilio del destinatario y cuota desglosada | RD 1619/2012, arts. 4 y 7.2 — [BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696); [AEAT · Facturas simplificadas](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/folleto-actividades-economicas/5-impuesto-sobre-valor-anadido/5_10-facturas/5_10_6-facturas-simplificadas.html) |
| Rectificativas: identificar la factura rectificada y la rectificación | RD 1619/2012, art. 15 — [BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) |
| Libro registro de recibidas: nº de recepción, fechas de expedición y operación, NIF, base, tipo y cuota; asientos resumen limitados | RIVA, art. 64.4 — [AEAT · Contenido LRFR](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-iva-2023/capitulo-10-obligac-formales-suj-registro/obligaciones-materia-libros-registro-iva/libros-registro-iva/libro-registro-facturas-recibidas/contenido-lrfr.html) |
| Retención del 15 % (profesionales), 7 % (inicio de actividad: año de inicio y dos siguientes), 19 % (alquiler de inmueble urbano) | LIRPF art. 101.5 a) y 101.8; RIRPF arts. 95 y 100 — [AEAT · Cuadro de tipos 2025](https://sede.agenciatributaria.gob.es/static_files/Sede/Programas_ayuda/Retenciones/2025/Cuadro_tipos_retenciones_IRPF2025.pdf) |
| Recargo de equivalencia: 5,2 / 1,4 / 0,5 % | LIVA art. 161 — [AEAT · Tipos del recargo](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-iva-2024/capitulo-06-regimenes-especiales-iva/regimen-especial-recargo-equivalencia/tipos-recargo-equivalencia.html) |
| 303: adquisiciones intracomunitarias (casillas 10–11), otras ISP (12–13) | [AEAT · Instrucciones 303 (2025)](https://sede.agenciatributaria.gob.es/Sede/todas-gestiones/impuestos-tasas/iva/modelo-303-iva-autoliquidacion_/instrucciones-2025.html) |
| 349: adquisiciones intracomunitarias de servicios, clave I | [AEAT · Modelo 349](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-iva-2025/capitulo-09-declaraciones-informativas-iva-379/declaracion-recapitulativa-operac-intracomunitarias-modelo-349.html) |
| 347: más de 3.005,06 € al año (IVA incluido) por tercero, neto de devoluciones | RGAT arts. 31–33 — [AEAT · Modelo 347](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/folleto-actividades-economicas/8-declaraciones-informativas/8_2-declaracion-anual-operaciones-terceros-347.html) |
| Cuentas PGC (600–629, 472, 4751, 400, 410) | RD 1514/2007 — [BOE-A-2007-19884](https://www.boe.es/buscar/act.php?id=BOE-A-2007-19884) |

Los tipos y umbrales se verificaron en las páginas citadas el 15/10/2026. El cuadro de retenciones más reciente localizado es el de 2025.

---

## 4. Resultados por tarea (Fase 4)

Clics y teclas medidos con Playwright a 1920×1080 (`tests/e2e/auditoria_contable.spec.js`, salida en `uso_metricas.json` y capturas en `tests/salida/auditoria-contable/`). Los tiempos son de la máquina, no de una persona.

| # | Tarea | ¿Se puede? | Esfuerzo medido | Evidencia |
|---|---|---|---|---|
| 1 | Lote de 20–30 facturas | **A medias** | 1 arrastre. **5,5 s por factura** (55,1 s para 11), de los que unos 3,5 s se pierden en un 429 del modelo principal antes de pasar al de respaldo. 7 de 10 quedan en «revisar». | `ingesta_resumen.json` |
| 2 | Revisar y corregir las «revisar» | **A medias** | 1 clic para filtrar, y por factura 3 clics + las teclas del campo; guardar tarda 0,9 s. Pero 6 de los 7 casos **no se pueden arreglar**: no hay dónde poner la retención, el recargo o los suplidos, y un total negativo nunca valida. | `uso_metricas.json` (T2), `T2_revisar_*.png` |
| 3 | IVA soportado por tipo (303) | **No** | La web no lo muestra. El Excel tiene un solo tipo por factura: TEST_01, con bases al 21, 10 y 4 %, sale entera al 21 %. Exige salir a Excel y recalcular a mano. | `T3_resumen_trimestre.png`, `precision_extraccion.json` |
| 4 | Retenciones (111/115) | **No** | No hay campo. La factura de alquiler (TEST_04) guarda 1.020 € (lo que se paga) en vez de 1.210 €, y la retención de 190 € se pierde. | `ingesta_resumen.json`, `patch_modelo_datos.json` |
| 5 | Modelo 347 (> 3.005,06 €) | **A medias** | Solo hay un top 5 de proveedores agrupado por nombre. Hay que montarlo en Excel agrupando por NIF, sin normalizar, y restar los abonos. | `resumen_3T.json`, hoja Facturas |
| 6 | Libro registro de recibidas | **A medias** | El Excel tiene fecha, número, NIF, base, tipo y cuota. Faltan el nº de recepción correlativo, la fecha de operación (TEST_14) y una línea por tipo de IVA. | `Gastos_3T.xlsx` |
| 7 | Detectar facturas no deducibles | **No** | No hay campo de deducibilidad ni reglas. El ticket sin NIF del destinatario (TEST_06) queda en «revisar» por otra razón (no trae base) y nada avisa de que no deduce. Los NIF no se validan. | `ingesta_resumen.json` |
| 8 | Rectificativas y abonos | **No** | El total negativo da «revisar» («debe ser mayor que 0») y no se puede guardar la factura que rectifica. | `patch_modelo_datos.json`, T2 |
| 9 | Moneda extranjera, intracomunitarias, ISP | **No** | Los **99 USD se suman como 99 €** en el resumen (comprobado: 05/07/2026 = 26,06 + 99 + 13,99 = 139,05). Las intracomunitarias y las ISP se guardan como gasto sin IVA y sin cuota autorrepercutida. | `ingesta_resumen.json`, consulta en vivo |
| 10 | Vencimientos y pagos | **No** | No hay filtro por vencimiento ni estado de pago. Solo el asesor avisa de lo que vence en los próximos 15 días. No hay conciliación bancaria. | `T10_vencimientos.png`, `uso_metricas.json` |
| 11 | Exportar asientos PGC (A3, Holded) | **No** | No hay cuentas contables ni exportación de asientos. Las categorías son de gasto personal: materiales de obra y alquiler de local caen en «Hogar»; honorarios de abogado en «Formación». | `ingesta_resumen.json`, KPI «Hogar 59,5 %» en `T3_resumen_trimestre.png` |
| 12 | Encontrar una factura y abrir el original | **A medias** | Por proveedor sí: 5 resultados en 0,9 s y el original se ve al pasar el ratón. **Por NIF, nº de factura o importe: 0 resultados.** | `uso_metricas.json` (T12), `T12_busqueda.png` |
| — | Varios clientes (gestoría) | **No** | No hay selector ni campo de cliente. Todo se mezcla en un único `usuario_id = default`. | `uso_metricas.json` (volumen) |

**Productividad en volumen** (`uso_metricas.json`, `rendimiento_*`):
- No hay acciones en lote (0 casillas), ni orden por columnas, ni deshacer, ni atajos más allá de ↑/↓ en la lista.
- Con 560 facturas, la web carga en **0,97 s**, pero ver la lista completa exige **18 pulsaciones de «Cargar más»** (14,8 s).
- La API escala bien: con 13 veces más filas, el tiempo sube entre 1,5 y 2,3 veces; `/exportar` pasa de 183 a 430 ms (`rendimiento_api.json`).

**Accesibilidad:** axe-core (WCAG 2.1 AA) no encuentra **ninguna violación** (`axe.json`).

**Salidas de la web** por trimestre:
- Excel, para el 303, el 347 y el libro registro.
- Hoja o calculadora propia, para las retenciones.
- Extracto del banco, para los pagos.
- Programa contable, para los asientos.

---

## 5. Precisión de la extracción (10 facturas ingeridas con Gemini)

`tests/auditoria/precision_extraccion.py` → `precision_extraccion.json`

| Campo del esquema | Aciertos |
|---|---|
| Proveedor | 10/10 |
| NIF | 10/10 |
| Nº factura | 10/10 |
| Fecha de emisión | 10/10 |
| Vencimiento | 10/10 |
| Moneda | 10/10 |
| Base imponible | 9/10 |
| Cuota (IVA + recargo) | 8/10 |
| Tipo de IVA | 8/10 |
| **Total de factura** | **6/10** |
| **Global** | **91/100** |

**Errores típicos.** El modelo lee bien. Los fallos vienen de pedirle meter la factura en un esquema que no cabe:
- Con retención o suplidos (TEST_02, 04, 08 y 15) guarda en `total` el **total a pagar**, no el total de la factura. Por eso no cuadra y queda en «revisar».
- Con varios tipos (TEST_01 y 05) guarda solo un tipo; con recargo, la cuota no lo incluye.
- En el ticket con IVA incluido (TEST_06) no calcula base ni cuota.

**Datos contables que el esquema no guarda** (nº de facturas afectadas, de 10):

| Dato | Facturas |
|---|---|
| Deducibilidad | 10 |
| Cliente | 10 |
| Cuenta contable | 10 |
| Pago | 10 |
| Retención | 4 |
| Varias bases | 2 |
| Tipo de factura | 2 |
| Operación especial | 2 |
| Autorrepercusión | 2 |
| Recargo | 1 |
| Suplidos | 1 |
| Rectificada | 1 |

---

## 6. Bugs encontrados

| # | Bug | Pasos para reproducir | Gravedad |
|---|---|---|---|
| B1 | **Un importe no numérico se guarda como 0** | Corregir → Total = «abc» → Guardar. Se envía `total: 0`, el formulario se cierra y la factura pasa a «revisar» con total 0. Debería avisar y no guardar. Test: «Accesibilidad y mensajes de error». | Alta (corrompe datos) |
| B2 | **Se suman monedas distintas** | Subir una factura en USD (TEST_11) → `/resumen`, gráficos y Excel suman 99 USD como 99 €. | Alta |
| B3 | **`total` guarda el total a pagar** cuando hay retención o suplidos | Subir TEST_02, 04 o 15 → total 530 / 1.020 / 151,40 en vez de 605 / 1.210 / 158,90, y estado «revisar». | Alta |
| B4 | El recargo de equivalencia hace fallar la validación | TEST_05 → «Base 500 + IVA 72 ≠ 586,60». La factura es correcta. | Media |
| B5 | Ticket con IVA incluido sin base ni cuota | TEST_06 → «falta base imponible y cuota de IVA». Se podrían calcular a partir del tipo indicado. | Media |
| B6 | Las rectificativas nunca validan | TEST_08 o PATCH con total negativo → «El total debe ser mayor que 0». | Media |
| B7 | Se pierden tipos de IVA | TEST_01 (21 + 10 + 4 %) → `iva_tipo = 21`. | Alta (303) |
| B8 | El modelo principal falla siempre | Todas las ingestas desde el 14/10: `gemini-3.5-flash` → 429 y paso al respaldo. Suma unos 3,5 s por factura. | Baja (rendimiento) |
| B9 | La búsqueda solo mira el proveedor | Buscar «B9045612», «MCL-26-02210» o «1161,60» → 0 resultados. | Media |

---

## 7. Necesidades detectadas

Cada necesidad sale de una tarea fallida o de un requisito citado. **Esfuerzo:** S < 1 día · M de 1 a 5 días · L > 1 semana. Los ahorros son estimaciones razonadas, no medidas con contables.

**N1 · Desglose fiscal de la factura** (tareas 3, 4, 6, 7, 8 y 9; bugs B3–B7)
- *Problema:* una base y un tipo por factura. Retención, recargo y suplidos no caben, y 6 de 10 facturas reales se guardan mal o quedan en «revisar».
- *Propuesta:*
  - **Data Tables:** nueva tabla `fact_lineas_iva` con factura_id, base, tipo_iva, cuota, tipo_re y cuota_re. En `fact_facturas`: irpf_tipo, irpf_cuota, suplidos, total_a_pagar, fecha_operacion, tipo_factura, rectifica_id/numero y operacion (interior/intracomunitaria/isp/extracomunitaria/importación).
  - **n8n:** ampliar el `responseSchema` de la Ingesta. La validación pasa a ser Σ(base + cuota + RE) + suplidos = total, y total − retención = a pagar. Admitir totales negativos si `tipo_factura = rectificativa`.
  - **Web:** formulario con líneas de IVA y retención.
- *Ahorro:* elimina la mayoría de las revisiones manuales (7/10 → estimadas 1–2/10). Sin esto no se puede hacer ninguna declaración.
- *Esfuerzo:* **L** · *Riesgo:* migrar los datos existentes (una línea por factura) y mantener `/resumen` y el Excel. Es requisito de N3, N4 y N6.

**N2 · Multicliente (gestoría)** (tarea «varios clientes»)
- *Problema:* todo va en un único `usuario_id`.
- *Propuesta:*
  - **Data Tables:** tabla `fact_clientes` (NIF, nombre, régimen IVA —general / RE / simplificado—, prorrata, plan de cuentas); `cliente_id` en facturas y reglas.
  - **Ingesta:** asignar el cliente por el NIF del destinatario de la factura, extraído por Gemini, o por selector al subir.
  - **Web:** selector de cliente persistente.
- *Ahorro:* evita mezclar datos entre clientes y permite un Excel por cliente. Sin esto no es usable en una gestoría.
- *Esfuerzo:* **M** · *Riesgo:* privacidad entre clientes; un token por usuario si hay varios empleados.

**N3 · Informes fiscales: 303, 111/115, 347 y 349** (tareas 3, 4, 5 y 9)
- *Problema:* hoy se calculan a mano en Excel.
- *Propuesta:* endpoint `/fiscal?cliente&trimestre` calculado en Code a partir de N1:
  - IVA soportado deducible por tipo, intracomunitario e ISP, con las casillas del 303;
  - retenciones por modelo;
  - 347 anual agrupado por NIF normalizado y neto de abonos;
  - 349 clave I.
  - Pestaña «Trimestre» en la web y hojas en el Excel.
- *Ahorro:* la parte de recálculo del cierre trimestral.
- *Esfuerzo:* **M** · *Depende de:* N1, N2 y N5.

**N4 · Libro registro de facturas recibidas** (tarea 6; art. 64.4 RIVA)
- *Propuesta:* hoja y CSV con nº de recepción correlativo por cliente y año, fechas de expedición y operación, NIF, nombre, una línea por tipo, cuota deducible y clave de operación.
- *Esfuerzo:* **S** una vez hecho N1.

**N5 · Deducibilidad y validación formal** (tarea 7; arts. 6 y 7.2 RD 1619/2012)
- *Propuesta:* reglas en Code que marcan `deducible = sí / no / dudoso` con su motivo:
  - simplificada sin NIF del destinatario;
  - destinatario en recargo de equivalencia;
  - **NIF/CIF con dígito de control erróneo**;
  - falta el número;
  - restauración: dudoso.
  - Filtro «no deducibles» en la web.
- *Ahorro:* evita deducir IVA que no se puede deducir, que es un riesgo de sanción.
- *Esfuerzo:* **S–M**.

**N6 · Exportación contable: asientos PGC para CSV, A3 y Holded** (tarea 11)
- *Propuesta:*
  - cuenta de gasto por regla proveedor → cuenta, en lugar de las categorías personales;
  - 400 o 410 según sea compra o servicio;
  - asiento con 6xx al debe, 472 al debe, 4751 al haber y 400/410 al haber.
  - Exportar CSV genérico, plantilla de importación de A3 e importación por API de Holded.
- *Esfuerzo:* **M** (CSV) a **L** (A3 + Holded). *Riesgo:* los formatos de A3 y Holded hay que validarlos contra su documentación oficial y una cuenta de prueba **antes** de construir; no se han verificado en esta auditoría.

**N7 · Pagos y conciliación** (tarea 10)
- *Propuesta:*
  - campos estado_pago, fecha_pago y medio;
  - filtros «pendientes» y «vencidas»;
  - importar el extracto (CSV del banco) y casar por importe, fecha y proveedor.
- *Esfuerzo:* **M** sin conciliación, **L** con ella.

**N8 · Trabajo en volumen** (productividad, tarea 12, B9)
- *Propuesta:*
  - búsqueda por NIF, número e importe;
  - tabla densa con orden por columna;
  - selección múltiple para cambiar la categoría o la cuenta, marcar como pagada o borrar;
  - paginación numerada en lugar de 18 pulsaciones de «Cargar más»;
  - deshacer el último cambio;
  - atajos (J/K, E para editar, / para buscar).
- *Esfuerzo:* **M**.

**N9 · Corrección de bugs B1, B2, B8 y B9**
- *Propuesta:*
  - validar los importes en la web (B1);
  - excluir o convertir las monedas distintas del euro con el tipo del BCE de la fecha y avisar (B2);
  - fijar el modelo de respaldo como principal mientras el principal dé 429 (B8);
  - ampliar la búsqueda (B9).
- *Esfuerzo:* **S** cada uno.

---

## 8. Backlog priorizado

**Tanda 1 · rápidas (menos de 1 día cada una)**
1. B1: validar los importes en la web.
2. B2: no sumar monedas distintas; aviso y conversión con el tipo del BCE.
3. B8: modelo principal = flash-lite, para ahorrar unos 3,5 s por factura.
4. B9 / N8 (parte): búsqueda por NIF, número e importe.
5. N5 (parte): validar el dígito de control del NIF/CIF y marcar como no deducibles las simplificadas sin NIF del destinatario.

**Tanda 2 · medianas (1 a 5 días)**
6. N2: multicliente.
7. N7 (sin conciliación): estado y fecha de pago, filtros de pendientes y vencidas.
8. N8: tabla con orden, selección múltiple y paginación.
9. N6 (CSV genérico): asientos PGC con reglas proveedor → cuenta.

**Tanda 3 · grandes (más de 1 semana)**
10. N1: desglose fiscal, con migración y nueva extracción. **Es la base de todo lo demás.**
11. N3 + N4: informes 303/111/115/347/349 y libro registro.
12. N6 (A3 y Holded) y N7 (conciliación bancaria).

N1 es grande pero desbloquea N3, N4 y N6. Si solo se puede abordar una cosa grande, es esta.

---

## 9. Lo que NO recomiendo

- **Presentar los modelos directamente a la AEAT o enviar al SII desde aquí.** La responsabilidad y la complejidad (certificados, formatos, rectificaciones) no compensan; el contable ya presenta con su programa. Basta con entregarle los datos cuadrados.
- **Mantener las categorías de gasto personal** («Hogar», «Ropa»…) para clientes empresa. Engañan: los materiales de obra y el alquiler del local salieron como «Hogar», un 59,5 % del trimestre. Deben convivir con cuentas PGC o sustituirse por ellas en el modo gestoría.
- **Confiar en el asesor de ahorro para una gestoría.** Está pensado para gasto personal y sus «suscripciones» mezclan alquileres y contratos de empresa (recurrente 2.662,56 €/mes en el 3T).
- **Convertirlo en un programa de contabilidad completo** (balances, amortizaciones, cierres). Ese trabajo ya lo hacen A3 o Holded; el valor de esta web está en capturar y validar.
- **Aumentar la cuota de Gemini como solución a los «revisar».** Los fallos no son de lectura (cabecera 10/10) sino del modelo de datos.

---

## 10. Datos de la prueba y limpieza

- **Datos TEST:**
  - 26 facturas en `fact_facturas`: ids 16–31 sintéticas y 32–41 ingeridas;
  - 520 filas de rendimiento;
  - originales en `C:\Users\GOMEZ\facturas-almacen` (archivos `TEST_*`).
- **Copia previa:** `tests/salida/backup-2026-10-15/`.
- **Tests añadidos:**
  - `tests/facturas_contables.py`, que `generar_facturas.py --contables` invoca;
  - `tests/auditoria/{backup_tablas,comparar_backup,precision_extraccion,rendimiento_api}.py`;
  - `tests/e2e/auditoria_contable.spec.js`, que se lanza con `npx playwright test --project=auditoria`.
- **Gemini:** 10 ingestas = 10 respuestas de `gemini-3.5-flash-lite` y 10 intentos del modelo principal rechazados con 429, que no consumen cuota. Ninguna otra llamada.

---

## 11. Estado tras la implementación (15/10/2026)

Implementado todo el backlog (diseño en `docs/diseno-gestoria.md`). Sin cambios en los importes de las 15 facturas existentes, que pasan al cliente «Personal».

| Punto | Estado | Prueba |
|---|---|---|
| B1 importe no numérico guardado como 0 | Corregido (web y API, 422) | `gestoria.spec.js` «B1» |
| B2 sumar monedas distintas | Corregido: tipo BCE, `total_eur`; sin tipo → se excluye y se avisa | `probar_gestoria_a.py` |
| B3–B7 total a pagar, recargo, ticket, rectificativas, varios tipos | Corregidos con el desglose fiscal | `probar_gestoria_a.py` |
| B8 modelo principal con 429 | Principal flash-lite, respaldo flash | ingestas reales: 6/6 a la primera |
| B9 / N8 búsqueda, orden, lote, paginación, deshacer, atajos | Hecho | `gestoria.spec.js` |
| N1 desglose fiscal | Hecho (JSON por factura en vez de tabla aparte; ver diseño §7) | `probar_gestoria_a.py`, `_b.py` |
| N2 multicliente | Hecho (`fact_clientes`, selector, asignación por NIF del destinatario) | `gestoria.spec.js` «cliente» |
| N3 303 / 111 / 115 / 349 / 347 | Hecho (`/fiscal`), cuadra con un cálculo independiente | `probar_gestoria_b.py` 111/111 |
| N4 libro registro de recibidas | Hecho (CSV y hoja Excel) | `probar_gestoria_b.py`, `gestoria.spec.js` |
| N5 deducibilidad y NIF | Hecho | `gestoria.spec.js` «badges» |
| N6 asientos CSV / A3 / Holded | Hecho. **A3 a validar** (documentación no pública); **Holded** con su plantilla oficial de compras, cabecera exacta a validar | `probar_gestoria_b.py` (asientos cuadrados) |
| N7 pagos y conciliación Norma 43 / CSV | Hecho (Norma 43 según el cuaderno AEB 43) | `probar_gestoria_b.py`, `gestoria.spec.js` «banco» |

**Pendiente de validar fuera de aquí:** una importación de prueba en A3 y en Holded con una cuenta real.
