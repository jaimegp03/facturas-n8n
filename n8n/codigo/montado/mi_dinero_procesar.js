// «Mi dinero: procesar»: valida la petición (GET/POST/PATCH/DELETE /ingresos, GET/PUT /presupuestos, GET /mi-dinero) y calcula la respuesta.
// Las escrituras (insertar, actualizar, borrar) las hacen los nodos Data Table siguientes según `accion`.
// === COMÚN Mi dinero: inicio ===
// Lógica de «Mi dinero» (fase 2). Funciones puras, céntimos enteros, EUR, sin LLM. Copia idéntica en la web (modo demo).
// Fuente única: n8n/codigo/mi_dinero_comun.js (lo monta montar.py en FACT — Mi dinero y lo copia inyectar_mi_dinero_web.py).
const MD_ESTADOS_GASTO = ['ok', 'revisar', 'posible_duplicada'];
// Regla 50/30/20: grupo de cada categoría de gasto. Lo no listado (categorías nuevas) cuenta como «deseos» y se avisa.
const MD_NECESIDADES = ['Agua', 'Luz', 'Gas', 'Telefonía e internet', 'Suministros (luz, agua, gas, internet, móvil)', 'Seguros', 'Alimentación y supermercado', 'Transporte y combustible',
  'Salud y farmacia', 'Hogar', 'Formación', 'Impuestos y tasas', 'Compras y materiales', 'Mercaderías', 'Servicios profesionales', 'Alquileres',
  'Reparaciones y mantenimiento', 'Subcontratas', 'Publicidad', 'Gastos financieros'];
const MD_DESEOS = ['Ropa y calzado', 'Videojuegos y ocio digital', 'Streaming y música', 'Software y apps', 'Restaurantes y comida a domicilio',
  'Deporte y gimnasio', 'Tecnología y electrónica', 'Viajes', 'Otros'];
const MD_INTERVALO = { semanal: [7, 7], mensual: [30, 1], bimestral: [61, 2], trimestral: [91, 3], semestral: [183, 6], anual: [366, 12] }; // [días, meses]
function mdCent(x) { const n = Number(x); return Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7)); }
function mdEur(c) { return Math.round(c) / 100; }
function mdFmtEur(c) {
  const neg = c < 0; const a = Math.abs(Math.round(c)); const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + ent + ',' + String(a % 100).padStart(2, '0') + ' €';
}
function mdFmtPct(p) { return p.toFixed(1).replace('.', ',').replace(/,0$/, '') + ' %'; }
function mdFechaValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function mdMesValido(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && Number(s.slice(0, 4)) >= 2000; }
function mdMesMas(mes, k) { const y = Number(mes.slice(0, 4)); const m = Number(mes.slice(5)) - 1 + k; const yy = y + Math.floor(m / 12); return yy + '-' + String(((m % 12) + 12) % 12 + 1).padStart(2, '0'); }
function mdDiasMes(mes) { return new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0)).getUTCDate(); }
function mdSumaMeses(iso, n) { // suma n meses a una fecha AAAA-MM-DD ajustando el día al fin de mes
  const mes = mdMesMas(iso.slice(0, 7), n); const d = Math.min(Number(iso.slice(8)), mdDiasMes(mes)); return mes + '-' + String(d).padStart(2, '0');
}
function mdDias(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8))) / 86400000); }
function mdPct(a, b) { return b > 0 ? Math.round(a * 1000 / b) / 10 : null; } // a, b en céntimos
function mdGrupo(cat) { return MD_NECESIDADES.includes(cat) ? 'necesidades' : 'deseos'; }

// ingresos del mes en céntimos: mensual = importe; anual = importe/12 (redondeado); puntual = importe solo en el mes de fecha_inicio
function mdIngresosMes(ingresos, clienteId, mes) {
  const det = []; let total = 0;
  for (const r of ingresos) {
    if (Number(r.cliente_id) !== clienteId || r.activo === false || !r.fecha_inicio) continue;
    const ini = String(r.fecha_inicio).slice(0, 7); const fin = r.fecha_fin ? String(r.fecha_fin).slice(0, 7) : null;
    const c = mdCent(r.importe); let m = 0;
    if (r.periodicidad === 'puntual') m = ini === mes ? c : 0;
    else if (ini <= mes && (!fin || fin >= mes)) m = r.periodicidad === 'anual' ? Math.round(c / 12) : c;
    if (!m) continue;
    total += m;
    det.push({ id: r.id, tipo: r.tipo, concepto: r.concepto, periodicidad: r.periodicidad, importe: mdEur(c), importe_mes: mdEur(m), dia_cobro: r.dia_cobro === undefined ? null : r.dia_cobro });
  }
  return { total, detalle: det };
}

