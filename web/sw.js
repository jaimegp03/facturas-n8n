/* Service worker de Facturas.
   Cachea SOLO el esqueleto de la aplicación (index.html, escaner.js, manifest e iconos).
   NUNCA cachea /webhook/* ni nada de la API: ni respuestas, ni facturas, ni archivos. Esas peticiones ni siquiera pasan por aquí.
   Al publicar cambios en la web, sube VERSION: los navegadores con la app abierta verán «Hay una versión nueva — Actualizar». */
const VERSION = '2026-10-21-1';
const CACHE = 'facturas-shell-' + VERSION;
const SHELL = ['./', './index.html', './escaner.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/icon.svg'];
const CLAVE_HTML = new URL('./index.html', self.location).href;
const OFFLINE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:rgb(242,246,245);color:rgb(20,32,31)}main{max-width:420px;padding:24px}h1{font-size:22px;color:rgb(15,76,92)}</style></head><body><main><h1>Sin conexión</h1><p>No se puede abrir Facturas ahora mismo y todavía no hay una copia guardada de la aplicación. Conéctate una vez para que quede disponible sin red.</p></main></body></html>';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('facturas-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data && e.data.tipo === 'SALTAR_ESPERA') self.skipWaiting(); });

async function redPrimero(req, clave) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then(r => { if (r && r.ok && r.type === 'basic') cache.put(clave, r.clone()); return r; });
  red.catch(() => {});
  try { return await Promise.race([red, new Promise((_, no) => setTimeout(() => no(new Error('tiempo')), 4000))]); }
  catch (err) {
    const c = await cache.match(clave);
    if (c) return c;
    if (req.mode === 'navigate') return new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    try { return await red; } catch { return Response.error(); }
  }
}
async function cachePrimero(req) {
  const cache = await caches.open(CACHE), c = await cache.match(req);
  if (c) return c;
  const r = await fetch(req);
  if (r && r.ok && r.type === 'basic') cache.put(req, r.clone());
  return r;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // otras webs (fuentes, BCE...): sin tocar
  if (url.pathname.includes('/webhook/')) return;                  // la API de n8n NUNCA se cachea
  const ruta = url.pathname;
  if (req.mode === 'navigate') { e.respondWith(redPrimero(req, CLAVE_HTML)); return; }
  if (/\/(escaner\.js|manifest\.webmanifest|index\.html)$/.test(ruta)) { e.respondWith(redPrimero(req, req.url)); return; }
  if (/\/icons\//.test(ruta)) { e.respondWith(cachePrimero(req)); return; }
  // todo lo demás: directo a la red
});
