# Prueba «dueño de un restaurante» (15/10/2026)

Recorrido con la web como un hostelero que revisa las facturas del fin de semana del 10-11/10/2026: 10 facturas de proveedores
más una repetida (pescado, bebidas, carne, verdura, pan, ticket de cash & carry, butano, abono, limpieza y vino de Portugal),
subidas por la web a Gemini real (10 ingestas; el duplicado no gasta). Guion: `tests/e2e/restaurante.spec.js`
(`npx playwright test --project=restaurante`), generador: `tests/auditoria/restaurante_fin_de_semana.py`.
Capturas e informe en `tests/salida/restaurante/`.

## Lo que funcionó
- 10 de 10 facturas guardadas con nº, fecha, base, IVA y total exactos (suma 3.222,83 €, IVA 340,38 €); subida del lote en 33 s.
- Duplicado detectado; rectificativa unida a la factura que rectifica; ticket sin NIF «No deducible»; compra de Portugal como intracomunitaria.
- Cierre del 4T: 999,00 € al 21 %, 1.248,80 € al 10 %, 142,65 € al 4 %, 103,32 € intracomunitarios, 428,71 € deducibles y 349 con el proveedor portugués.
- Libro registro (12 filas), 10 asientos cuadrados, extracto CSV con 2 de 3 movimientos conciliables al 100 %.

## Fallos encontrados y corregidos
| Fallo | Corrección |
|---|---|
| El trimestre fiscal arrancaba siempre en el trimestre anterior y, al recalcular, seguía mostrando las cifras viejas | Sigue al periodo elegido arriba; se vacía al calcular y se ignoran respuestas tardías |
| Al cambiar de cliente se quedaba el «Ahorra hasta…» del anterior en la barra lateral | Se restablece cuando el cliente no tiene recomendaciones |
| Un abono salía «Pendiente» de pago | Se muestra «Abono a compensar» |
| Corregir proveedores en lote no se recordaba (sí al corregir uno) | PATCH /facturas/lote aprende reglas por cliente y proveedor (`tests/probar_lote_reglas.py`, 19/19) |
| La lista se abría sola al hacer scroll (fallo intermitente del hover: 8 de 8 en la sonda) | Los «mouseover» sin movimiento real del ratón se ignoran; la fila señalada no se mueve al plegarse la anterior. 16 de 16 |

## Decisión tomada (15/10/2026)
La categoría «Alimentación y supermercado» propone ahora la cuenta **600 / proveedor 400** (antes 629 / 410, que es la de un hogar). Solo afecta a las facturas
nuevas: las ya guardadas conservan su cuenta (Mercadona sigue en 629/410). Cambiado con el workflow temporal `FACT — TEMP: cuenta 600 Alimentación`
(`4bDS82YV40vGrfTA`, despublicado; archivar desde la UI de n8n). Test: caso TEST_13 de `tests/probar_gestoria_a.py --pin`.
