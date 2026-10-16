// === TIPO SUMINISTRO: inicio ===
// Detector determinista del tipo de suministro por el CONTENIDO (no por la marca: Endesa, Iberdrola,
// Naturgy o Energía XXI venden luz y gas). Puntúa cada tipo con patrones sobre el texto de la factura,
// las descripciones de las líneas, la subcategoría y el nombre del archivo.
const SUM_CAT = { luz: 'Luz', gas: 'Gas', agua: 'Agua', telefonia: 'Telefonía e internet' };
const SUM_PAT = {
  luz: [[/factura de electricidad|factura de luz|suministro (de )?electric/, 8], [/potencia contratada/, 4], [/energia activa/, 3],
    [/impuesto (sobre la )?electricidad|impuesto electricidad/, 4], [/\bpeajes? de (transporte|acceso)|\bpeajes?\b/, 2], [/\b[23]\.0 ?td\b|\b6\.1 ?td\b/, 4],
    [/termino de potencia|termino fijo.{0,20}potencia/, 3], [/punta-llano|\bvalle\b.{0,30}\bkw\b|\bkw\b/, 2], [/discriminacion horaria|contador electrico|alquiler (del )?contador/, 2], [/\belectricidad\b|\belectrica\b|\bluz\b/, 1]],
  gas: [[/factura de gas\b/, 8], [/datos del contrato de gas|informacion del consumo gas/, 5], [/termino (fijo|energia|variable) gas|alquiler de equipos gas/, 5],
    [/gas natural/, 4], [/tipo de gas/, 3], [/kwh ?\/ ?m3/, 4], [/poder calorifico|\bpcs\b|coeficiente de conversion/, 3], [/\b(butano|propano|glp)\b/, 4], [/enagas|red de gas/, 2], [/\bgas\b/, 1]],
  agua: [[/factura de agua|consumo de agua|m3 de agua|suministro de agua/, 6], [/canal de isabel|aigues|emasesa|aguas de /, 5], [/alcantarillado/, 4], [/depuracion/, 3], [/saneamiento/, 3],
    [/abastecimiento/, 3], [/tasa de basuras|cuota de servicio/, 2], [/\bagua\b/, 1]],
  telefonia: [[/\bfibra\b/, 4], [/movistar|vodafone|orange|masmovil|\bdigi\b|yoigo|pepephone|jazztel|\bo2\b|simyo|lowi/, 3], [/\blineas? (movil|fija|5g|4g)|lineas? 5g|\b5g\+?/, 3],
    [/datos moviles|\bgb\b|roaming|\bsms\b/, 2], [/\binternet\b/, 2], [/llamadas/, 2], [/telefono|telefonia|\bmovil(es)?\b/, 1], [/\bfusion\b/, 2]],
};
const sumNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/m³/g, 'm3').replace(/[  \t]+/g, ' ');
// textos: { texto, lineas: [descripciones], subcategoria, archivo }. El archivo suma 3 puntos por tipo (pista débil).
const detectarSuministro = (textos) => {
  const cuerpo = sumNorm([textos.texto, ...(textos.lineas || []), textos.subcategoria].filter(Boolean).join('\n'));
  const nombre = sumNorm(textos.archivo);
  const puntos = { luz: 0, gas: 0, agua: 0, telefonia: 0 };
  for (const t of Object.keys(SUM_PAT)) for (const [re, w] of SUM_PAT[t]) if (re.test(cuerpo)) puntos[t] += w;
  if (/(^|[^a-z])(luz|electricidad)([^a-z]|$)/.test(nombre)) puntos.luz += 3;
  if (/(^|[^a-z])gas([^a-z]|$)/.test(nombre)) puntos.gas += 3;
  if (/(^|[^a-z])agua([^a-z]|$)/.test(nombre)) puntos.agua += 3;
  if (/telefon|movistar|internet|fibra/.test(nombre)) puntos.telefonia += 3;
  const orden = Object.keys(puntos).sort((a, b) => puntos[b] - puntos[a]);
  const mejor = puntos[orden[0]], segundo = puntos[orden[1]];
  return {
    tipo: mejor > 0 ? orden[0] : null, puntos,
    concluyente: mejor >= 6 && mejor >= 2 * segundo, // fija el tipo, por encima de Gemini
    evidencia: mejor >= 4 && mejor > segundo, // basta para avisar de una incoherencia
  };
};
// Tipo final: detector concluyente > tipo_suministro de Gemini (luz/gas/agua/telefonia) > ninguno.
const decidirSuministro = (det, tipoGemini) => {
  if (det.concluyente) return { tipo: det.tipo, origen: 'contenido' };
  if (SUM_CAT[tipoGemini]) return { tipo: tipoGemini, origen: 'gemini' };
  return { tipo: null, origen: null };
};
// === TIPO SUMINISTRO: fin ===
