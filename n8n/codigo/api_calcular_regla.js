// Regla aprendida por cliente: proveedor_norm + cliente_id -> categoría/subcategoría y/o
// cuenta_gasto (lo que no cambia se conserva de la regla existente), usos + 1.
// PATCH de una factura: una regla. Lote: una por (cliente, proveedor) (reglas_lote).
const p = $('PATCH: revalidar y fusionar').first().json;
const nuevas = p.modo === 'lote' ? (p.reglas_lote || []) : (p.regla ? [p.regla] : []);
const reglasBd = $('PATCH: leer reglas').all().map((i) => i.json);
const tiene = (r, k) => Object.prototype.hasOwnProperty.call(r, k);
return nuevas.map((r) => {
  const existente = reglasBd.find((x) => x && x.proveedor_norm === r.proveedor_norm && (x.cliente_id ?? null) === (r.cliente_id ?? null));
  const usos = (Number(existente && existente.usos) || 0) + 1;
  return { json: {
    proveedor_norm: r.proveedor_norm,
    cliente_id: r.cliente_id ?? null,
    categoria: tiene(r, 'categoria') ? r.categoria : (existente ? existente.categoria ?? null : null),
    subcategoria: tiene(r, 'categoria') ? (r.subcategoria ?? null) : (existente ? existente.subcategoria ?? null : null),
    cuenta_gasto: tiene(r, 'cuenta_gasto') ? r.cuenta_gasto : (existente ? existente.cuenta_gasto ?? null : null),
    usos,
  } };
});
