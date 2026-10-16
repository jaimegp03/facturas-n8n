// Entrada: todas las facturas del mismo cliente (cualquier estado).
// 1) Duplicado lógico: mismo proveedor_norm + número + total (al céntimo) en una
//    factura no borrada del cliente => posible_duplicada. Si no, revisar/ok.
// 2) Nº de recepción: siguiente correlativo del cliente en el año de emisión
//    (misma regla que siguienteRecepcion del bloque COMÚN; las borradas no liberan su número).
const v = $('Interpretar y validar').first().json;
const fila = { ...v.fila };
const errores = [...(v.errores || [])];
const delCliente = $input.all().map((i) => i.json).filter((x) => x && x.id !== undefined && x.id !== null && x.cliente_id === fila.cliente_id);

let estado = errores.length ? 'revisar' : 'ok';
if (fila.proveedor_norm && fila.numero && fila.total !== null) {
  const dup = delCliente.find((x) => x.estado !== 'borrada' && x.proveedor_norm === fila.proveedor_norm && x.numero === fila.numero && x.total !== null && Math.round(x.total * 100) === Math.round(fila.total * 100));
  if (dup) {
    estado = 'posible_duplicada';
    errores.push(`Posible duplicada de la factura id ${dup.id} (mismo proveedor, número y total).`);
  }
}
// Ticket sin número: duplicado lógico = mismo proveedor + fecha + total (+ hora si ambos la tienen y es distinta => no es duplicado).
if (estado !== 'posible_duplicada' && !fila.numero && fila.proveedor_norm && fila.fecha_emision && fila.total !== null) {
  const dupT = delCliente.find((x) => x.estado !== 'borrada' && !x.numero && x.proveedor_norm === fila.proveedor_norm && x.fecha_emision === fila.fecha_emision && x.total !== null && Math.round(x.total * 100) === Math.round(fila.total * 100) && !(x.hora && fila.hora && x.hora !== fila.hora));
  if (dupT) {
    estado = 'posible_duplicada';
    errores.push(`Posible duplicada del ticket id ${dupT.id} (mismo comercio, fecha${fila.hora ? ', hora' : ''} e importe).`);
  }
}
fila.estado = estado;
fila.errores_validacion = errores.length ? errores.join(' | ') : null;

const hoy = $now.setZone('Europe/Madrid').toISODate();
const anio = (fila.fecha_emision && fila.fecha_emision <= hoy ? fila.fecha_emision : hoy).slice(0, 4);
let max = 0;
for (const x of delCliente) {
  if (typeof x.num_recepcion === 'string' && x.num_recepcion.startsWith(anio + '-')) {
    const n = Number(x.num_recepcion.slice(5));
    if (Number.isFinite(n) && n > max) max = n;
  }
}
fila.num_recepcion = `${anio}-${String(max + 1).padStart(6, '0')}`;

const original = $('Recorrer archivos').first(1);
return [{ json: { orden: v.orden, archivo: v.archivo, extraccion: v.extraccion, fila }, binary: original.binary }];