function calcularMiDinero(e) {
  const { cliente, mes, hoy } = e; const cid = Number(cliente.id);
  const avisos = []; const excluidas = [];
  const catOrden = {}; (e.categorias || []).forEach((c, i) => { if (c && c.nombre) catOrden[c.nombre] = c.orden === undefined || c.orden === null ? 1000 + i : c.orden; });
  const ordCat = (a, b) => (catOrden[a] ?? 9999) - (catOrden[b] ?? 9999) || (a < b ? -1 : a > b ? 1 : 0);
  // facturas válidas del cliente con importe en euros
  const fv = [];
  for (const f of (e.facturas || [])) {
    if (!f || Number(f.cliente_id) !== cid || !MD_ESTADOS_GASTO.includes(f.estado) || !f.fecha_emision) continue;
    let t = f.total_eur;
    if (t === null || t === undefined || t === '') { if (!f.moneda || f.moneda === 'EUR') t = f.total; else { excluidas.push(f.id); continue; } }
    if (!Number.isFinite(Number(t))) continue;
    fv.push({ id: f.id, mes: String(f.fecha_emision).slice(0, 7), fecha: String(f.fecha_emision), cat: f.categoria || 'Otros', c: mdCent(t), tipo: f.tipo_gasto || 'puntual',
      per: f.periodicidad, prov: f.proveedor_norm || f.proveedor || '', provNombre: f.proveedor || f.proveedor_norm || '' });
  }
  const gastoMes = (m) => fv.filter((f) => f.mes === m);
  const porCat = (lista) => { const o = {}; for (const f of lista) o[f.cat] = (o[f.cat] || 0) + f.c; return o; };
  const ing = mdIngresosMes(e.ingresos || [], cid, mes);
  const del = gastoMes(mes); const cats = porCat(del); const gasto = del.reduce((s, f) => s + f.c, 0);
  const balance = ing.total - gasto; const tasa = ing.total > 0 ? Math.round(balance * 1000 / ing.total) / 10 : null;
  // presupuesto
  const pres = (e.presupuestos || []).filter((p) => Number(p.cliente_id) === cid && p.activo !== false);
  const items = pres.map((p) => {
    const lim = mdCent(p.limite_mensual); const con = cats[p.categoria] || 0;
    const estado = lim === 0 ? (con > 0 ? 'superado' : 'ok') : con > lim ? 'superado' : con * 5 >= lim * 4 ? 'aviso' : 'ok';
    return { categoria: p.categoria, limite_mensual: mdEur(lim), consumido: mdEur(con), restante: mdEur(lim - con), pct: mdPct(con, lim), estado, _l: lim, _c: con };
  }).sort((a, b) => ordCat(a.categoria, b.categoria));
  const conPres = new Set(items.map((i) => i.categoria));
  const sinPres = Object.keys(cats).filter((c) => !conPres.has(c) && cats[c] !== 0).sort((a, b) => cats[b] - cats[a] || ordCat(a, b)).map((c) => ({ categoria: c, gasto: mdEur(cats[c]) }));
  const totLim = items.reduce((s, i) => s + i._l, 0); const totCon = items.reduce((s, i) => s + i._c, 0);
  // comparación con los 3 meses anteriores
  const prev = [1, 2, 3].map((k) => mdMesMas(mes, -k)); const prevG = prev.map((m) => gastoMes(m));
  const media = Math.round(prevG.reduce((s, l) => s + l.reduce((a, f) => a + f.c, 0), 0) / 3);
  const prevCats = prevG.map(porCat); const nomCats = [...new Set([...Object.keys(cats), ...prevCats.flatMap((o) => Object.keys(o))])].sort(ordCat);
  const cmpCat = nomCats.map((c) => { const m3 = Math.round(prevCats.reduce((s, o) => s + (o[c] || 0), 0) / 3); const g = cats[c] || 0; return { categoria: c, gasto: mdEur(g), media_3m: mdEur(m3), diferencia: mdEur(g - m3), pct: mdPct(g - m3, m3) }; });
  const comparacion = { meses: prev.map((m, i) => ({ mes: m, gasto: mdEur(prevG[i].reduce((s, f) => s + f.c, 0)) })), media_gasto_3m: mdEur(media), diferencia: mdEur(gasto - media), pct: mdPct(gasto - media, media), por_categoria: cmpCat };
  // 50/30/20
  const nec = del.filter((f) => mdGrupo(f.cat) === 'necesidades').reduce((s, f) => s + f.c, 0); const des = gasto - nec;
  const sinMapa = [...new Set(del.map((f) => f.cat).filter((c) => !MD_NECESIDADES.includes(c) && !MD_DESEOS.includes(c)))].sort(ordCat);
  const oN = Math.round(ing.total * 50 / 100); const oD = Math.round(ing.total * 30 / 100); const oA = ing.total - oN - oD; const ahorro = Math.max(balance, 0);
  const grupo = (real, obj, p, mayor) => ({ real: mdEur(real), pct_real: ing.total > 0 ? mdPct(real, ing.total) : null, objetivo: mdEur(obj), pct_objetivo: p, diferencia: mdEur(real - obj), cumple: ing.total > 0 ? (mayor ? real >= obj : real <= obj) : null });
  const regla = { ingresos: mdEur(ing.total), necesidades: grupo(nec, oN, 50, false), deseos: grupo(des, oD, 30, false), ahorro: grupo(ahorro, oA, 20, true), categorias_sin_mapa: sinMapa };
  // previsión de fin de mes (solo el mes actual)
  let prevision = null; const esActual = mes === hoy.slice(0, 7);
  if (esActual) {
    const transc = Number(hoy.slice(8)); const dm = mdDiasMes(mes); const rest = dm - transc;
    const variable = del.filter((f) => f.tipo !== 'suscripcion' && f.tipo !== 'contrato').reduce((s, f) => s + f.c, 0);
    const resto = Math.round(variable * rest / transc);
    const ult = {}; for (const f of fv) { if ((f.tipo === 'suscripcion' || f.tipo === 'contrato') && MD_INTERVALO[f.per] && f.prov) { const u = ult[f.prov]; if (!u || f.fecha > u.fecha || (f.fecha === u.fecha && f.id > u.id)) ult[f.prov] = f; } }
    const pend = [];
    for (const u of Object.values(ult)) {
      const [dias, meses] = MD_INTERVALO[u.per]; const margen = Math.min(45, Math.max(10, Math.round(dias / 2))); const desde = mdDias(u.fecha, hoy);
      if (desde < 0 || desde > dias + margen || u.mes >= mes) continue;
      const next = u.per === 'semanal' ? new Date(Date.UTC(+u.fecha.slice(0, 4), +u.fecha.slice(5, 7) - 1, +u.fecha.slice(8) + 7)).toISOString().slice(0, 10) : mdSumaMeses(u.fecha, meses);
      if (next.slice(0, 7) > mes) continue;
      pend.push({ proveedor: u.provNombre, categoria: u.cat, importe: mdEur(u.c), fecha_esperada: next, _c: u.c });
    }
    pend.sort((a, b) => b._c - a._c || (a.proveedor < b.proveedor ? -1 : 1));
    const totPend = pend.reduce((s, p) => s + p._c, 0); const total = gasto + totPend + resto;
    prevision = { dias_transcurridos: transc, dias_restantes: rest, gasto_acumulado: mdEur(gasto), gasto_variable_acumulado: mdEur(variable),
      recurrentes_pendientes: { total: mdEur(totPend), detalle: pend.map(({ _c, ...r }) => r) },
      variable_resto: { ritmo_diario: mdEur(Math.round(variable / transc)), dias_restantes: rest, total: mdEur(resto) },
      total: mdEur(total), balance_previsto: mdEur(ing.total - total) };
    if (transc < 7) avisos.push('Estamos a principios de mes: la previsión del gasto variable se basa en pocos días y es poco fiable.');
  }
  // alertas (plantillas, sin LLM)
  const al = [];
  for (const i of items) {
    if (i.estado === 'superado') al.push({ nivel: 'error', texto: `Has superado el presupuesto de ${i.categoria}: ${mdFmtEur(i._c)} de ${mdFmtEur(i._l)}${i._l > 0 ? ' (' + mdFmtPct(mdPct(i._c, i._l)) + ')' : ''}.` });
    else if (i.estado === 'aviso') al.push({ nivel: 'aviso', texto: `Llevas el ${mdFmtPct(mdPct(i._c, i._l))} del presupuesto de ${i.categoria} (${mdFmtEur(i._c)} de ${mdFmtEur(i._l)}).` });
  }
  if (ing.total > 0 && balance < 0) al.push({ nivel: 'error', texto: `Este mes gastas más de lo que ingresas: balance de ${mdFmtEur(balance)}.` });
  if (prevision && ing.total > 0 && mdCent(prevision.total) > ing.total && balance >= 0) al.push({ nivel: 'aviso', texto: `A este ritmo cerrarás el mes con ${mdFmtEur(mdCent(prevision.total))} gastados, por encima de tus ingresos (${mdFmtEur(ing.total)}).` });
  if (media > 0 && gasto * 100 > media * 125 && gasto - media >= 1000) al.push({ nivel: 'aviso', texto: `Tu gasto de ${mdFmtEur(gasto)} supera en un ${mdFmtPct(mdPct(gasto - media, media))} la media de los 3 meses anteriores (${mdFmtEur(media)}).` });
  if (sinPres.length && items.length) al.push({ nivel: 'info', texto: `Tienes gasto en ${sinPres.length} ${sinPres.length === 1 ? 'categoría' : 'categorías'} sin presupuesto: ${sinPres.slice(0, 3).map((s) => s.categoria).join(', ')}${sinPres.length > 3 ? '…' : ''}.` });
  if (ing.total > 0 && nec > oN) al.push({ nivel: 'info', texto: `Tus necesidades suponen el ${mdFmtPct(mdPct(nec, ing.total))} de tus ingresos (objetivo 50 %).` });
  if (ing.total === 0) al.push({ nivel: 'info', texto: 'No hay ingresos registrados para este mes: añade tu sueldo para ver tu balance y tu tasa de ahorro.' });
  if (!items.length) al.push({ nivel: 'info', texto: 'Aún no tienes presupuestos: fija un límite mensual por categoría para recibir avisos.' });
  const orden = { error: 0, aviso: 1, info: 2 }; al.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  if (excluidas.length) avisos.push(`${excluidas.length} factura(s) en otra moneda sin tipo de cambio no se han contado (ids: ${excluidas.join(', ')}).`);
  if (sinMapa.length) avisos.push(`Categorías sin grupo 50/30/20 (se cuentan como deseos): ${sinMapa.join(', ')}.`);
  return {
    cliente: { id: cid, nombre: cliente.nombre }, mes, hoy, es_mes_actual: esActual,
    ingresos: { total: mdEur(ing.total), num: ing.detalle.length, detalle: ing.detalle },
    gasto: { total: mdEur(gasto), num_facturas: del.length, por_categoria: Object.keys(cats).sort((a, b) => cats[b] - cats[a] || ordCat(a, b)).map((c) => ({ categoria: c, total: mdEur(cats[c]), pct: mdPct(cats[c], gasto) })) },
    balance: mdEur(balance), tasa_ahorro_pct: tasa,
    presupuesto: { total_limite: mdEur(totLim), total_consumido: mdEur(totCon), items: items.map(({ _l, _c, ...r }) => r), sin_presupuesto: sinPres },
    comparacion_3m: comparacion, regla_50_30_20: regla, prevision, alertas: al, avisos, excluidas_sin_cambio: excluidas,
  };
}

