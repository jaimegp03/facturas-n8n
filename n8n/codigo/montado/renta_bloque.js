// ---- fase 4b: ayuda para la renta (orientativa) ----
const RENTA_AVISO = 'Resumen orientativo para llevar a tu gestoría. No presenta nada ante Hacienda ni sustituye a la declaración de la renta; cualquier posible deducción debe confirmarla tu gestor.';
// Tabla DOCUMENTADA y configurable de conceptos con deducción o reducción habitual. Se marca TODO como «a revisar con tu gestor»: no se promete ahorro fiscal.
// Un gasto encaja si su categoría está en `categorias` o su proveedor contiene alguna de las `palabras` (minúsculas, sin acentos). Ajusta aquí la lista.
const RENTA_CONCEPTOS = [
  { id: 'donativos', concepto: 'Donativos a ONG y fundaciones', categorias: [], palabras: ['donativo', 'fundacion', 'ong ', 'cruz roja', 'unicef', 'caritas', 'medicos sin fronteras', 'greenpeace', 'manos unidas'],
    nota: 'Pueden dar derecho a deducción si la entidad está acogida a la Ley 49/2002; hace falta el certificado de la entidad.' },
  { id: 'sindicatos_colegios', concepto: 'Cuotas sindicales y de colegios profesionales', categorias: [], palabras: ['sindicato', 'ugt', 'ccoo', 'colegio oficial', 'colegio de '],
    nota: 'Las cuotas sindicales y de colegios profesionales (con límites) pueden reducir el rendimiento del trabajo.' },
  { id: 'planes_pensiones', concepto: 'Planes de pensiones', categorias: [], palabras: ['plan de pensiones', 'planes de pensiones', 'plan pensiones'],
    nota: 'Las aportaciones tienen un límite anual de reducción en la base imponible; confirma tu límite con tu gestor.' },
  { id: 'alquiler', concepto: 'Alquiler de vivienda', categorias: ['Alquileres'], palabras: ['alquiler'],
    nota: 'Algunas comunidades autónomas tienen deducción por alquiler de la vivienda habitual; depende de tu comunidad y de tus ingresos.' },
  { id: 'formacion', concepto: 'Formación', categorias: ['Formación'], palabras: [],
    nota: 'En general no es deducible para asalariados; puede serlo si hay actividad económica o deducción autonómica. Solo informativo.' },
  { id: 'salud', concepto: 'Gastos de salud y seguros', categorias: ['Salud y farmacia', 'Seguros'], palabras: [],
    nota: 'En general no son deducibles en la renta estatal de un asalariado; pueden serlo para autónomos o por deducción autonómica. Solo informativo.' },
];
function rentaAnioDefecto(hoy) { const y = Number(hoy.slice(0, 4)); return Number(hoy.slice(5, 7)) < 7 ? y - 1 : y; }
function rentaAnioValido(s) { return /^\d{4}$/.test(String(s)) && Number(s) >= 2000 && Number(s) <= 2100; }
function rentaSinAcentos(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function rentaCsvCelda(v) { const t = String(v === null || v === undefined ? '' : v); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
function rentaCsvNum(c) { const a = Math.abs(Math.round(c)); return (c < 0 ? '-' : '') + Math.floor(a / 100) + ',' + String(a % 100).padStart(2, '0'); }
function calcularRenta(e) {
  const { cliente, anio, hoy } = e; const cid = Number(cliente.id); const A = String(anio);
  const avisos = []; const excluidas = [];
  const catOrden = {}; (e.categorias || []).forEach((c, i) => { if (c && c.nombre) catOrden[c.nombre] = c.orden === undefined || c.orden === null ? 1000 + i : c.orden; });
  const ordCat = (a, b) => (catOrden[a] ?? 9999) - (catOrden[b] ?? 9999) || (a < b ? -1 : a > b ? 1 : 0);
  // ingresos: mes a mes (nóminas anualizadas con los meses activos)
  const acum = {}; let ingTotal = 0;
  for (let m = 1; m <= 12; m++) {
    const r = mdIngresosMes(e.ingresos || [], cid, A + '-' + String(m).padStart(2, '0')); ingTotal += r.total;
    for (const d of r.detalle) { const a = acum[d.id] || (acum[d.id] = { id: d.id, tipo: d.tipo, concepto: d.concepto, periodicidad: d.periodicidad, meses: 0, c: 0 }); a.meses++; a.c += mdCent(d.importe_mes); }
  }
  const detIng = Object.values(acum).sort((a, b) => a.id - b.id).map((a) => ({ id: a.id, tipo: a.tipo, concepto: a.concepto, periodicidad: a.periodicidad, meses_activos: a.meses, importe_anual: mdEur(a.c) }));
  const porTipo = {}; Object.values(acum).forEach((a) => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + a.c; });
  // facturas del año
  const fv = []; const revisar = [];
  for (const f of (e.facturas || [])) {
    if (!f || Number(f.cliente_id) !== cid || !MD_ESTADOS_GASTO.includes(f.estado) || !f.fecha_emision || String(f.fecha_emision).slice(0, 4) !== A) continue;
    let t = f.total_eur;
    if (t === null || t === undefined || t === '') { if (!f.moneda || f.moneda === 'EUR') t = f.total; else { excluidas.push(f.id); continue; } }
    if (!Number.isFinite(Number(t))) continue;
    const tc = f.tipo_cambio && Number(f.tipo_cambio) > 0 ? Number(f.tipo_cambio) : 1;
    const irpf = f.irpf_cuota !== null && f.irpf_cuota !== undefined && Number.isFinite(Number(f.irpf_cuota)) ? mdCent(Number(f.irpf_cuota) * (f.moneda && f.moneda !== 'EUR' ? tc : 1)) : 0;
    const x = { id: f.id, fecha: String(f.fecha_emision), prov: f.proveedor || f.proveedor_norm || '', nif: f.nif || '', numero: f.numero || '', cat: f.categoria || 'Otros', c: mdCent(t), irpf, txt: rentaSinAcentos((f.proveedor_norm || '') + ' ' + (f.proveedor || '')) };
    fv.push(x);
    const motivos = [];
    if (f.estado === 'revisar') motivos.push('está marcada «por revisar»');
    if (f.estado === 'posible_duplicada') motivos.push('posible duplicada');
    if (!f.archivo_ruta) motivos.push('sin archivo original');
    if (f.nif_valido === false) motivos.push('NIF del proveedor inválido');
    if (motivos.length) revisar.push({ id: f.id, proveedor: x.prov, numero: x.numero || null, fecha: x.fecha, motivos });
  }
  const gasto = fv.reduce((s, f) => s + f.c, 0);
  const cats = {}; fv.forEach((f) => { const o = cats[f.cat] || (cats[f.cat] = { c: 0, n: 0 }); o.c += f.c; o.n++; });
  const porCat = Object.keys(cats).sort(ordCat).map((k) => ({ categoria: k, total: mdEur(cats[k].c), num: cats[k].n, pct: mdPct(cats[k].c, gasto) }));
  const ret = fv.filter((f) => f.irpf > 0); const retTotal = ret.reduce((s, f) => s + f.irpf, 0);
  if (cliente.regimen_iva === 'particular' && ingTotal > 0) avisos.push('Las retenciones de tu nómina (IRPF y Seguridad Social) no constan en esta herramienta: se ven en tu certificado de retenciones o en el borrador de Hacienda.');
  if (cliente.regimen_iva === 'particular' && ingTotal === 0) avisos.push('No hay ingresos registrados en ' + A + ': añádelos en «Mi dinero» para que el resumen esté completo.');
  if (excluidas.length) avisos.push(excluidas.length + ' factura(s) en otra moneda sin tipo de cambio no suman en el gasto.');
  const ded = [];
  for (const k of RENTA_CONCEPTOS) {
    const l = fv.filter((f) => k.categorias.includes(f.cat) || k.palabras.some((p) => f.txt.includes(p)));
    if (l.length) ded.push({ id: k.id, concepto: k.concepto, total: mdEur(l.reduce((s, f) => s + f.c, 0)), num: l.length, ids: l.map((f) => f.id), nota: k.nota, a_revisar: true, etiqueta: 'A revisar con tu gestor' });
  }
  const pres = (e.presupuestos || []).filter((p) => Number(p.cliente_id) === cid && p.activo !== false).sort((a, b) => ordCat(a.categoria, b.categoria))
    .map((p) => { const lim = mdCent(p.limite_mensual) * 12; const g = cats[p.categoria] ? cats[p.categoria].c : 0; return { categoria: p.categoria, limite_anual: mdEur(lim), gastado: mdEur(g), pct: mdPct(g, lim) }; });
  const L = [];
  L.push('Resumen orientativo de la renta ' + A + ' · ' + cliente.nombre);
  L.push(ingTotal > 0 ? 'Ingresos del año: ' + mdFmtEur(ingTotal) + ' (' + detIng.map((d) => d.concepto + ' ' + mdFmtEur(mdCent(d.importe_anual)) + ' en ' + d.meses_activos + ' ' + (d.meses_activos === 1 ? 'mes' : 'meses')).join('; ') + ').' : 'Ingresos del año: sin ingresos registrados.');
  L.push(fv.length ? 'Gasto registrado: ' + mdFmtEur(gasto) + ' en ' + fv.length + ' facturas. Mayores categorías: ' + porCat.slice().sort((a, b) => b.total - a.total).slice(0, 3).map((c) => c.categoria + ' ' + mdFmtEur(mdCent(c.total))).join('; ') + '.' : 'Gasto registrado: sin facturas en ' + A + '.');
  L.push(retTotal > 0 ? 'Retenciones de IRPF soportadas en facturas: ' + mdFmtEur(retTotal) + ' (' + ret.length + ' facturas).' : 'Retenciones de IRPF en facturas: ninguna.');
  L.push(ded.length ? 'Conceptos que podrían tener tratamiento fiscal (a revisar con tu gestor, sin garantía de deducción): ' + ded.map((d) => d.concepto + ' ' + mdFmtEur(mdCent(d.total))).join('; ') + '.' : 'Conceptos con posible tratamiento fiscal: ninguno detectado.');
  L.push(revisar.length ? 'Conviene revisar antes de enviarlo: ' + revisar.length + ' facturas (' + revisar.slice(0, 5).map((r) => r.proveedor + ' ' + mdFechaDMA(r.fecha)).join('; ') + (revisar.length > 5 ? '…' : '') + ').' : 'Facturas por revisar: ninguna.');
  L.push('Aviso: ' + RENTA_AVISO);
  const C = ['Categoría;Fecha;Proveedor;NIF;Número;Total (EUR);Retención IRPF (EUR)'];
  for (const k of Object.keys(cats).sort(ordCat)) {
    fv.filter((f) => f.cat === k).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id))
      .forEach((f) => C.push([k, mdFechaDMA(f.fecha), f.prov, f.nif, f.numero, rentaCsvNum(f.c), rentaCsvNum(f.irpf)].map(rentaCsvCelda).join(';')));
    C.push(['Subtotal ' + k, '', '', '', '', rentaCsvNum(cats[k].c), rentaCsvNum(fv.filter((f) => f.cat === k).reduce((s, f) => s + f.irpf, 0))].map(rentaCsvCelda).join(';'));
  }
  C.push(['TOTAL', '', '', '', '', rentaCsvNum(gasto), rentaCsvNum(retTotal)].join(';'));
  return { cliente: { id: cid, nombre: cliente.nombre }, anio: Number(A), generado: hoy, aviso_legal: RENTA_AVISO,
    ingresos: { total: mdEur(ingTotal), num: detIng.length, por_tipo: Object.keys(porTipo).sort().map((t) => ({ tipo: t, total: mdEur(porTipo[t]) })), detalle: detIng },
    gasto: { total: mdEur(gasto), num_facturas: fv.length, por_categoria: porCat },
    retenciones: { irpf_soportado: mdEur(retTotal), num_facturas: ret.length, ids: ret.map((f) => f.id) },
    posibles_deducciones: ded, presupuesto_anual: pres, conviene_revisar: revisar, avisos, excluidas_sin_cambio: excluidas,
    texto: L.join('\n'), csv: '﻿' + C.join('\r\n') + '\r\n', csv_nombre: 'Renta_' + A + '_gastos.csv' };
}
