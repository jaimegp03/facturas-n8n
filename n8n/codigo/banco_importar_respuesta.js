// {formato, importados, duplicados, errores, avisos, sugerencias:[{movimiento_id, factura_id, confianza, …}]}
const p = $('Banco: procesar').first().json;
const insertadas = $('Insertar movimientos').isExecuted ? $('Insertar movimientos').all().map((i) => i.json) : [];
const porHash = {};
for (const r of insertadas) if (r && r.hash) porHash[r.hash] = r.id;
const sugerencias = Object.keys(p.sugerencias_por_hash || {}).map((h) => ({ movimiento_id: porHash[h] ?? null, ...p.sugerencias_por_hash[h] }))
  .filter((s) => s.movimiento_id !== null).sort((a, b) => a.movimiento_id - b.movimiento_id);
return [{ json: { status: 200, body: { ...p.body, sugerencias } } }];