// Simulador de nómina bruto -> neto (estimación). Devuelve {status, body}.
function simularNomina(b) {
  const err = []; b = b || {};
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(',', '.')));
  const bruto = num(b.bruto_anual); const pagas = num(b.num_pagas === undefined ? 14 : b.num_pagas);
  const irpf = b.irpf_pct === undefined || b.irpf_pct === null || b.irpf_pct === '' ? 0 : num(b.irpf_pct);
  const ss = b.ss_pct === undefined || b.ss_pct === null || b.ss_pct === '' ? 6.5 : num(b.ss_pct);
  const otros = b.otros_descuentos_mensuales === undefined || b.otros_descuentos_mensuales === null || b.otros_descuentos_mensuales === '' ? 0 : num(b.otros_descuentos_mensuales);
  const prorr = b.pagas_prorrateadas === true || b.pagas_prorrateadas === 'true';
  if (bruto === null || !Number.isFinite(bruto) || bruto <= 0 || bruto > 10000000) err.push('"bruto_anual" debe ser un número mayor que 0.');
  if (pagas !== 12 && pagas !== 14) err.push('"num_pagas" debe ser 12 o 14.');
  if (!Number.isFinite(irpf) || irpf < 0 || irpf > 60) err.push('"irpf_pct" debe estar entre 0 y 60.');
  if (!Number.isFinite(ss) || ss < 0 || ss > 30) err.push('"ss_pct" debe estar entre 0 y 30.');
  if (!Number.isFinite(otros) || otros < 0 || otros > 1000000) err.push('"otros_descuentos_mensuales" debe ser un número igual o mayor que 0.');
  if (err.length) return { status: 400, body: { error: 'Datos no válidos.', detalles: err } };
  const bc = mdCent(bruto); const oc = mdCent(otros); const extra = pagas === 14 && !prorr;
  const brutoMes = Math.round(bc / (extra ? 14 : 12)); // paga ordinaria
  const ssM = Math.round(brutoMes * ss / 100); const irM = Math.round(brutoMes * irpf / 100); const netoM = brutoMes - ssM - irM - oc;
  let pe = null; let netoAnual = netoM * 12;
  if (extra) { const ssE = Math.round(brutoMes * ss / 100); const irE = Math.round(brutoMes * irpf / 100); pe = { num: 2, bruto: mdEur(brutoMes), ss: mdEur(ssE), irpf: mdEur(irE), neto: mdEur(brutoMes - ssE - irE) }; netoAnual += 2 * (brutoMes - ssE - irE); }
  const avisos = ['Estimación: el IRPF real depende de tu situación personal y familiar (tabla de retenciones, hijos, contrato...).',
    'La Seguridad Social real se calcula con bases y topes de cotización; aquí es un porcentaje fijo sobre el bruto.'];
  if (!irpf) avisos.push('No has indicado IRPF (0 %): el neto no descuenta retención.');
  const desglose = [{ concepto: extra ? 'Bruto mensual (paga ordinaria)' : 'Bruto mensual', importe: mdEur(brutoMes), tipo: 'linea' }, { concepto: `Seguridad Social (${String(ss).replace('.', ',')} %)`, importe: -mdEur(ssM), tipo: 'linea' },
    { concepto: `IRPF (${String(irpf).replace('.', ',')} %)`, importe: -mdEur(irM), tipo: 'linea' }];
  if (oc) desglose.push({ concepto: 'Otros descuentos', importe: -mdEur(oc), tipo: 'linea' });
  desglose.push({ concepto: 'Neto mensual', importe: mdEur(netoM), tipo: 'total' });
  return { status: 200, body: { bruto_anual: mdEur(bc), num_pagas: pagas, pagas_prorrateadas: prorr, bruto_mensual: mdEur(brutoMes), ss_pct: ss, irpf_pct: irpf, ss_mensual: mdEur(ssM), irpf_mensual: mdEur(irM),
    otros_descuentos_mensuales: mdEur(oc), neto_mensual: mdEur(netoM), paga_extra: pe, neto_anual: mdEur(netoAnual), neto_anual_pct_bruto: mdPct(netoAnual, bc), desglose, avisos } };
}

