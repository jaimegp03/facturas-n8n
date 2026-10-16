// Ejecuta el detector (n8n/codigo/ingesta_tipo_suministro.js) sobre una lista: node detector_lote.js entrada.json salida.json
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'n8n', 'codigo', 'ingesta_tipo_suministro.js'), 'utf8');
const f = new Function(src + '\nreturn { detectarSuministro, decidirSuministro, SUM_CAT };')();
const ent = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], JSON.stringify(ent.map((e) => ({ id: e.id, ...f.detectarSuministro(e) }))));
