// Ejecuta el jsCode de un Code node fuera de n8n, en un vm.createContext (otro realm, como el task runner).
// Uso (dentro del contenedor n8n_local): node arnes_code.js codigo.js contexto.json [salida.json]
// contexto.json: { "nodos": { "Nombre": [ {json, binary?}, ... ] }, "input": [ ... ], "ejecutados": ["GET /fiscal"], "binarios": { "clave": "base64" } }
// Escribe en salida.json los items devueltos (los binarios como base64 en _binario).
const fs = require('fs');
const vm = require('vm');
const { DateTime } = require('/usr/local/lib/node_modules/n8n/node_modules/luxon');
const [codigoArch, ctxArch, salidaArch] = process.argv.slice(2);
const codigo = fs.readFileSync(codigoArch, 'utf8');
const ctx = JSON.parse(fs.readFileSync(ctxArch, 'utf8'));
const nodos = ctx.nodos || {};
const ejecutados = new Set([...(ctx.ejecutados || []), ...Object.keys(nodos)]);
const binarios = ctx.binarios || {};
const nodo = (nombre) => {
  const items = nodos[nombre] || [];
  return { all: () => items, first: () => items[0], item: items[0], isExecuted: ejecutados.has(nombre) };
};
const guardados = {};
const helpers = {
  getBinaryDataBuffer: async (i, clave) => Buffer.from(binarios[clave] || '', 'base64'),
  prepareBinaryData: async (buf, nombre, mime) => { const id = 'b' + Object.keys(guardados).length; guardados[id] = Buffer.from(buf); return { id, fileName: nombre, mimeType: mime, data: Buffer.from(buf).toString('base64') }; },
};
const sandbox = {
  $: nodo, $input: { all: () => ctx.input || [], first: () => (ctx.input || [])[0] }, $now: DateTime.fromISO(ctx.ahora || DateTime.now().toISO()).setZone('Europe/Madrid'),
  require: (m) => (m === 'exceljs' ? require('/usr/local/lib/node_modules/exceljs') : require(m)), Buffer, console,
};
const contexto = vm.createContext(sandbox);
const envuelto = `(async function () {\n${codigo}\n})`;
const fn = vm.runInContext(envuelto, contexto, { filename: codigoArch });
fn.call({ helpers }).then((res) => {
  const out = (res || []).map((it) => ({ json: it.json, _binario: it.binary && it.binary.data ? it.binary.data.data : undefined }));
  if (salidaArch) fs.writeFileSync(salidaArch, JSON.stringify(out, null, 1));
  else console.log(JSON.stringify(out, null, 1).slice(0, 4000));
}).catch((e) => { console.error('ERROR', e && e.stack); process.exit(1); });
