// FACT — Finiquito: POST /finiquito. Todo en céntimos enteros; sin LLM. Estimación orientativa, sin valor de asesoramiento.
// === COMÚN Finiquito: inicio ===
// (Función pura: la misma copia vive en web/index.html para el modo demo; no uses globales de n8n aquí.)
function calcularFiniquito(entrada, hoyISO) {
  const TIPOS = ['dimision', 'fin_contrato_temporal', 'despido_improcedente', 'despido_objetivo', 'despido_disciplinario_procedente', 'mutuo_acuerdo', 'fin_obra_o_servicio'];
  const ETIQ = { dimision: 'Dimisión', fin_contrato_temporal: 'Fin de contrato temporal', despido_improcedente: 'Despido improcedente', despido_objetivo: 'Despido objetivo', despido_disciplinario_procedente: 'Despido disciplinario procedente', mutuo_acuerdo: 'Mutuo acuerdo', fin_obra_o_servicio: 'Fin de obra o servicio' };
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const errores = [];
  const vacio = (v) => v === undefined || v === null || v === '';
  const numero = (k, def, min, max, entero) => {
    let v = e[k];
    if (vacio(v)) return def;
    if (typeof v === 'string') v = v.trim().replace(',', '.');
    const n = typeof v === 'boolean' ? NaN : Number(v);
    if (!Number.isFinite(n)) { errores.push(`"${k}" debe ser un número.`); return def; }
    if (n < min || n > max) { errores.push(`"${k}" debe estar entre ${min} y ${max}.`); return def; }
    if (entero && !Number.isInteger(n)) { errores.push(`"${k}" debe ser un entero.`); return def; }
    return n;
  };
  const booleano = (k, def) => {
    const v = e[k];
    if (vacio(v)) return def;
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    errores.push(`"${k}" debe ser true o false.`);
    return def;
  };
  const dia = (s) => { // 'AAAA-MM-DD' -> días desde 1970 (UTC) o null
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const f = new Date(t);
    if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || y < 1950 || y > 2100) return null;
    return t / 86400000;
  };
  const ymd = (n) => { const f = new Date(n * 86400000); return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()]; };
  const iso = (n) => { const [y, m, d] = ymd(n); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const sumaMeses = (n, k) => { // n + k meses, ajustando el día al fin de mes
    const [y, m, d] = ymd(n);
    const tot = y * 12 + (m - 1) + k;
    const ny = Math.floor(tot / 12), nm = tot % 12;
    const ult = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return Date.UTC(ny, nm, Math.min(d, ult)) / 86400000;
  };
  // Meses completos y días sobrantes entre a (incluido) y b (excluido)
  const diferencia = (a, b) => {
    const [ya, ma, da] = ymd(a), [yb, mb, db] = ymd(b);
    let m = (yb - ya) * 12 + (mb - ma);
    if (db < da) m -= 1;
    if (m < 0) m = 0;
    return { meses: m, dias: b - sumaMeses(a, m) };
  };
  const mesesCeil = (a, b) => { if (b <= a) return 0; const r = diferencia(a, b); return r.meses + (r.dias > 0 ? 1 : 0); };
  const fmt = (c) => { const s = Math.abs(c); const ent = Math.floor(s / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return `${c < 0 ? '-' : ''}${ent},${String(s % 100).padStart(2, '0')} €`; };
  const f2 = (x) => (Math.round(x * 100) / 100).toString().replace('.', ',');
  const cent = (x) => Math.round(x + 1e-9);

  const tipo = e.tipo_extincion;
  if (!TIPOS.includes(tipo)) errores.push(`"tipo_extincion" debe ser uno de: ${TIPOS.join(', ')}.`);
  const ini = dia(e.fecha_inicio), fin = dia(e.fecha_fin);
  if (ini === null) errores.push('"fecha_inicio" debe ser una fecha válida AAAA-MM-DD.');
  if (fin === null) errores.push('"fecha_fin" debe ser una fecha válida AAAA-MM-DD.');
  if (ini !== null && fin !== null && fin < ini) errores.push('"fecha_fin" no puede ser anterior a "fecha_inicio".');
  if (ini !== null && fin !== null && fin >= ini && (fin - ini) > 366 * 60) errores.push('La antigüedad no puede superar 60 años.');
  const anual = numero('salario_bruto_anual', null, 0.01, 10000000);
  if (anual === null && !errores.some((x) => x.includes('salario_bruto_anual'))) errores.push('"salario_bruto_anual" es obligatorio y debe ser mayor que 0.');
  const numPagas = numero('num_pagas', 14, 12, 15, true);
  if (![12, 14, 15].includes(numPagas) && !errores.some((x) => x.includes('num_pagas'))) errores.push('"num_pagas" debe ser 12, 14 o 15.');
  const prorrat = booleano('pagas_prorrateadas', false);
  const vacAnuales = numero('dias_vacaciones_anuales', 30, 0, 366);
  const vacDisf = numero('dias_vacaciones_disfrutadas', 0, 0, 366);
  const preaviso = numero('preaviso_dias_incumplidos', 0, 0, 365);
  const irpfPct = numero('irpf_pct', 0, 0, 60);
  const ssPct = numero('ss_pct', 6.5, 0, 30);
  const pactada = numero('indemnizacion_pactada_dias_por_anio', 0, 0, 365);
  if (errores.length) return { status: 400, body: { error: 'Datos no válidos', detalles: errores } };

  const avisos = [];
  const anualC = cent(anual * 100);
  const extrasSeparadas = !prorrat && numPagas > 12;
  const sd = anualC / 365; // diario con prorrata de extras (base de la indemnización)
  const mensualOrd = extrasSeparadas ? anualC / numPagas : anualC / 12; // mensualidad de la paga ordinaria
  const sdBase = extrasSeparadas ? (mensualOrd * 12) / 365 : sd; // diario sin pagas extra (vacaciones)
  const pagaExtra = anualC / numPagas;
  const finExcl = fin + 1;

  // Antigüedad (ambos días incluidos)
  const dif = diferencia(ini, finExcl);
  const antig = { anios: Math.floor(dif.meses / 12), meses: dif.meses % 12, dias: dif.dias, dias_totales: finExcl - ini };
  const mesesTot = mesesCeil(ini, finExcl);

  // Conceptos del finiquito
  const [yf, mf, df] = ymd(fin);
  const inicioMes = Date.UTC(yf, mf - 1, 1) / 86400000;
  const ultimoMes = new Date(Date.UTC(yf, mf, 0)).getUTCDate();
  const desdeMes = Math.max(ini, inicioMes);
  let diasMes = fin - desdeMes + 1;
  if (desdeMes === inicioMes && df === ultimoMes) diasMes = 30;
  diasMes = Math.min(30, diasMes);
  const salarioMes = cent((mensualOrd / 30) * diasMes);

  const ini1 = Date.UTC(yf, 0, 1) / 86400000, fin1 = Date.UTC(yf, 11, 31) / 86400000;
  const diasAnio = fin1 - ini1 + 1;
  const diasTrabAnio = fin - Math.max(ini, ini1) + 1;
  const vacDev = (vacAnuales * diasTrabAnio) / diasAnio;
  const vacPend = vacDev - vacDisf;
  const vacImp = cent(vacPend * sdBase);
  if (vacPend < 0) avisos.push('Has disfrutado más vacaciones de las devengadas: se descuentan (solo procede si el convenio o el contrato lo permite).');

  let extrasImp = 0, extrasDet = '';
  if (extrasSeparadas) {
    const semIni = mf <= 6 ? ini1 : Date.UTC(yf, 6, 1) / 86400000;
    const semFin = mf <= 6 ? Date.UTC(yf, 5, 30) / 86400000 : fin1;
    const fracSem = (fin - Math.max(ini, semIni) + 1) / (semFin - semIni + 1);
    extrasDet = `Paga de ${mf <= 6 ? 'verano' : 'Navidad'}: ${f2(fracSem * 100)} % del semestre`;
    let imp = pagaExtra * fracSem;
    if (numPagas === 15) {
      const fracAnio = diasTrabAnio / diasAnio;
      imp += pagaExtra * fracAnio;
      extrasDet += ` + paga anual: ${f2(fracAnio * 100)} % del año`;
    }
    extrasImp = cent(imp);
  } else extrasDet = 'Pagas extra prorrateadas en la nómina: nada que liquidar aparte';

  const preavisoImp = cent(preaviso * sd);
  if (preaviso > 0 && tipo !== 'dimision') avisos.push('El descuento por preaviso se aplica aquí por indicarse días incumplidos; normalmente solo procede en la dimisión.');
  const subtotal = salarioMes + vacImp + extrasImp - preavisoImp;

  // Indemnización
  const CORTE = Date.UTC(2012, 1, 12) / 86400000;
  const MAX_DIAS = 720;
  let diasInd = 0, legalC = 0, detInd = '';
  let exentaPosible = false;
  const rotulo = { despido_improcedente: '33 días por año', despido_objetivo: '20 días por año', fin_contrato_temporal: '12 días por año', fin_obra_o_servicio: '12 días por año' };
  if (tipo === 'despido_improcedente') {
    exentaPosible = true;
    if (ini >= CORTE) {
      diasInd = Math.min((33 * mesesTot) / 12, MAX_DIAS);
      detInd = `33 días/año × ${mesesTot} meses / 12 (tope 720 días)`;
    } else {
      const mPre = mesesCeil(ini, Math.min(finExcl, CORTE));
      const mPost = Math.max(0, mesesTot - mPre);
      const dPre = (45 * mPre) / 12, dPost = (33 * mPost) / 12;
      if (dPre > MAX_DIAS) {
        diasInd = Math.min(dPre, 1260);
        detInd = `45 días/año × ${mPre} meses / 12 hasta el 11/02/2012 = ${f2(dPre)} días (supera 720: se conserva, tope 42 mensualidades; no se añade el tramo posterior)`;
        avisos.push('El tramo anterior al 12/02/2012 ya supera 720 días: se aplica ese importe con tope de 42 mensualidades y no se suma el tramo posterior.');
      } else {
        diasInd = Math.min(dPre + dPost, MAX_DIAS);
        detInd = `45 días/año × ${mPre} meses / 12 (hasta 11/02/2012) + 33 días/año × ${mPost} meses / 12 (desde 12/02/2012), tope 720 días`;
      }
    }
    legalC = cent(diasInd * sd);
  } else if (tipo === 'despido_objetivo') {
    exentaPosible = true;
    diasInd = (20 * mesesTot) / 12;
    legalC = Math.min(cent(diasInd * sd), anualC);
    detInd = `20 días/año × ${mesesTot} meses / 12 (tope 12 mensualidades = ${fmt(anualC)})`;
    if (cent(diasInd * sd) > anualC) diasInd = (anualC / sd);
  } else if (tipo === 'fin_contrato_temporal' || tipo === 'fin_obra_o_servicio') {
    diasInd = (12 * mesesTot) / 12;
    legalC = cent(diasInd * sd);
    detInd = `12 días/año × ${mesesTot} meses / 12`;
    if (ini < Date.UTC(2015, 0, 1) / 86400000) avisos.push('Contratos temporales anteriores al 1/1/2015: la indemnización puede ser de 8 días/año (o 12 progresivos según la fecha); revísalo con tu convenio.');
    if (tipo === 'fin_obra_o_servicio') avisos.push('El contrato de obra o servicio ya no existe en contratos nuevos desde la reforma laboral de 2021; el cálculo usa 12 días/año.');
  } else if (tipo === 'despido_disciplinario_procedente') {
    avisos.push('Despido disciplinario procedente: no genera indemnización. Si fuera declarado improcedente o nulo, el resultado cambiaría.');
  }
  let indemC = legalC;
  if (pactada > 0) {
    const pacC = cent(((pactada * mesesTot) / 12) * sd);
    if (pacC > legalC) {
      indemC = pacC;
      detInd = `${f2(pactada)} días/año pactados × ${mesesTot} meses / 12` + (legalC > 0 ? ` (mayor que la legal ${fmt(legalC)})` : '');
    } else if (legalC > 0) avisos.push('La indemnización pactada es inferior a la legal: se aplica la legal.');
  }
  if (indemC === 0 && !detInd) detInd = 'No genera indemnización legal';

  // Fiscalidad y Seguridad Social (estimaciones)
  const exentaC = exentaPosible ? Math.min(legalC, 18000000) : 0;
  const sujetaIndem = indemC - exentaC;
  const baseIrpf = Math.max(0, subtotal) + sujetaIndem;
  const retC = cent((baseIrpf * irpfPct) / 100);
  const ssC = cent((Math.max(0, subtotal) * ssPct) / 100);
  const brutoTotal = subtotal + indemC;
  const neto = brutoTotal - retC - ssC;

  // Avisos
  avisos.push('Estimación orientativa sin valor de asesoramiento ni de liquidación oficial: tu convenio colectivo o contrato pueden mejorar estos importes.');
  if (hoyISO && fin > dia(hoyISO)) avisos.push('La fecha de fin es futura: se calcula como previsión.');
  if (irpfPct === 0) avisos.push('Con IRPF 0 % no se estima retención; indica el porcentaje de tu nómina (o el que te comunique la empresa).');
  if (indemC > 0 && !exentaPosible) avisos.push('Esta indemnización se considera sujeta a IRPF (la exención del art. 7.e LIRPF es para despidos y ceses con indemnización legal obligatoria).');
  if (exentaPosible && legalC > 0) avisos.push('La indemnización legal está exenta de IRPF hasta el mínimo legal y 180.000 €; no se estima la reducción del 30 % de rentas irregulares del resto.');
  if (mesesTot > 0 && antig.dias > 0) avisos.push('Los meses incompletos se cuentan como mes entero al prorratear la indemnización.');
  if (extrasSeparadas) avisos.push('Pagas extra: se supone que las de 14 pagas se devengan por semestres (verano ene-jun, Navidad jul-dic) y la tercera de 15 pagas por año natural.');
  if (tipo === 'despido_improcedente') avisos.push('En el despido improcedente la empresa puede optar por readmitir; la indemnización es la alternativa.');

  const desglose = [
    { clave: 'salario', concepto: 'Salario de los días trabajados del último mes', detalle: `${diasMes} días × ${fmt(cent(mensualOrd / 30))}/día`, importe_cent: salarioMes, tipo: 'suma' },
    { clave: 'vacaciones', concepto: 'Vacaciones devengadas no disfrutadas', detalle: `${f2(vacDev)} devengadas − ${f2(vacDisf)} disfrutadas = ${f2(vacPend)} días × ${fmt(cent(sdBase))}/día`, importe_cent: vacImp, tipo: vacImp >= 0 ? 'suma' : 'resta' },
    { clave: 'pagas_extra', concepto: 'Parte proporcional de pagas extra', detalle: extrasDet, importe_cent: extrasImp, tipo: 'suma' },
    { clave: 'preaviso', concepto: 'Descuento por preaviso incumplido', detalle: `${f2(preaviso)} días × ${fmt(cent(sd))}/día`, importe_cent: 0 - preavisoImp, tipo: 'resta' },
    { clave: 'subtotal', concepto: 'Total finiquito (bruto)', detalle: '', importe_cent: subtotal, tipo: 'subtotal' },
    { clave: 'indemnizacion', concepto: 'Indemnización', detalle: detInd, importe_cent: indemC, tipo: 'suma' },
    { clave: 'bruto_total', concepto: 'Total bruto (finiquito + indemnización)', detalle: '', importe_cent: brutoTotal, tipo: 'subtotal' },
    { clave: 'irpf', concepto: 'Retención IRPF estimada', detalle: `${f2(irpfPct)} % sobre ${fmt(baseIrpf)}` + (exentaC > 0 ? ` (indemnización exenta: ${fmt(exentaC)})` : ''), importe_cent: 0 - retC, tipo: 'resta' },
    { clave: 'ss', concepto: 'Seguridad Social estimada', detalle: `${f2(ssPct)} % sobre ${fmt(Math.max(0, subtotal))}`, importe_cent: 0 - ssC, tipo: 'resta' },
    { clave: 'neto', concepto: 'Neto estimado', detalle: '', importe_cent: neto, tipo: 'total' },
  ];
  for (const l of desglose) { l.importe = l.importe_cent / 100; }
  const eur = (c) => c / 100;
  return {
    status: 200,
    body: {
      tipo_extincion: tipo, tipo_etiqueta: ETIQ[tipo], fecha_inicio: iso(ini), fecha_fin: iso(fin),
      antiguedad: antig, meses_indemnizacion: mesesTot,
      salario: { bruto_anual: eur(anualC), mensual_ordinario: eur(cent(mensualOrd)), diario_con_prorrata: Math.round(sd) / 100, diario_sin_extras: Math.round(sdBase) / 100 },
      dias: { salario_mes: diasMes, vacaciones_devengadas: Math.round(vacDev * 100) / 100, vacaciones_pendientes: Math.round(vacPend * 100) / 100, indemnizacion: Math.round(diasInd * 100) / 100 },
      conceptos: { salario_mes: eur(salarioMes), vacaciones: eur(vacImp), pagas_extra: eur(extrasImp), preaviso: eur(0 - preavisoImp) },
      subtotal_finiquito: eur(subtotal), indemnizacion: eur(indemC), indemnizacion_legal: eur(legalC), indemnizacion_exenta: eur(exentaC),
      bruto_total: eur(brutoTotal), retencion_irpf: eur(retC), seguridad_social: eur(ssC), neto: eur(neto),
      avisos, desglose,
    },
  };
}
// === COMÚN Finiquito: fin ===

if (typeof $input !== 'undefined') {
  const ent = $input.first().json || {};
  const hoy = $now.setZone('Europe/Madrid').toISODate();
  const r = calcularFiniquito(ent.body, hoy);
  return [{ json: r }];
}
