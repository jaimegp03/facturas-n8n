// «Mi dinero: filas»: deja solo las columnas que se escriben en la tabla (la fila, o las filas de presupuesto).
const p = $('Mi dinero: procesar').first().json;
if (p.accion === 'put_presupuestos') return p.filas.length ? p.filas.map((f) => ({ json: f })) : [{ json: { _vacio: true } }];
return [{ json: p.fila }];
