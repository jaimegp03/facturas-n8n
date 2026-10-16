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
