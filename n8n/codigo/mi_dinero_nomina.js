// POST /nomina/simular: bruto -> neto estimado. Sin datos persistentes ni LLM.
/*@@COMUN_MI_DINERO@@*/
const e = $input.first().json || {};
const b = e.body && typeof e.body === 'object' && !Array.isArray(e.body) ? e.body : null;
if (!b || !Object.keys(b).length) return [{ json: { status: 400, body: { error: 'El cuerpo debe ser un objeto JSON no vacío.' } } }];
const r = simularNomina(b);
return [{ json: { status: r.status, body: r.body } }];