const MD_TIPOS = ['nomina', 'extra', 'otros']; const MD_PERIODOS = ['mensual', 'anual', 'puntual'];
// Valida y normaliza un ingreso. `actual` = fila existente (PATCH) o null (POST). Devuelve {errores, fila}.
function validarIngreso(b, actual) {
  const err = []; const s = Object.assign({}, actual || {});
  const hay = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (hay('tipo')) { if (MD_TIPOS.includes(b.tipo)) s.tipo = b.tipo; else err.push('"tipo" debe ser nomina, extra u otros.'); }
  if (hay('concepto')) { const t = typeof b.concepto === 'string' ? b.concepto.trim() : ''; if (t && t.length <= 120) s.concepto = t; else err.push('"concepto" debe ser un texto de 1 a 120 caracteres.'); }
  if (hay('importe')) { const n = typeof b.importe === 'number' ? b.importe : typeof b.importe === 'string' && b.importe.trim() !== '' ? Number(b.importe.replace(',', '.')) : NaN; if (Number.isFinite(n) && n > 0 && n <= 10000000) s.importe = mdEur(mdCent(n)); else err.push('"importe" debe ser un número mayor que 0 (euros netos).'); }
  if (hay('periodicidad')) { if (MD_PERIODOS.includes(b.periodicidad)) s.periodicidad = b.periodicidad; else err.push('"periodicidad" debe ser mensual, anual o puntual.'); }
  if (hay('fecha_inicio')) { if (mdFechaValida(b.fecha_inicio)) s.fecha_inicio = b.fecha_inicio; else err.push('"fecha_inicio" debe ser una fecha AAAA-MM-DD válida.'); }
  if (hay('fecha_fin')) { if (b.fecha_fin === null || b.fecha_fin === '') s.fecha_fin = null; else if (mdFechaValida(b.fecha_fin)) s.fecha_fin = b.fecha_fin; else err.push('"fecha_fin" debe ser una fecha AAAA-MM-DD válida o null.'); }
  if (hay('dia_cobro')) { if (b.dia_cobro === null || b.dia_cobro === '') s.dia_cobro = null; else { const n = Number(b.dia_cobro); if (Number.isInteger(n) && n >= 1 && n <= 31) s.dia_cobro = n; else err.push('"dia_cobro" debe ser un entero de 1 a 31 o null.'); } }
  if (hay('activo')) { if (typeof b.activo === 'boolean') s.activo = b.activo; else err.push('"activo" debe ser verdadero o falso.'); }
  if (!actual) for (const k of ['tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio']) if (s[k] === undefined) err.push(`Falta "${k}".`);
  if (s.fecha_fin === undefined) s.fecha_fin = null; if (s.dia_cobro === undefined) s.dia_cobro = null; if (s.activo === undefined) s.activo = true;
  if (s.periodicidad === 'puntual') s.fecha_fin = null;
  if (!err.length && s.fecha_fin && s.fecha_inicio && s.fecha_fin < s.fecha_inicio) err.push('"fecha_fin" no puede ser anterior a "fecha_inicio".');
  return { errores: err, fila: s };
}
// Valida la lista completa de presupuestos [{categoria, limite_mensual}] contra las categorías activas.
function validarPresupuestos(lista, nombresCategorias) {
  const err = []; const filas = []; const vistas = new Set();
  if (!Array.isArray(lista)) return { errores: ['"presupuestos" debe ser una lista de {categoria, limite_mensual}.'], filas };
  if (lista.length > 60) err.push('Máximo 60 presupuestos.');
  lista.forEach((p, i) => {
    if (!p || typeof p !== 'object') { err.push(`Elemento ${i + 1}: debe ser un objeto.`); return; }
    if (typeof p.categoria !== 'string' || !nombresCategorias.includes(p.categoria)) { err.push(`Elemento ${i + 1}: la categoría no existe o no está activa.`); return; }
    if (vistas.has(p.categoria)) { err.push(`Elemento ${i + 1}: categoría repetida (${p.categoria}).`); return; }
    vistas.add(p.categoria);
    const n = typeof p.limite_mensual === 'number' ? p.limite_mensual : typeof p.limite_mensual === 'string' && p.limite_mensual.trim() !== '' ? Number(p.limite_mensual.replace(',', '.')) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 10000000) { err.push(`Elemento ${i + 1}: "limite_mensual" debe ser un número igual o mayor que 0.`); return; }
    filas.push({ categoria: p.categoria, limite_mensual: mdEur(mdCent(n)) });
  });
  return { errores: err, filas };
}
// ---- Fase 4a: metas de ahorro y resumen mensual (céntimos enteros, EUR, sin LLM) ----
const MD_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function mdMesNombre(mes) { return MD_MESES[Number(mes.slice(5)) - 1] + ' ' + mes.slice(0, 4); }
function mdNumero(v) { if (typeof v === 'number') return Number.isFinite(v) ? v : null; if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.trim().replace(',', '.')); return null; }
function mdFechaDMA(iso) { return iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }
const MD_META_COLS = ['cliente_id', 'nombre', 'importe_objetivo', 'importe_ahorrado', 'fecha_objetivo', 'aportacion_mensual_prevista', 'activa', 'creada'];
// Valida una meta. `actual` = fila existente (PATCH) o null (POST; exige fecha futura). Devuelve {errores, fila} (fila = columnas completas).
function validarMeta(b, actual, hoy) {
  const err = []; const s = Object.assign({}, actual || {}); const crear = !actual; const tiene = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (crear || tiene('nombre')) { const n = typeof b.nombre === 'string' ? b.nombre.trim() : ''; if (!n || n.length > 80) err.push('"nombre" es obligatorio (máximo 80 caracteres).'); else s.nombre = n; }
  if (crear || tiene('importe_objetivo')) { const v = mdNumero(b.importe_objetivo); if (v === null || v <= 0 || v > 1e9) err.push('"importe_objetivo" debe ser un número mayor que 0.'); else s.importe_objetivo = mdEur(mdCent(v)); }
  if (tiene('importe_ahorrado')) { const v = mdNumero(b.importe_ahorrado); if (v === null || v < 0 || v > 1e9) err.push('"importe_ahorrado" debe ser un número mayor o igual que 0.'); else s.importe_ahorrado = mdEur(mdCent(v)); }
  else if (crear) s.importe_ahorrado = 0;
  if (crear || tiene('fecha_objetivo')) {
    if (!mdFechaValida(b.fecha_objetivo)) err.push('"fecha_objetivo" debe ser una fecha válida AAAA-MM-DD.');
    else if (crear && b.fecha_objetivo <= hoy) err.push('"fecha_objetivo" debe ser una fecha futura.');
    else s.fecha_objetivo = b.fecha_objetivo;
  }
  if (crear || tiene('aportacion_mensual_prevista')) {
    const x = b.aportacion_mensual_prevista;
    if (x === undefined || x === null || x === '') s.aportacion_mensual_prevista = null;
    else { const v = mdNumero(x); if (v === null || v < 0 || v > 1e9) err.push('"aportacion_mensual_prevista" debe ser un número mayor o igual que 0 o null.'); else s.aportacion_mensual_prevista = mdEur(mdCent(v)); }
  }
  if (crear || tiene('activa')) { if (b.activa === undefined && crear) s.activa = true; else if (typeof b.activa === 'boolean') s.activa = b.activa; else err.push('"activa" debe ser true o false.'); }
  return { errores: err, fila: s };
}
// Suma (importe > 0) o retira (importe < 0) ahorro. Devuelve {error} o {ahorrado} en euros.
function aportarMeta(meta, importe) {
  const v = mdNumero(importe);
  if (v === null || v === 0 || Math.abs(v) > 1e9) return { error: '"importe" debe ser un número distinto de 0 (negativo para retirar).' };
  const nuevo = mdCent(meta.importe_ahorrado || 0) + mdCent(v);
  if (nuevo < 0) return { error: 'No puedes retirar más de lo que has ahorrado en esta meta (' + mdFmtEur(mdCent(meta.importe_ahorrado || 0)) + ').' };
  return { ahorrado: mdEur(nuevo) };
}
// Ritmo real de ahorro: media de (ingresos − gasto) de los 3 últimos meses completos con datos.
function mdRitmo(e) {
  const mesHoy = e.hoy.slice(0, 7); const meses = [];
  for (let k = 1; k <= 3; k++) {
    const m = mdMesMas(mesHoy, -k);
    const r = calcularMiDinero({ cliente: e.cliente, mes: m, hoy: e.hoy, ingresos: e.ingresos || [], presupuestos: [], categorias: [], facturas: e.facturas || [] });
    meses.push({ mes: m, ahorro: r.balance, datos: r.ingresos.total > 0 || r.gasto.total > 0 });
  }
  const con = meses.filter((x) => x.datos);
  return { ritmo: con.length ? Math.round(con.reduce((s, x) => s + mdCent(x.ahorro), 0) / con.length) : null, meses: meses.map(({ mes, ahorro, datos }) => ({ mes, ahorro, con_datos: datos })) };
}
// Metas del cliente con todo calculado. Estado: conseguida (ahorrado >= objetivo); atrasada si la fecha ya pasó; si no se compara la aportación
// asignada con la necesaria: >= 100 % en_camino, >= 80 % justa, menos atrasada; pausada si no está activa. El ahorro libre (ritmo real) se
// reparte entre las metas activas por fecha objetivo, sin contarlo dos veces; una aportación prevista fija la asignada de esa meta.
function calcularMetas(e) {
  const cid = Number(e.cliente.id); const hoy = e.hoy;
  const rit = mdRitmo(e); const ritmo = rit.ritmo;
  const lista = (e.metas || []).filter((m) => Number(m.cliente_id) === cid).sort((a, b) => a.id - b.id);
  const base = lista.map((m) => {
    const obj = mdCent(m.importe_objetivo); const ah = mdCent(m.importe_ahorrado || 0); const rest = Math.max(obj - ah, 0);
    const conseguida = ah >= obj; const vencida = m.fecha_objetivo < hoy; const meses = vencida ? 0 : Math.max(Number(m.fecha_objetivo.slice(0, 4)) * 12 + Number(m.fecha_objetivo.slice(5, 7)) - (Number(hoy.slice(0, 4)) * 12 + Number(hoy.slice(5, 7))), 0);
    const nec = conseguida ? 0 : vencida ? rest : Math.ceil(rest / Math.max(meses, 1));
    return { m, obj, ah, rest, conseguida, vencida, meses, nec, prev: m.aportacion_mensual_prevista === null || m.aportacion_mensual_prevista === undefined ? null : mdCent(m.aportacion_mensual_prevista), asig: null };
  });
  let libre = ritmo === null ? null : Math.max(ritmo, 0);
  const activas = base.filter((b) => b.m.activa !== false && !b.conseguida).sort((a, b) => (a.m.fecha_objetivo < b.m.fecha_objetivo ? -1 : a.m.fecha_objetivo > b.m.fecha_objetivo ? 1 : a.m.id - b.m.id));
  for (const b of activas) {
    if (b.prev !== null) { b.asig = b.prev; if (libre !== null) libre = Math.max(libre - b.prev, 0); }
    else if (libre !== null) { b.asig = Math.min(b.nec, libre); libre -= b.asig; }
  }
  const items = base.map((b) => {
    const av = []; let estado;
    if (b.conseguida) estado = 'conseguida';
    else if (b.m.activa === false) estado = 'pausada';
    else if (b.vencida) { estado = 'atrasada'; av.push('La fecha objetivo (' + mdFechaDMA(b.m.fecha_objetivo) + ') ya ha pasado y aún faltan ' + mdFmtEur(b.rest) + '.'); }
    else if (b.asig === null) { estado = 'justa'; av.push('Sin datos de ingresos y gasto de los 3 últimos meses para estimar tu ritmo; indica una aportación mensual prevista.'); }
    else estado = b.asig >= b.nec ? 'en_camino' : b.asig * 100 >= b.nec * 80 ? 'justa' : 'atrasada';
    let est = null;
    if (!b.conseguida && b.m.activa !== false && b.asig > 0) {
      est = mdSumaMeses(hoy, Math.ceil(b.rest / b.asig));
      if (est > b.m.fecha_objetivo) av.push('Al ritmo actual llegarías el ' + mdFechaDMA(est) + ', después de la fecha objetivo.');
    } else if (!b.conseguida && b.m.activa !== false && !b.vencida && b.asig !== null && b.asig <= 0) av.push('Con tu ahorro libre actual no te queda margen para esta meta.');
    return { id: b.m.id, cliente_id: cid, nombre: b.m.nombre, importe_objetivo: mdEur(b.obj), importe_ahorrado: mdEur(b.ah), fecha_objetivo: b.m.fecha_objetivo,
      aportacion_mensual_prevista: b.prev === null ? null : mdEur(b.prev), activa: b.m.activa !== false, creada: b.m.creada || null,
      restante: mdEur(b.rest), pct_conseguido: mdPct(Math.min(b.ah, b.obj), b.obj), meses_restantes: b.meses, aportacion_necesaria: mdEur(b.nec),
      ritmo_real: ritmo === null ? null : mdEur(ritmo), aportacion_asignada: b.asig === null ? null : mdEur(b.asig), estado, fecha_estimada: est, avisos: av };
  });
  const sumNec = activas.reduce((s, b) => s + b.nec, 0); const sumAsig = activas.reduce((s, b) => s + (b.asig || 0), 0); const avR = [];
  if (ritmo === null) avR.push('Aún no hay ingresos ni gasto en los 3 últimos meses completos: no se puede estimar tu ahorro libre.');
  else if (activas.length && sumNec > Math.max(ritmo, 0)) avR.push('Entre todas tus metas necesitas ahorrar ' + mdFmtEur(sumNec) + ' al mes y tu ahorro libre es de ' + mdFmtEur(Math.max(ritmo, 0)) + ': no alcanza para todas a la vez.');
  return { cliente_id: cid, items, total: items.length,
    resumen: { ahorro_mensual_libre: ritmo === null ? null : mdEur(ritmo), suma_aportaciones_necesarias: mdEur(sumNec), suma_aportaciones_asignadas: mdEur(sumAsig),
      cubre: ritmo === null || !activas.length ? null : sumNec <= Math.max(ritmo, 0), meses_ritmo: rit.meses, avisos: avR } };
}
// Resumen mensual con texto de plantilla (6-10 líneas) para copiar o enviar.
function calcularResumenMensual(e) {
  const { cliente, mes, hoy } = e; const cid = Number(cliente.id);
  const comun = { cliente, hoy, ingresos: e.ingresos || [], presupuestos: e.presupuestos || [], categorias: e.categorias || [], facturas: e.facturas || [] };
  const md = calcularMiDinero(Object.assign({ mes }, comun));
  const prevs = [1, 2, 3].map((k) => calcularMiDinero(Object.assign({}, comun, { mes: mdMesMas(mes, -k), presupuestos: [] })));
  const c = (x) => mdCent(x);
  const compara = (act, f) => { const ant = f(prevs[0]); const media = Math.round(prevs.reduce((s, p) => s + f(p), 0) / 3);
    return { actual: mdEur(act), mes_anterior: mdEur(ant), diferencia_mes_anterior: mdEur(act - ant), pct_mes_anterior: mdPct(act - ant, Math.abs(ant)), media_3m: mdEur(media), diferencia_media_3m: mdEur(act - media), pct_media_3m: mdPct(act - media, Math.abs(media)) }; };
  const ing = c(md.ingresos.total); const gas = c(md.gasto.total); const aho = c(md.balance);
  const cmpC = {}; md.comparacion_3m.por_categoria.forEach((x) => { cmpC[x.categoria] = x; });
  const top = md.gasto.por_categoria.slice(0, 3).map((x) => ({ categoria: x.categoria, total: x.total, pct: x.pct, media_3m: cmpC[x.categoria].media_3m, variacion: cmpC[x.categoria].diferencia, variacion_pct: cmpC[x.categoria].pct }));
  const pres = md.presupuesto.items.filter((i) => i.estado !== 'ok').map((i) => ({ categoria: i.categoria, limite_mensual: i.limite_mensual, consumido: i.consumido, pct: i.pct, estado: i.estado }));
  const validas = (e.facturas || []).filter((f) => f && Number(f.cliente_id) === cid && MD_ESTADOS_GASTO.includes(f.estado));
  const importe = (f) => { let t = f.total_eur; if (t === null || t === undefined || t === '') t = !f.moneda || f.moneda === 'EUR' ? f.total : null; return t === null || !Number.isFinite(Number(t)) ? null : mdCent(t); };
  const revisar = validas.filter((f) => f.estado === 'revisar').sort((a, b) => a.id - b.id);
  const limite = mdSumaDias(hoy, 15);
  const venc = validas.filter((f) => f.estado_pago !== 'pagada' && f.fecha_vencimiento && f.fecha_vencimiento >= hoy && f.fecha_vencimiento <= limite)
    .sort((a, b) => (a.fecha_vencimiento < b.fecha_vencimiento ? -1 : a.fecha_vencimiento > b.fecha_vencimiento ? 1 : a.id - b.id))
    .map((f) => ({ id: f.id, proveedor: f.proveedor || f.proveedor_norm || '', fecha_vencimiento: f.fecha_vencimiento, importe: importe(f) === null ? null : mdEur(importe(f)) }));
  const grupos = {};
  for (const f of validas) { if ((f.tipo_gasto === 'suscripcion' || f.tipo_gasto === 'contrato') && f.fecha_emision && f.fecha_emision.slice(0, 7) <= mes && importe(f) !== null) { const k = f.proveedor_norm || f.proveedor || ''; (grupos[k] = grupos[k] || []).push(f); } }
  const subidas = [];
  for (const k of Object.keys(grupos).sort()) {
    const l = grupos[k].sort((a, b) => (a.fecha_emision < b.fecha_emision ? -1 : a.fecha_emision > b.fecha_emision ? 1 : a.id - b.id));
    if (l.length < 2) continue; const u = l[l.length - 1]; const a = l[l.length - 2];
    if (u.fecha_emision.slice(0, 7) === mes && importe(u) > importe(a)) subidas.push({ proveedor: u.proveedor || k, anterior: mdEur(importe(a)), actual: mdEur(importe(u)), diferencia: mdEur(importe(u) - importe(a)) });
  }
  const mt = calcularMetas({ cliente, hoy, ingresos: comun.ingresos, facturas: comun.facturas, metas: e.metas || [] });
  const metas = mt.items.filter((m) => m.activa).map((m) => ({ id: m.id, nombre: m.nombre, pct_conseguido: m.pct_conseguido, restante: m.restante, estado: m.estado }));
  const sinDatos = ing === 0 && gas === 0;
  const dif = (v) => (v >= 0 ? '+' : '−') + mdFmtEur(Math.abs(v));
  const L = [];
  L.push('Resumen de ' + mdMesNombre(mes) + ' · ' + cliente.nombre + (sinDatos ? ' (sin ingresos ni gastos registrados este mes)' : ''));
  L.push('Ingresos: ' + mdFmtEur(ing) + ' (mes anterior ' + mdFmtEur(c(prevs[0].ingresos.total)) + '; media de 3 meses ' + mdFmtEur(Math.round(prevs.reduce((s, p) => s + c(p.ingresos.total), 0) / 3)) + ').');
  L.push('Gasto: ' + mdFmtEur(gas) + ' (mes anterior ' + mdFmtEur(c(prevs[0].gasto.total)) + '; media de 3 meses ' + mdFmtEur(Math.round(prevs.reduce((s, p) => s + c(p.gasto.total), 0) / 3)) + ').');
  L.push('Ahorro: ' + mdFmtEur(aho) + (md.tasa_ahorro_pct === null ? ' (sin ingresos no hay tasa de ahorro)' : ' (tasa de ahorro ' + mdFmtPct(md.tasa_ahorro_pct) + ')') + '; mes anterior ' + mdFmtEur(c(prevs[0].balance)) + '.');
  L.push(top.length ? 'Mayores gastos: ' + top.map((t) => t.categoria + ' ' + mdFmtEur(c(t.total)) + (t.variacion_pct === null ? ' (nuevo)' : ' (' + dif(c(t.variacion)) + ' sobre su media)')).join('; ') + '.' : 'Mayores gastos: ninguno este mes.');
  L.push(md.presupuesto.items.length === 0 ? 'Presupuestos: aún no tienes ninguno.' : pres.length === 0 ? 'Presupuestos: todos dentro del límite.' : 'Presupuestos: ' + pres.map((p) => p.categoria + (p.estado === 'superado' ? ' superado' : ' cerca del límite') + ' (' + mdFmtEur(c(p.consumido)) + ' de ' + mdFmtEur(c(p.limite_mensual)) + ')').join('; ') + '.');
  L.push('Facturas por revisar: ' + revisar.length + '.');
  L.push(venc.length ? 'Vencimientos en los próximos 15 días: ' + venc.map((v) => v.proveedor + ' ' + mdFechaDMA(v.fecha_vencimiento) + (v.importe === null ? '' : ' (' + mdFmtEur(c(v.importe)) + ')')).join('; ') + '.' : 'Vencimientos en los próximos 15 días: ninguno.');
  if (subidas.length) L.push('Suscripciones que suben: ' + subidas.map((s) => s.proveedor + ' ' + mdFmtEur(c(s.anterior)) + ' → ' + mdFmtEur(c(s.actual))).join('; ') + '.');
  L.push(metas.length ? 'Metas: ' + metas.map((m) => m.nombre + ' ' + mdFmtPct(m.pct_conseguido) + ' (' + m.estado.replace('_', ' ') + ')').join('; ') + '.' : 'Metas: sin metas activas.');
  return { cliente: { id: cid, nombre: cliente.nombre }, mes, hoy, ingresos: compara(ing, (p) => c(p.ingresos.total)), gasto: compara(gas, (p) => c(p.gasto.total)),
    ahorro: Object.assign(compara(aho, (p) => c(p.balance)), { tasa_ahorro_pct: md.tasa_ahorro_pct, tasa_mes_anterior_pct: prevs[0].tasa_ahorro_pct }),
    top_categorias: top, presupuestos_en_riesgo: pres, facturas_por_revisar: { num: revisar.length, ids: revisar.slice(0, 20).map((f) => f.id) }, vencimientos_15_dias: venc,
    suscripciones_subida: subidas, metas, texto: L.join('\n'), lineas: L.length, sin_datos: sinDatos, avisos: md.avisos };
}
function mdSumaDias(iso, n) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8) + n)).toISOString().slice(0, 10); }
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
  fv.sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.id - y.id)); revisar.sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.id - y.id));
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
  L.push(retTotal > 0 ? 'Retenciones de IRPF soportadas en facturas: ' + mdFmtEur(retTotal) + ' (' + ret.length + (ret.length === 1 ? ' factura' : ' facturas') + ').' : 'Retenciones de IRPF en facturas: ninguna.');
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
// ---- fase 4b etapa 2: deudas y préstamos (sistema francés, céntimos enteros; orientativo) ----
const DEUDA_TIPOS = ['hipoteca', 'prestamo', 'coche', 'tarjeta', 'otro'];
const DEUDA_COLS = ['cliente_id', 'nombre', 'tipo', 'capital_inicial', 'tipo_interes_anual', 'plazo_meses', 'fecha_inicio', 'cuota_mensual', 'dia_pago', 'amortizado_extra', 'activa', 'creada'];
const DEUDA_LIMITE_CARGA = 35; // % de los ingresos del mes a partir del cual se avisa
function deudaCuotaFrancesa(cap, r, n) { // cap en céntimos, r = interés mensual (fracción), n meses
  if (cap <= 0 || n <= 0) return 0;
  return r === 0 ? Math.round(cap / n) : Math.round(cap * r / (1 - Math.pow(1 + r, -n)));
}
function deudaFecha(d, k) { // fecha de la cuota k (k=1: un mes después de fecha_inicio) con el día de pago
  const ini = String(d.fecha_inicio); const mes = mdMesMas(ini.slice(0, 7), k); const dia = d.dia_pago ? Number(d.dia_pago) : Number(ini.slice(8));
  return mes + '-' + String(Math.min(dia, mdDiasMes(mes))).padStart(2, '0');
}
function deudaProyectar(saldo, r, cuota) { // cuotas futuras con la cuota dada; la última se ajusta
  let s = saldo, meses = 0, intereses = 0, pagado = 0, noCubre = false;
  while (s > 0 && meses < 1200) {
    const i = Math.round(s * r);
    if (r > 0 && cuota <= i) { noCubre = true; break; }
    meses++; intereses += i;
    const a = cuota - i;
    if (a >= s) { pagado += s + i; s = 0; } else { s -= a; pagado += cuota; }
  }
  return { meses, intereses, pagado, noCubre, restante: s };
}
function deudaEstado(d, hoy) {
  const cap = mdCent(d.capital_inicial); const r = Number(d.tipo_interes_anual) / 1200; const n = Number(d.plazo_meses);
  const teorica = deudaCuotaFrancesa(cap, r, n); const indicada = d.cuota_mensual !== null && d.cuota_mensual !== undefined && d.cuota_mensual !== '';
  const cuota = indicada ? mdCent(d.cuota_mensual) : teorica; const extra = mdCent(d.amortizado_extra || 0);
  let saldo = cap, intPag = 0, pag = 0;
  for (let k = 1; k <= 1200 && saldo > 0 && deudaFecha(d, k) <= hoy; k++) {
    const i = Math.round(saldo * r); const a = Math.max(Math.min(cuota - i, saldo), 0); saldo -= a; intPag += i; pag++;
  }
  const saldoHoy = Math.max(saldo - extra, 0);
  return { cap, r, n, teorica, indicada, cuota, extra, pag, intPag, saldoHoy, proy: deudaProyectar(saldoHoy, r, cuota) };
}
function calcularDeuda(d, hoy) {
  const s = deudaEstado(d, hoy); const avisos = [];
  const liquidada = s.saldoHoy === 0; const fin = s.proy.meses > 0 ? deudaFecha(d, s.pag + s.proy.meses) : (liquidada ? deudaFecha(d, Math.max(s.pag, 1)) : null);
  if (Number(d.tipo_interes_anual) === 0) avisos.push('Préstamo sin intereses: la cuota es el capital entre el plazo.');
  if (d.tipo === 'tarjeta') avisos.push('Tarjeta: se calcula como un préstamo simple con la cuota indicada; el interés real de una tarjeta revolving suele ser muy alto y varía con cada compra.');
  if (s.indicada && Math.abs(s.cuota - s.teorica) > 1) avisos.push('La cuota indicada (' + mdFmtEur(s.cuota) + ') difiere de la calculada por el sistema francés (' + mdFmtEur(s.teorica) + ').');
  if (s.proy.noCubre) avisos.push('La cuota no cubre los intereses mensuales: la deuda no se amortizaría con esta cuota.');
  if (d.activa === false) avisos.push('Deuda marcada como no activa: no cuenta en la carga mensual.');
  const prox = !liquidada && s.proy.meses > 0 ? { fecha: deudaFecha(d, s.pag + 1), importe: mdEur(Math.min(s.cuota, s.saldoHoy + Math.round(s.saldoHoy * s.r))) } : null;
  return { id: d.id, cliente_id: d.cliente_id, nombre: d.nombre, tipo: d.tipo, capital_inicial: mdEur(s.cap), tipo_interes_anual: Number(d.tipo_interes_anual), plazo_meses: s.n,
    fecha_inicio: d.fecha_inicio, dia_pago: d.dia_pago === undefined || d.dia_pago === null ? null : Number(d.dia_pago), amortizado_extra: mdEur(s.extra), activa: d.activa !== false,
    cuota_mensual: mdEur(s.cuota), cuota_calculada: mdEur(s.teorica), cuota_indicada: s.indicada, estado: liquidada ? 'liquidada' : d.activa === false ? 'inactiva' : 'vigente',
    cuotas_pagadas: s.pag, capital_pendiente: mdEur(s.saldoHoy), capital_amortizado: mdEur(s.cap - s.saldoHoy), pct_amortizado: s.cap > 0 ? mdPct(s.cap - s.saldoHoy, s.cap) : null,
    intereses_pagados: mdEur(s.intPag), intereses_por_pagar: mdEur(s.proy.intereses), meses_restantes: s.proy.noCubre ? null : s.proy.meses, fecha_fin: s.proy.noCubre ? null : fin,
    proximo_vencimiento: prox, avisos };
}
function simularDeuda(d, hoy, b) {
  const errores = []; const extra = mdNumero(b && b.amortizacion_extra); const tipo = b && b.tipo !== undefined ? b.tipo : 'reducir_plazo';
  if (extra === null || !(extra > 0)) errores.push('"amortizacion_extra" debe ser un importe en euros mayor que 0.');
  if (!['reducir_cuota', 'reducir_plazo'].includes(tipo)) errores.push('"tipo" debe ser reducir_cuota o reducir_plazo.');
  if (errores.length) return { status: 422, body: { error: 'Simulación no válida.', detalles: errores } };
  const s = deudaEstado(d, hoy); const e = mdCent(extra);
  if (s.saldoHoy === 0) return { status: 422, body: { error: 'Simulación no válida.', detalles: ['La deuda ya está liquidada.'] } };
  if (e > s.saldoHoy) return { status: 422, body: { error: 'Simulación no válida.', detalles: ['La amortización (' + mdFmtEur(e) + ') supera el capital pendiente (' + mdFmtEur(s.saldoHoy) + ').'] } };
  if (s.proy.noCubre) return { status: 422, body: { error: 'Simulación no válida.', detalles: ['Con la cuota actual la deuda no se amortiza; corrige la cuota primero.'] } };
  const nuevo = s.saldoHoy - e; const cuotaNueva = tipo === 'reducir_cuota' ? deudaCuotaFrancesa(nuevo, s.r, s.proy.meses) : s.cuota;
  const p = deudaProyectar(nuevo, s.r, cuotaNueva); const fin = (m) => (m > 0 ? deudaFecha(d, s.pag + m) : hoy);
  const antes = { capital_pendiente: mdEur(s.saldoHoy), cuota_mensual: mdEur(s.cuota), meses_restantes: s.proy.meses, fecha_fin: fin(s.proy.meses), intereses_por_pagar: mdEur(s.proy.intereses), total_a_pagar: mdEur(s.proy.pagado) };
  const despues = { capital_pendiente: mdEur(nuevo), cuota_mensual: mdEur(cuotaNueva), meses_restantes: p.meses, fecha_fin: fin(p.meses), intereses_por_pagar: mdEur(p.intereses), total_a_pagar: mdEur(p.pagado) };
  const avisos = ['Estimación orientativa: confirma con tu banco las comisiones por amortización anticipada y el efecto real en tu cuota.'];
  return { status: 200, body: { deuda: { id: d.id, nombre: d.nombre }, tipo, amortizacion_extra: mdEur(e), antes, despues, ahorro_intereses: mdEur(s.proy.intereses - p.intereses),
    meses_ahorrados: s.proy.meses - p.meses, cuota_ahorrada: mdEur(s.cuota - cuotaNueva), avisos } };
}
function validarDeuda(b, actual) {
  const errores = []; const f = Object.assign({}, actual || {}); const tiene = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (tiene('nombre')) { const t = typeof b.nombre === 'string' ? b.nombre.trim() : ''; if (!t || t.length > 80) errores.push('"nombre" es obligatorio (máx. 80 caracteres).'); else f.nombre = t; } else if (!actual) errores.push('"nombre" es obligatorio (máx. 80 caracteres).');
  if (tiene('tipo')) { if (!DEUDA_TIPOS.includes(b.tipo)) errores.push('"tipo" debe ser uno de: ' + DEUDA_TIPOS.join(', ') + '.'); else f.tipo = b.tipo; } else if (!actual) errores.push('"tipo" debe ser uno de: ' + DEUDA_TIPOS.join(', ') + '.');
  const num = (k, txt, ok, def) => { if (tiene(k)) { const v = mdNumero(b[k]); if (v === null || !ok(v)) errores.push(txt); else f[k] = v; } else if (!actual) { if (def === undefined) errores.push(txt); else f[k] = def; } };
  num('capital_inicial', '"capital_inicial" debe ser un importe mayor que 0.', (v) => v > 0 && v < 1e9);
  num('tipo_interes_anual', '"tipo_interes_anual" debe estar entre 0 y 100 (%).', (v) => v >= 0 && v <= 100);
  num('plazo_meses', '"plazo_meses" debe ser un entero entre 1 y 720.', (v) => Number.isInteger(v) && v >= 1 && v <= 720);
  num('amortizado_extra', '"amortizado_extra" debe ser un importe mayor o igual que 0.', (v) => v >= 0, 0);
  if (tiene('fecha_inicio')) { if (!mdFechaValida(b.fecha_inicio)) errores.push('"fecha_inicio" debe tener el formato AAAA-MM-DD.'); else f.fecha_inicio = b.fecha_inicio; } else if (!actual) errores.push('"fecha_inicio" debe tener el formato AAAA-MM-DD.');
  if (tiene('cuota_mensual')) { if (b.cuota_mensual === null || b.cuota_mensual === '') f.cuota_mensual = null; else { const v = mdNumero(b.cuota_mensual); if (v === null || !(v > 0)) errores.push('"cuota_mensual" debe ser un importe mayor que 0 o null.'); else f.cuota_mensual = v; } } else if (!actual) f.cuota_mensual = null;
  if (tiene('dia_pago')) { if (b.dia_pago === null || b.dia_pago === '') f.dia_pago = null; else { const v = mdNumero(b.dia_pago); if (v === null || !Number.isInteger(v) || v < 1 || v > 31) errores.push('"dia_pago" debe ser un entero entre 1 y 31 o null.'); else f.dia_pago = v; } } else if (!actual) f.dia_pago = null;
  if (tiene('activa')) { if (typeof b.activa !== 'boolean') errores.push('"activa" debe ser verdadero o falso.'); else f.activa = b.activa; } else if (!actual) f.activa = true;
  if (!errores.length && f.amortizado_extra > f.capital_inicial) errores.push('"amortizado_extra" no puede superar el capital inicial.');
  return { errores, fila: f };
}
function calcularResumenDeudas(e) {
  const { cliente, hoy } = e; const cid = Number(cliente.id); const mes = hoy.slice(0, 7);
  const todas = (e.deudas || []).filter((d) => Number(d.cliente_id) === cid).sort((a, b) => a.id - b.id).map((d) => calcularDeuda(d, hoy));
  const vig = todas.filter((x) => x.estado === 'vigente');
  const carga = vig.reduce((s, x) => s + mdCent(x.cuota_mensual), 0); const ing = mdIngresosMes(e.ingresos || [], cid, mes).total; const pct = mdPct(carga, ing);
  const avisos = []; const supera = pct !== null && pct > DEUDA_LIMITE_CARGA;
  if (supera) avisos.push('Tus cuotas de deudas suponen un ' + mdFmtPct(pct) + ' de tus ingresos del mes: por encima del ' + DEUDA_LIMITE_CARGA + ' % que suele considerarse prudente.');
  if (carga > 0 && ing === 0) avisos.push('Hay cuotas de deudas pero no hay ingresos registrados este mes: añade tus ingresos en «Mi dinero» para medir la carga.');
  const lim = mdSumaDias(hoy, 30);
  const prox = vig.filter((x) => x.proximo_vencimiento && x.proximo_vencimiento.fecha <= lim).map((x) => ({ id: x.id, nombre: x.nombre, fecha: x.proximo_vencimiento.fecha, importe: x.proximo_vencimiento.importe }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
  return { cliente: { id: cid, nombre: cliente.nombre }, mes, hoy, num_deudas: todas.length, num_vigentes: vig.length, capital_pendiente: mdEur(vig.reduce((s, x) => s + mdCent(x.capital_pendiente), 0)),
    intereses_por_pagar: mdEur(vig.reduce((s, x) => s + mdCent(x.intereses_por_pagar), 0)), carga_mensual: mdEur(carga), ingresos_mes: mdEur(ing), pct_ingresos: pct, supera_limite: supera, limite_pct: DEUDA_LIMITE_CARGA,
    proximos_vencimientos: prox, avisos };
}
// === COMÚN Mi dinero: fin ===
const RUTAS = ['GET /ingresos', 'POST /ingresos', 'PATCH /ingresos', 'DELETE /ingresos', 'GET /presupuestos', 'PUT /presupuestos', 'GET /mi-dinero', 'GET /metas', 'POST /metas', 'PATCH /metas', 'DELETE /metas', 'POST /metas/aportar', 'GET /resumen-mensual', 'GET /renta', 'GET /deudas', 'POST /deudas', 'PATCH /deudas', 'DELETE /deudas', 'POST /deudas/simular', 'GET /deudas/resumen'];
const ruta = RUTAS.find((r) => $(r).isExecuted);
const e = $(ruta).first().json || {};
const q = e.query && typeof e.query === 'object' ? e.query : {};
const cuerpo = e.body && typeof e.body === 'object' && !Array.isArray(e.body) ? e.body : null;
const filas = (n) => $(n).all().map((i) => i.json).filter((r) => r && r.id !== undefined);
const ingresos = filas('Leer ingresos'); const presupuestos = filas('Leer presupuestos'); const categorias = filas('Leer categorías').filter((c) => c.activa !== false);
const metas = filas('Leer metas'); const deudas = filas('Leer deudas'); const clientes = filas('Leer clientes'); const facturas = filas('Leer facturas');
const ahora = $now.setZone('Europe/Madrid'); const hoy = ahora.toISODate();
const val = (k) => { const v = Array.isArray(q[k]) ? q[k][0] : q[k]; return v === undefined || v === null ? '' : String(v).trim(); };
const sal = (status, body, extra) => [{ json: Object.assign({ status, body, accion: 'none' }, extra || {}) }];
const e400 = (m, d) => sal(400, d ? { error: m, detalles: d } : { error: m });
const COLS = ['cliente_id', 'tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo', 'creado'];
const salidaIng = (r) => ({ id: r.id, cliente_id: r.cliente_id, tipo: r.tipo, concepto: r.concepto, importe: r.importe, periodicidad: r.periodicidad, fecha_inicio: r.fecha_inicio,
  fecha_fin: r.fecha_fin === undefined ? null : r.fecha_fin, dia_cobro: r.dia_cobro === undefined ? null : r.dia_cobro, activo: r.activo !== false, creado: r.creado || null });
const esEntero = (s) => /^\d{1,12}$/.test(String(s));
// cliente_id: de la query o del cuerpo
const cidTxt = val('cliente_id') || (cuerpo && cuerpo.cliente_id !== undefined && cuerpo.cliente_id !== null ? String(cuerpo.cliente_id).trim() : '');

if (ruta === 'GET /ingresos') {
  if (cidTxt && !esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  let l = ingresos; if (cidTxt) l = l.filter((r) => Number(r.cliente_id) === Number(cidTxt));
  l = l.slice().sort((a, b) => a.id - b.id).map(salidaIng);
  return sal(200, { items: l, total: l.length });
}
if (ruta === 'GET /presupuestos') {
  if (!cidTxt) return e400('"cliente_id" es obligatorio.');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const orden = {}; categorias.forEach((c, i) => { orden[c.nombre] = c.orden === undefined || c.orden === null ? 1000 + i : c.orden; });
  const l = presupuestos.filter((p) => Number(p.cliente_id) === Number(cidTxt) && p.activo !== false).sort((a, b) => (orden[a.categoria] ?? 9999) - (orden[b.categoria] ?? 9999))
    .map((p) => ({ id: p.id, categoria: p.categoria, limite_mensual: p.limite_mensual, activo: true }));
  return sal(200, { cliente_id: Number(cidTxt), items: l, total: l.length });
}
if (ruta === 'GET /mi-dinero') {
  const extra = Object.keys(q).filter((k) => !['cliente_id', 'mes'].includes(k));
  if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: cliente_id, mes.`);
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const mes = val('mes') || hoy.slice(0, 7);
  if (!mdMesValido(mes)) return e400('"mes" debe tener el formato AAAA-MM.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  return sal(200, calcularMiDinero({ cliente: cli, mes, hoy, ingresos, presupuestos, categorias, facturas }));
}
if (ruta === 'GET /renta') {
  const extra = Object.keys(q).filter((k) => !['cliente_id', 'anio'].includes(k));
  if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: cliente_id, anio.`);
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const anio = val('anio') || String(rentaAnioDefecto(hoy));
  if (!rentaAnioValido(anio)) return e400('"anio" debe tener el formato AAAA.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  return sal(200, calcularRenta({ cliente: cli, anio, hoy, ingresos, presupuestos, categorias, facturas }));
}
// ---- fase 4b etapa 2: deudas y préstamos ----
if (ruta.includes('/deudas')) {
  const clienteDe = (id) => clientes.find((c) => Number(c.id) === Number(id));
  const nuevaFila = (r, base) => { const fila = {}; DEUDA_COLS.forEach((c) => { fila[c] = r[c] === undefined ? (base && base[c] !== undefined ? base[c] : null) : r[c]; }); return fila; };
  const salidaDeuda = (fila, id) => calcularDeuda(Object.assign({}, fila, { id }), hoy);
  if (ruta === 'GET /deudas' || ruta === 'GET /deudas/resumen') {
    const extra = Object.keys(q).filter((k) => k !== 'cliente_id');
    if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitido: cliente_id.`);
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (ruta === 'GET /deudas/resumen') return sal(200, calcularResumenDeudas({ cliente: cli, hoy, ingresos, deudas }));
    const items = deudas.filter((d) => Number(d.cliente_id) === Number(cidTxt)).sort((a, b) => a.id - b.id).map((d) => calcularDeuda(d, hoy));
    return sal(200, { cliente_id: Number(cidTxt), items, total: items.length });
  }
  if (ruta === 'POST /deudas') {
    if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const ok = DEUDA_COLS.filter((c) => c !== 'creada');
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
    const r = validarDeuda(cuerpo, null);
    if (r.errores.length) return sal(422, { error: 'Deuda no válida.', detalles: r.errores });
    const fila = nuevaFila(Object.assign({}, r.fila, { cliente_id: Number(cidTxt), creada: ahora.toISO() }));
    return sal(201, null, { accion: 'insert_deuda', fila, deuda_calc: salidaDeuda(fila, 0) });
  }
  const idTxt = val('id');
  if (!idTxt) return e400('Falta el parámetro "id".');
  if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
  const actual = deudas.find((r) => Number(r.id) === Number(idTxt));
  if (!actual) return sal(404, { error: 'No existe la deuda.' });
  if (ruta === 'DELETE /deudas') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_deuda', id: actual.id });
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (ruta === 'POST /deudas/simular') {
    const fuera = Object.keys(cuerpo).filter((k) => !['amortizacion_extra', 'tipo'].includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, ['Admitidos: amortizacion_extra, tipo.']);
    const r = simularDeuda(actual, hoy, cuerpo);
    return sal(r.status, r.body);
  }
  const okP = DEUDA_COLS.filter((c) => c !== 'creada' && c !== 'cliente_id');
  const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
  if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
  const rp = validarDeuda(cuerpo, actual);
  if (rp.errores.length) return sal(422, { error: 'Deuda no válida.', detalles: rp.errores });
  const fila = nuevaFila(rp.fila, actual);
  return sal(200, null, { accion: 'update_deuda', id: actual.id, fila, deuda_calc: salidaDeuda(fila, actual.id) });
}
// ---- fase 4a: metas de ahorro y resumen mensual ----
if (ruta.includes('metas') || ruta === 'GET /resumen-mensual') {
  const clienteDe = (id) => clientes.find((c) => Number(c.id) === Number(id));
  const nuevaFila = (r, base) => { const fila = {}; MD_META_COLS.forEach((c) => { fila[c] = r[c] === undefined ? (base && base[c] !== undefined ? base[c] : null) : r[c]; }); return fila; };
  const salidaMeta = (fila, id) => { const cli = clienteDe(fila.cliente_id) || { id: fila.cliente_id, nombre: '' };
    const lista = metas.filter((m) => Number(m.id) !== Number(id)).concat([Object.assign({}, fila, { id })]);
    return calcularMetas({ cliente: cli, hoy, ingresos, facturas, metas: lista }).items.find((m) => Number(m.id) === Number(id)); };
  if (ruta === 'GET /metas' || ruta === 'GET /resumen-mensual') {
    const permitidos = ruta === 'GET /metas' ? ['cliente_id'] : ['cliente_id', 'mes'];
    const extra = Object.keys(q).filter((k) => !permitidos.includes(k));
    if (extra.length) return e400(`Parámetros desconocidos: ${extra.join(', ')}. Admitidos: ${permitidos.join(', ')}.`);
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const mes = val('mes') || hoy.slice(0, 7);
    if (ruta === 'GET /resumen-mensual' && !mdMesValido(mes)) return e400('"mes" debe tener el formato AAAA-MM.');
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (ruta === 'GET /metas') return sal(200, calcularMetas({ cliente: cli, hoy, ingresos, facturas, metas }));
    return sal(200, calcularResumenMensual({ cliente: cli, mes, hoy, ingresos, presupuestos, categorias, facturas, metas }));
  }
  if (ruta === 'POST /metas') {
    if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
    if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
    if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
    const ok = MD_META_COLS.filter((c) => c !== 'creada');
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const cli = clienteDe(cidTxt);
    if (!cli) return sal(404, { error: 'No existe el cliente.' });
    if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
    const r = validarMeta(cuerpo, null, hoy);
    if (r.errores.length) return sal(422, { error: 'Meta no válida.', detalles: r.errores });
    const fila = nuevaFila(Object.assign({}, r.fila, { cliente_id: Number(cidTxt), creada: ahora.toISO() }));
    return sal(201, null, { accion: 'insert_meta', fila, meta_calc: salidaMeta(fila, 0) });
  }
  const idTxt = val('id');
  if (!idTxt) return e400('Falta el parámetro "id".');
  if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
  const actual = metas.find((r) => Number(r.id) === Number(idTxt));
  if (!actual) return sal(404, { error: 'No existe la meta.' });
  if (ruta === 'DELETE /metas') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_meta', id: actual.id });
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (ruta === 'POST /metas/aportar') {
    const fuera = Object.keys(cuerpo).filter((k) => k !== 'importe');
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, ['Admitido: importe.']);
    const r = aportarMeta(actual, cuerpo.importe);
    if (r.error) return sal(422, { error: 'Aportación no válida.', detalles: [r.error] });
    const fila = nuevaFila(Object.assign({}, actual, { importe_ahorrado: r.ahorrado }));
    return sal(200, null, { accion: 'update_meta', id: actual.id, fila, meta_calc: salidaMeta(fila, actual.id), extra_body: { aportado: mdEur(mdCent(mdNumero(cuerpo.importe))) } });
  }
  const okP = MD_META_COLS.filter((c) => c !== 'creada' && c !== 'cliente_id');
  const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
  if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
  const rp = validarMeta(cuerpo, actual, hoy);
  if (rp.errores.length) return sal(422, { error: 'Meta no válida.', detalles: rp.errores });
  const fila = nuevaFila(rp.fila, actual);
  return sal(200, null, { accion: 'update_meta', id: actual.id, fila, meta_calc: salidaMeta(fila, actual.id) });
}
// ---- escrituras ----
if (ruta === 'PUT /presupuestos' || ruta === 'POST /ingresos') {
  if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
  if (!cidTxt) return e400('"cliente_id" es obligatorio (GET /clientes).');
  if (!esEntero(cidTxt)) return e400('"cliente_id" debe ser un entero positivo.');
  const cli = clientes.find((c) => Number(c.id) === Number(cidTxt));
  if (!cli) return sal(404, { error: 'No existe el cliente.' });
  if (cli.activo === false) return sal(422, { error: 'El cliente no está activo.' });
  const cid = Number(cidTxt);
  if (ruta === 'POST /ingresos') {
    const ok = ['cliente_id', 'tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo'];
    const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
    if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
    const r = validarIngreso(cuerpo, null);
    if (r.errores.length) return sal(422, { error: 'Ingreso no válido.', detalles: r.errores });
    const fila = {}; COLS.forEach((c) => { fila[c] = r.fila[c] === undefined ? null : r.fila[c]; });
    fila.cliente_id = cid; fila.creado = ahora.toISO();
    return sal(201, null, { accion: 'insert_ingreso', fila });
  }
  const ok = ['cliente_id', 'presupuestos'];
  const fuera = Object.keys(cuerpo).filter((k) => !ok.includes(k));
  if (fuera.length) return e400(`Campos no permitidos: ${fuera.join(', ')}.`, [`Admitidos: ${ok.join(', ')}.`]);
  const r = validarPresupuestos(cuerpo.presupuestos, categorias.map((c) => c.nombre));
  if (r.errores.length) return sal(422, { error: 'Presupuestos no válidos.', detalles: r.errores });
  return sal(200, null, { accion: 'put_presupuestos', cliente_id: cid, filas: r.filas.map((f) => Object.assign({ cliente_id: cid }, f, { activo: true })) });
}
// PATCH / DELETE /ingresos?id=N
const idTxt = val('id');
if (!idTxt) return e400('Falta el parámetro "id".');
if (!esEntero(idTxt)) return e400('"id" debe ser un entero positivo.');
const actual = ingresos.find((r) => Number(r.id) === Number(idTxt));
if (!actual) return sal(404, { error: 'No existe el ingreso.' });
if (ruta === 'DELETE /ingresos') return sal(200, { borrado: true, id: actual.id }, { accion: 'delete_ingreso', id: actual.id });
if (!cuerpo || !Object.keys(cuerpo).length) return e400('El cuerpo debe ser un objeto JSON no vacío.');
const okP = ['tipo', 'concepto', 'importe', 'periodicidad', 'fecha_inicio', 'fecha_fin', 'dia_cobro', 'activo'];
const fueraP = Object.keys(cuerpo).filter((k) => !okP.includes(k));
if (fueraP.length) return e400(`Campos no permitidos: ${fueraP.join(', ')}.`, [`Admitidos: ${okP.join(', ')}.`]);
const rp = validarIngreso(cuerpo, actual);
if (rp.errores.length) return sal(422, { error: 'Ingreso no válido.', detalles: rp.errores });
const fila = {}; COLS.forEach((c) => { fila[c] = rp.fila[c] === undefined ? null : rp.fila[c]; });
return sal(200, null, { accion: 'update_ingreso', id: actual.id, fila });
