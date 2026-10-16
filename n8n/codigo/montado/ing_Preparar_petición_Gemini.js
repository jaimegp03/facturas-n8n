// Decide el modo (texto del PDF o visión sobre el binario) y construye la
// petición a Gemini con responseSchema. El LLM solo extrae: no se le pide sumar.
// Modelos (único sitio donde se configuran en la Ingesta; el Asesor tiene los suyos).
// gemini-3.5-flash daba 429 siempre con esta clave (auditoría B8): principal = lite.
const MODELO = 'gemini-3.5-flash-lite';
const MODELO_RESPALDO = 'gemini-3.5-flash';

const archivo = $('Recorrer archivos').first(1).json;
const entrada = $input.first();

let texto = '';
if (archivo.mime === 'application/pdf' && entrada.json && typeof entrada.json.text === 'string') {
  texto = entrada.json.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const caracteresUtiles = (texto.match(/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
const modo = caracteresUtiles >= 60 ? 'texto' : 'vision';

const categorias = $('Leer categorías').all()
  .map((i) => i.json)
  .filter((c) => c && c.nombre && c.activa !== false)
  .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
  .map((c) => c.nombre);
if (!categorias.includes('Otros')) categorias.push('Otros');

const hoy = $now.setZone('Europe/Madrid').toISODate();

const instrucciones = [
  'Eres un extractor de datos de facturas y tickets (mayoritariamente españoles) RECIBIDAS por una empresa, autónomo o particular. Devuelve únicamente lo que aparece en el documento.',
  'Reglas:',
  '- Importes: cópialos EXACTAMENTE como aparecen impresos, como número decimal con punto (12,50 € -> 12.5). NO calcules, NO sumes, NO redondees y NO corrijas importes aunque parezcan incoherentes entre sí. Si un importe no aparece impreso, devuelve null. En facturas rectificativas o de abono, conserva el signo negativo impreso.',
  '- desglose_iva: una línea POR CADA TIPO de IVA impreso (21, 10, 4, 5...), con su base imponible, tipo_iva, cuota_iva y, si hay recargo de equivalencia, tipo_re (5.2, 1.4, 0.5...) y cuota_re. Si no hay recargo, tipo_re y cuota_re = null.',
  '- Ticket con «IVA incluido» sin base ni cuota impresas: pon una línea con tipo_iva = el tipo indicado, base = null, cuota_iva = null e importe_con_iva = importe con IVA de ese tipo si consta. NO calcules la base ni la cuota. Si no consta ningún tipo de IVA, desglose_iva = [].',
  '- base_exenta = suma de bases SIN IVA impresas: exentas, no sujetas, con inversión del sujeto pasivo, intracomunitarias o de fuera de la UE sin IVA. Si no hay, null. No incluyas esas bases en desglose_iva.',
  '- irpf_tipo = porcentaje de retención de IRPF impreso (15, 7, 19...) e irpf_cuota = importe retenido impreso en POSITIVO (en abonos, con el signo impreso). Si no hay retención, null.',
  '- suplidos = gastos pagados por cuenta del cliente (tasas, registros, provisiones de fondos) que se suman sin IVA. Si no hay, null.',
  '- total = TOTAL DE LA FACTURA ANTES DE RESTAR LA RETENCIÓN (bases + IVA + recargo + suplidos). total_a_pagar = importe líquido a pagar DESPUÉS de restar la retención («Total a pagar», «Líquido»). Son dos campos distintos: si hay retención, total es MAYOR que total_a_pagar; si no hay retención, ambos coinciden.',
  '- tipo_factura: "rectificativa" si es rectificativa o abono (e indica rectifica_numero = nº de la factura rectificada, si consta); "simplificada" para tickets y facturas simplificadas; "simplificada_cualificada" si es simplificada y además consta el NIF y el domicilio del destinatario; si no, "completa".',
  '- Fechas en formato AAAA-MM-DD. fecha_emision = fecha de expedición de la factura o ticket. fecha_operacion = fecha de realización de la operación SOLO si se indica expresamente y es distinta; si no, null. fecha_vencimiento solo si aparece expresamente (vencimiento, fecha de cargo o límite de pago); si no, null.',
  '- proveedor = razón social del EMISOR (no del cliente). nif = NIF/CIF/VAT del emisor tal cual (sin espacios). destinatario_nombre y destinatario_nif = nombre y NIF del CLIENTE o destinatario si constan; si no, null.',
  '- mencion_operacion: "inversion_sujeto_pasivo" si menciona inversión del sujeto pasivo (art. 84 LIVA); "reverse_charge" si menciona reverse charge / autoliquidación por el destinatario; "intracomunitaria" si menciona operación intracomunitaria exenta (art. 25 LIVA o similar); "exenta" o "no_sujeta" si menciona exención o no sujeción; si no hay ninguna mención, "ninguna". tipo_iva_autorrepercusion solo si el documento indica qué tipo debe autorrepercutirse; si no, null.',
  '- numero = número de factura/ticket tal como aparece (con su serie). Si no aparece, null.',
  '- moneda = código ISO 4217 (EUR si el símbolo es €, USD si es $ o US$). metodo_pago = tarjeta, efectivo, domiciliación, transferencia, PayPal, Bizum... o null si no consta. pagada = true solo si el documento indica que ya está pagada o cobrada (ticket pagado, «pagado», cargo realizado); si no consta, null.',
  '- lineas = una línea por artículo o concepto comprado, con descripcion tal cual impresa, cantidad (si consta; si no, 1) e importe de esa línea impreso (máximo 40 líneas; si hay más, las 40 de mayor importe). No incluyas líneas de subtotal, total, IVA, entrega, cambio, descuento global ni forma de pago.',
  '- TICKETS DE COMPRA: tipo_factura = "simplificada"; numero = número de ticket, operación o factura simplificada SOLO si consta impreso (si no, null; nunca lo inventes); nif = NIF del establecimiento SOLO si consta (si no, null). Si el ticket tiene tabla de IVA (Base / % IVA / Cuota), una línea de desglose_iva por cada tipo (21, 10, 4) con base y cuota impresas; si solo dice «IVA incluido» con un tipo, aplica la regla de IVA incluido.',
  '- hora = hora de emisión del ticket en formato HH:MM (24 h) si consta; si no, null.',
  '- propina_redondeo = propina, donativo, redondeo u otro importe que figure sumado en el total pero NO esté dentro de ninguna base de IVA; si no hay, null. No lo incluyas en desglose_iva.',
  '- legibilidad: "buena" si lees el documento con seguridad; "dudosa" si hay zonas borrosas, cortadas o torcidas pero el total y los importes principales se leen; "mala" si el total o los importes principales NO se pueden leer con seguridad. Si el total no se lee con seguridad, total = null: no lo adivines.',
  '- Categoría de tickets según el establecimiento y lo comprado: supermercado o tienda de alimentación -> «Alimentación y supermercado»; farmacia o parafarmacia -> «Salud y farmacia»; gasolinera -> «Transporte y combustible»; bar, cafetería o restaurante -> «Restaurantes y comida a domicilio»; ropa o calzado -> «Ropa y calzado»; ferretería, muebles o decoración -> «Hogar»; electrónica -> «Tecnología y electrónica». Elige siempre una de la lista permitida.',
  '- categoria = exactamente una de la lista permitida. subcategoria = texto corto (p. ej. "Electricidad", "Honorarios de abogado", "Material de obra").',
  '- tipo_gasto: "suscripcion" = servicio de pago recurrente que el usuario puede cancelar libremente (streaming, música, apps, software, gimnasio, cuotas de socio); "contrato" = servicio recurrente sujeto a contrato de suministro, alquiler o póliza (luz, agua, gas, internet, telefonía, seguros, alquiler); "puntual" = compra o pago único.',
  '- periodicidad: solo para suscripcion o contrato (semanal, mensual, bimestral, trimestral, semestral, anual), deducida del periodo facturado o de la propia factura; para puntual, null.',
  '- confianza: número entre 0 y 1 con tu seguridad global en la lectura (bájala si la imagen es borrosa, faltan datos clave o dudas de algún importe).',
  '- motivo: una frase breve que justifique la categoría y el tipo de gasto. No repitas importes ni datos personales.',
  `Fecha de hoy (solo para interpretar fechas ambiguas): ${hoy}.`,
].join('\n');

const nullable = (type, extra = {}) => ({ type, nullable: true, ...extra });
const CAMPOS = ['proveedor', 'nif', 'numero', 'tipo_factura', 'rectifica_numero', 'fecha_emision', 'fecha_operacion', 'fecha_vencimiento', 'destinatario_nombre', 'destinatario_nif', 'lineas', 'desglose_iva', 'base_exenta', 'irpf_tipo', 'irpf_cuota', 'suplidos', 'total', 'total_a_pagar', 'mencion_operacion', 'tipo_iva_autorrepercusion', 'moneda', 'metodo_pago', 'pagada', 'hora', 'propina_redondeo', 'legibilidad', 'categoria', 'subcategoria', 'tipo_gasto', 'periodicidad', 'confianza', 'motivo'];
const responseSchema = {
  type: 'OBJECT',
  properties: {
    proveedor: nullable('STRING'),
    nif: nullable('STRING'),
    numero: nullable('STRING'),
    tipo_factura: { type: 'STRING', enum: ['completa', 'simplificada', 'simplificada_cualificada', 'rectificativa'] },
    rectifica_numero: nullable('STRING'),
    fecha_emision: nullable('STRING', { description: 'AAAA-MM-DD' }),
    fecha_operacion: nullable('STRING', { description: 'AAAA-MM-DD, solo si es distinta de la de emisión' }),
    fecha_vencimiento: nullable('STRING', { description: 'AAAA-MM-DD' }),
    destinatario_nombre: nullable('STRING'),
    destinatario_nif: nullable('STRING'),
    lineas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          descripcion: { type: 'STRING' },
          cantidad: nullable('NUMBER'),
          precio_unitario: nullable('NUMBER'),
          importe: nullable('NUMBER'),
        },
        required: ['descripcion'],
      },
    },
    desglose_iva: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          base: nullable('NUMBER'),
          tipo_iva: { type: 'NUMBER' },
          cuota_iva: nullable('NUMBER'),
          tipo_re: nullable('NUMBER'),
          cuota_re: nullable('NUMBER'),
          importe_con_iva: nullable('NUMBER', { description: 'solo tickets con IVA incluido sin base ni cuota' }),
        },
        required: ['base', 'tipo_iva', 'cuota_iva', 'tipo_re', 'cuota_re', 'importe_con_iva'],
        propertyOrdering: ['base', 'tipo_iva', 'cuota_iva', 'tipo_re', 'cuota_re', 'importe_con_iva'],
      },
    },
    base_exenta: nullable('NUMBER'),
    irpf_tipo: nullable('NUMBER'),
    irpf_cuota: nullable('NUMBER'),
    suplidos: nullable('NUMBER'),
    total: nullable('NUMBER', { description: 'total de la factura ANTES de restar la retención' }),
    total_a_pagar: nullable('NUMBER', { description: 'líquido a pagar DESPUÉS de restar la retención' }),
    mencion_operacion: { type: 'STRING', enum: ['ninguna', 'inversion_sujeto_pasivo', 'reverse_charge', 'intracomunitaria', 'exenta', 'no_sujeta'] },
    tipo_iva_autorrepercusion: nullable('NUMBER'),
    moneda: nullable('STRING'),
    metodo_pago: nullable('STRING'),
    pagada: nullable('BOOLEAN'),
    hora: nullable('STRING', { description: 'HH:MM del ticket' }),
    propina_redondeo: nullable('NUMBER'),
    legibilidad: { type: 'STRING', enum: ['buena', 'dudosa', 'mala'] },
    categoria: { type: 'STRING', enum: categorias },
    subcategoria: nullable('STRING'),
    tipo_gasto: { type: 'STRING', enum: ['puntual', 'suscripcion', 'contrato'] },
    periodicidad: nullable('STRING', { enum: ['semanal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'] }),
    confianza: { type: 'NUMBER' },
    motivo: { type: 'STRING' },
  },
  required: CAMPOS,
  propertyOrdering: CAMPOS,
};

const parts = [{ text: instrucciones }];
if (modo === 'texto') {
  parts.push({ text: 'TEXTO DE LA FACTURA (extraído del PDF):\n"""\n' + texto.slice(0, 30000) + '\n"""' });
} else {
  if (!entrada.binary || !entrada.binary.data) {
    return [{ json: { modo: 'error', modelo: MODELO, modelo_respaldo: MODELO_RESPALDO, error: 'No se pudo leer el PDF (dañado o protegido).' } }];
  }
  const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
  parts.push({ text: 'Documento adjunto (imagen o PDF escaneado). Lee la factura completa.' });
  parts.push({ inline_data: { mime_type: archivo.mime, data: buf.toString('base64') } });
}

const peticion = {
  contents: [{ role: 'user', parts }],
  // Sin temperature: en Gemini 3 Google recomienda el valor por defecto.
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema,
    thinkingConfig: { thinkingLevel: 'low' },
  },
};

return [{ json: { modo, categorias, modelo: MODELO, modelo_respaldo: MODELO_RESPALDO, peticion } }];
