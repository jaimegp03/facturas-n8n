// Servidor estático mínimo en 127.0.0.1 para las pruebas de PWA y escáner: sirve web/ en «/» y tests/escaner en «/__escaner/».
const http = require('http'), fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function iniciar() {
  const estado = { version: null };   // si se fija, sw.js se sirve con otra VERSION (prueba del aviso de actualización)
  const srv = http.createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split('?')[0]), base = path.join(RAIZ, 'web');
    if (ruta.startsWith('/__escaner/')) { base = path.join(RAIZ, 'tests', 'escaner'); ruta = ruta.slice('/__escaner'.length); }
    if (ruta.endsWith('/')) ruta += 'index.html';
    const f = path.normalize(path.join(base, ruta));
    if (!f.startsWith(base) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('no'); }
    if (estado.version && ruta === '/sw.js') {
      const t = fs.readFileSync(f, 'utf8').replace(/const VERSION = '[^']*'/, "const VERSION = '" + estado.version + "'");
      res.writeHead(200, { 'Content-Type': TIPOS['.js'], 'Cache-Control': 'no-cache' }); return res.end(t);
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({
    url: 'http://127.0.0.1:' + srv.address().port,
    cerrar: () => new Promise(r => { if (srv.closeAllConnections) srv.closeAllConnections(); srv.close(r); }),
    version: v => { estado.version = v; }
  })));
}
module.exports = { iniciar, RAIZ };
