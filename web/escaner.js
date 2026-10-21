/* Escáner de tickets en el navegador (sin librerías, nada sale del equipo).
   Pipeline: orientación EXIF -> detección del papel (mínimo RGB, Otsu, mayor componente, relleno de huecos, casco convexo,
   cuadrilátero por supresión de aristas) -> corrección de perspectiva (homografía 8x8 propia) -> aplanado de la iluminación
   (división por el fondo estimado) -> niveles / grises / blanco y negro adaptativo -> JPEG 0,85.
   Interfaz: <dialog id="dlgEscaner"> de index.html. API: window.Escaner (preparar, analizar, procesarArchivo).
   Contrato con index.html: si este archivo falta, la web sigue funcionando y sube las fotos tal cual. */
(function (global) {
  'use strict';
  const MAX_DET = 1000;        // lado largo (px) de la imagen sobre la que se detecta
  const MAX_SALIDA = 2400;     // lado largo máximo de una foto procesada
  const MAX_UNIDA = 4000;      // lado largo máximo al unir varias fotos
  const CALIDAD = 0.85;
  const PREVIA = 640;          // lado largo del resultado en la vista previa
  const MODOS = { color: 'Color mejorado', grises: 'Escala de grises', bn: 'Blanco y negro' };

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const ahora = () => (global.performance || Date).now();
  const crearCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctx2d = c => c.getContext('2d', { willReadFrequently: true });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /* ---------- decodificación ---------- */
  async function decodificar(file) {
    if (!global.createImageBitmap) throw new Error('El navegador no puede leer imágenes aquí.');
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { return await createImageBitmap(file); }
  }
  function leerPixeles(bitmap, w, h) {
    const c = crearCanvas(w, h), x = ctx2d(c);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(bitmap, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h);
    return { data: id.data, w, h };
  }

  /* ---------- filtros básicos ---------- */
  function boxF(src, w, h, r) {
    if (r < 1) return Float32Array.from(src);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let k = -r; k <= r; k++) s += src[o + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[o + x] = s / n; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    return out;
  }
  function maxF(src, w, h, r) {   // dilatación en escala de grises (ventana cuadrada)
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; for (let k = -r; k <= r; k++) { const v = src[y * w + clamp(x + k, 0, w - 1)]; if (v > m) m = v; } tmp[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; for (let k = -r; k <= r; k++) { const v = tmp[clamp(y + k, 0, h - 1) * w + x]; if (v > m) m = v; } out[y * w + x] = m;
    }
    return out;
  }
  function morfBin(mask, w, h, r, erosion) {   // fuera de la imagen = el borde (el papel que llena el encuadre no se erosiona)
    const n = 2 * r + 1, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const o = y * w; let s = 0;
      for (let k = -r; k <= r; k++) s += mask[o + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[o + x] = erosion ? (s === n ? 1 : 0) : (s > 0 ? 1 : 0); s += mask[o + Math.min(w - 1, x + r + 1)] - mask[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = erosion ? (s === n ? 1 : 0) : (s > 0 ? 1 : 0); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    return out;
  }
  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, max = -1, t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > max) { max = v; t = i; }
    }
    return t;
  }
  function mayorComponente(mask, w, h) {
    const lab = new Int32Array(w * h), stack = new Int32Array(w * h);
    let best = 0, bestN = 0, L = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      L++; let sp = 0, n = 0; stack[sp++] = i; lab[i] = L;
      while (sp) {
        const p = stack[--sp]; n++;
        const x = p % w, y = (p - x) / w;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = L; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = L; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = L; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = L; stack[sp++] = p + w; }
      }
      if (n > bestN) { bestN = n; best = L; }
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = lab[i] === best && best ? 1 : 0;
    return out;
  }
  function rellenarHuecos(mask, w, h) {   // todo lo que no se alcanza desde el borde yendo por «no papel» es papel
    const fuera = new Uint8Array(w * h), stack = new Int32Array(w * h); let sp = 0;
    const meter = p => { if (!mask[p] && !fuera[p]) { fuera[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < w; x++) { meter(x); meter((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { meter(y * w); meter(y * w + w - 1); }
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      if (x > 0) meter(p - 1); if (x < w - 1) meter(p + 1); if (y > 0) meter(p - w); if (y < h - 1) meter(p + w);
    }
    const out = new Uint8Array(w * h); let n = 0;
    for (let i = 0; i < w * h; i++) { out[i] = fuera[i] ? 0 : 1; n += out[i]; }
    return { mask: out, n };
  }

  /* ---------- geometría ---------- */
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  function casco(pts) {   // Andrew; sentido horario en coordenadas de imagen (y hacia abajo)
    pts = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const u = [], l = [];
    for (const p of pts) { while (l.length >= 2 && cruz(l[l.length - 2], l[l.length - 1], p) <= 0) l.pop(); l.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (u.length >= 2 && cruz(u[u.length - 2], u[u.length - 1], p) <= 0) u.pop(); u.push(p); }
    u.pop(); l.pop();
    return l.concat(u);
  }
  function interseccion(a, b, c, d) {   // recta a->b con recta d->c; devuelve el punto y los parámetros
    const r = [b[0] - a[0], b[1] - a[1]], s = [c[0] - d[0], c[1] - d[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return null;
    const qp = [d[0] - a[0], d[1] - a[1]];
    const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    return { p: [a[0] + t * r[0], a[1] + t * r[1]], t, u };
  }
  function cuadrilatero(hull) {   // reduce el casco a 4 aristas quitando la que menos área añade (prolongando las vecinas)
    let P = hull.slice();
    while (P.length > 4) {
      const n = P.length; let mejor = -1, mejorA = Infinity, mejorP = null;
      for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
        const q = interseccion(a, b, c, d);
        if (!q || q.t < 1 - 1e-9 || q.u < 1 - 1e-9) continue;   // las vecinas no convergen por fuera de esta arista
        const A = Math.abs(cruz(b, q.p, c)) / 2;
        if (A < mejorA) { mejorA = A; mejor = i; mejorP = q.p; }
      }
      if (mejor < 0) return null;
      const j = (mejor + 1) % n, nuevo = [];
      for (let k = 0; k < n; k++) { if (k === mejor) nuevo.push(mejorP); else if (k !== j) nuevo.push(P[k]); }
      P = nuevo;
    }
    return P.length === 4 ? P : null;
  }
  function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  function esConvexo(q) {
    let sg = 0;
    for (let i = 0; i < 4; i++) {
      const c = cruz(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
      if (Math.abs(c) < 1e-6) return false;
      const s = c > 0 ? 1 : -1; if (sg && s !== sg) return false; sg = s;
    }
    return true;
  }
  function ordenar(q) {   // TL, TR, BR, BL (horario en pantalla); empieza por la esquina de menor x+y
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    const o = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let k = 0; for (let i = 1; i < 4; i++) if (o[i][0] + o[i][1] < o[k][0] + o[k][1]) k = i;
    return [o[k], o[(k + 1) % 4], o[(k + 2) % 4], o[(k + 3) % 4]];
  }
  function homografia(dst, src) {   // (u,v) de la salida -> (x,y) de la fuente; devuelve los 8 coeficientes
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = dst[i], [x, y] = src[i];
      A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < 8; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = new Array(8);
    for (let r = 7; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k]; h[r] = s / A[r][r]; }
    return h;
  }

  /* ---------- detección ---------- */
  function detectarPapel(img) {   // img = {data,w,h} (≈ 1000 px). Devuelve {quad (px de img), conf, ok, razon, areaFrac, solidez}
    const { data, w, h } = img, n = w * h;
    const completo = [[0, 0], [w, 0], [w, h], [0, h]];
    const malo = razon => ({ quad: completo, conf: 0, ok: false, razon, areaFrac: 1, solidez: 0 });
    const m = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) m[i] = Math.min(data[j], data[j + 1], data[j + 2]);   // el papel blanco tiene el mínimo RGB alto; mesas de madera o color, no
    const b = boxF(m, w, h, 2), hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[clamp(Math.round(b[i]), 0, 255)]++;
    const T = otsu(hist, n);
    let mask = new Uint8Array(n), fg = 0, sumF = 0, sumB = 0;
    for (let i = 0; i < n; i++) { if (b[i] > T) { mask[i] = 1; fg++; sumF += b[i]; } else sumB += b[i]; }
    if (fg < n * 0.03) return malo('poco_papel');
    const sep = sumF / fg - (n - fg ? sumB / (n - fg) : 0);
    mask = morfBin(morfBin(mask, w, h, 3, true), w, h, 3, false);
    const comp = mayorComponente(mask, w, h);
    const lleno = rellenarHuecos(comp, w, h);
    if (lleno.n < n * 0.03) return malo('poco_papel');
    const pts = [], ymin = new Int32Array(w).fill(-1), ymax = new Int32Array(w).fill(-1);
    for (let y = 0; y < h; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < w; x++) if (lleno.mask[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; if (ymin[x] < 0) ymin[x] = y; ymax[x] = y; }
      if (x0 >= 0) { pts.push([x0, y], [x1 + 1, y + 1]); }
    }
    for (let x = 0; x < w; x++) if (ymin[x] >= 0) pts.push([x, ymin[x]], [x + 1, ymax[x] + 1]);
    const hull = casco(pts);
    if (hull.length < 3) return malo('sin_casco');
    let q = cuadrilatero(hull);
    if (!q) return malo('sin_cuadrilatero');
    q = q.map(p => [clamp(p[0], 0, w), clamp(p[1], 0, h)]);
    if (!esConvexo(q)) return malo('no_convexo');
    q = ordenar(q);
    const aq = area(q), areaFrac = aq / n, solidez = lleno.n / Math.max(1, aq);
    let conf = clamp((solidez - 0.7) / 0.25, 0, 1) * clamp((areaFrac - 0.02) / 0.04, 0, 1) * clamp((sep - 15) / 25, 0, 1);
    const ok = conf >= 0.5 && areaFrac >= 0.04 && solidez >= 0.8;
    return { quad: ok ? q : completo, quadDetectado: q, conf, ok, razon: ok ? '' : 'confianza_baja', areaFrac, solidez, umbral: T };
  }

  /* ---------- recorte con perspectiva ---------- */
  function tamanoSalida(q, maxLado) {
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    let qq = q;
    if (W > H * 1.2) { qq = [q[1], q[2], q[3], q[0]]; const t = W; W = H; H = t; }   // un ticket es más alto que ancho
    const s = Math.min(1, maxLado / Math.max(W, H, 1));
    return { q: qq, w: Math.max(8, Math.round(W * s)), h: Math.max(8, Math.round(H * s)) };
  }
  function fuenteParaRecorte(bitmap, quad, maxLado) {   // evita leer 12 MP si el ticket ocupa poco y reduce si hace falta
    const L = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]), dist(quad[0], quad[3]), dist(quad[1], quad[2]));
    const k = Math.min(1, (maxLado * 1.5) / Math.max(L, 1));
    const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
    return { px: leerPixeles(bitmap, w, h), q: quad.map(p => [p[0] * w / bitmap.width, p[1] * h / bitmap.height]) };
  }
  function recortar(src, quad, maxLado) {
    const t = tamanoSalida(quad, maxLado), W = t.w, H = t.h;
    const hm = homografia([[0, 0], [W, 0], [W, H], [0, H]], t.q);
    const out = new Uint8ClampedArray(W * H * 4);
    if (!hm) return { data: out, w: W, h: H };
    const sd = src.data, sw = src.w, sh = src.h;
    for (let v = 0; v < H; v++) {
      const vv = v + 0.5;
      for (let u = 0; u < W; u++) {
        const uu = u + 0.5, d = hm[6] * uu + hm[7] * vv + 1;
        const x = (hm[0] * uu + hm[1] * vv + hm[2]) / d - 0.5, y = (hm[3] * uu + hm[4] * vv + hm[5]) / d - 0.5;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const xa = clamp(x0, 0, sw - 1), xb = clamp(x0 + 1, 0, sw - 1), ya = clamp(y0, 0, sh - 1), yb = clamp(y0 + 1, 0, sh - 1);
        const i00 = (ya * sw + xa) * 4, i10 = (ya * sw + xb) * 4, i01 = (yb * sw + xa) * 4, i11 = (yb * sw + xb) * 4, o = (v * W + u) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        out[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
        out[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        out[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        out[o + 3] = 255;
      }
    }
    return { data: out, w: W, h: H };
  }

  /* ---------- mejora de imagen ---------- */
  function aplanar(img) {   // divide cada canal por su fondo estimado (cierre morfológico a baja resolución): quita sombras y tintes
    const { data, w, h } = img, f = Math.max(1, Math.round(Math.max(w, h) / 240));
    const lw = Math.ceil(w / f), lh = Math.ceil(h / f), cnt = new Float32Array(lw * lh);
    let bg = [new Float32Array(lw * lh), new Float32Array(lw * lh), new Float32Array(lw * lh)];
    for (let y = 0; y < h; y++) {
      const row = ((y / f) | 0) * lw;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const ci = row + ((x / f) | 0); cnt[ci]++; bg[0][ci] += data[i]; bg[1][ci] += data[i + 1]; bg[2][ci] += data[i + 2];
      }
    }
    bg = bg.map(c => { for (let i = 0; i < c.length; i++) c[i] /= cnt[i] || 1; return boxF(boxF(maxF(c, lw, lh, 3), lw, lh, 2), lw, lh, 2); });
    const x0 = new Int32Array(w), x1 = new Int32Array(w), wx = new Float32Array(w);
    for (let x = 0; x < w; x++) { const fx = clamp((x + 0.5) / f - 0.5, 0, lw - 1); x0[x] = Math.floor(fx); x1[x] = Math.min(lw - 1, x0[x] + 1); wx[x] = fx - x0[x]; }
    for (let y = 0; y < h; y++) {
      const fy = clamp((y + 0.5) / f - 0.5, 0, lh - 1), y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const a = y0 * lw + x0[x], b = y0 * lw + x1[x], c = y1 * lw + x0[x], d = y1 * lw + x1[x], ax = wx[x];
        for (let k = 0; k < 3; k++) {
          const B = bg[k], g = ((B[a] * (1 - ax) + B[b] * ax) * (1 - wy) + (B[c] * (1 - ax) + B[d] * ax) * wy);
          const v = data[i + k] * 255 / Math.max(g, 30); data[i + k] = v > 255 ? 255 : v;
        }
      }
    }
  }
  function lutNiveles(img) {
    const { data, w, h } = img, hist = new Float64Array(256), n = w * h;
    for (let i = 0; i < data.length; i += 4) hist[(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0]++;
    let acc = 0, negro = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.004) { negro = v; break; } }
    negro = clamp(negro, 0, 110);
    const blanco = 235, lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(clamp((v - negro) / (blanco - negro), 0, 1), 1.25);
    return lut;
  }
  function mejorar(img, modo) {   // modifica img.data
    const { data, w, h } = img;
    aplanar(img);
    if (modo === 'bn') {
      const g = new Float32Array(w * h);
      for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
      const suave = boxF(g, w, h, 1), media = boxF(g, w, h, Math.max(8, Math.round(w / 30)));
      for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        const negro = suave[i] < media[i] * 0.82 || suave[i] < 70, v = negro ? 0 : 255;
        data[j] = data[j + 1] = data[j + 2] = v;
      }
      return;
    }
    const lut = lutNiveles(img);
    if (modo === 'grises') {
      for (let i = 0; i < data.length; i += 4) { const y = lut[(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0]; data[i] = data[i + 1] = data[i + 2] = y; }
    } else {
      for (let i = 0; i < data.length; i += 4) { data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]]; }
    }
  }

  /* ---------- una foto: de bitmap + esquinas a lienzo ---------- */
  function renderizar(bitmap, quad, opc) {   // quad en px del bitmap; devuelve un canvas
    const maxLado = opc.maxLado || MAX_SALIDA, t0 = ahora();
    const f = fuenteParaRecorte(bitmap, quad, maxLado), t1 = ahora();
    const rec = recortar(f.px, f.q, maxLado), t2 = ahora();
    if (opc.modo !== 'original') mejorar(rec, opc.modo || 'color');
    const t3 = ahora();
    let c = crearCanvas(rec.w, rec.h); ctx2d(c).putImageData(new ImageData(rec.data, rec.w, rec.h), 0, 0);
    const giro = ((opc.rot || 0) % 4 + 4) % 4;
    if (giro) {
      const r = crearCanvas(giro % 2 ? rec.h : rec.w, giro % 2 ? rec.w : rec.h), x = ctx2d(r);
      x.translate(r.width / 2, r.height / 2); x.rotate(giro * Math.PI / 2); x.drawImage(c, -rec.w / 2, -rec.h / 2);
      c = r;
    }
    if (opc.tiempos) { opc.tiempos.fuente = t1 - t0; opc.tiempos.recortar = t2 - t1; opc.tiempos.mejorar = t3 - t2; }
    return c;
  }
  function unir(lienzos) {   // en vertical, al ancho del primero; si queda demasiado alto, se reduce
    if (lienzos.length === 1) return lienzos[0];
    const W = lienzos[0].width, hs = lienzos.map(c => Math.round(c.height * W / c.width));
    let H = hs.reduce((a, b) => a + b, 0), k = Math.min(1, MAX_UNIDA / Math.max(W, H));
    const out = crearCanvas(Math.round(W * k), Math.round(H * k)), x = ctx2d(out);
    x.fillStyle = 'rgb(255,255,255)'; x.fillRect(0, 0, out.width, out.height);
    let y = 0; lienzos.forEach((c, i) => { x.drawImage(c, 0, Math.round(y * k), out.width, Math.round(hs[i] * k)); y += hs[i]; });
    return out;
  }
  const aBlob = (c, calidad) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen.')), 'image/jpeg', calidad || CALIDAD));
  function nombreEscaneado(nombre) { return String(nombre || 'ticket').replace(/\.[^./\\]+$/, '') + '_escaneado.jpg'; }
  const esImagenEscaneable = f => /^image\/(jpeg|png|webp)$/i.test(f.type || '') || (!f.type && /\.(jpe?g|png|webp)$/i.test(f.name || ''));

  /* ---------- análisis ---------- */
  async function analizarBitmap(bitmap) {
    const t0 = ahora(), s = Math.min(1, MAX_DET / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(8, Math.round(bitmap.width * s)), h = Math.max(8, Math.round(bitmap.height * s));
    const px = leerPixeles(bitmap, w, h), r = detectarPapel(px);
    const aOrig = q => q.map(p => [p[0] * bitmap.width / w, p[1] * bitmap.height / h]);
    return Object.assign(r, { quad: aOrig(r.quad), quadDetectado: r.quadDetectado ? aOrig(r.quadDetectado) : null, ms: ahora() - t0, ancho: bitmap.width, alto: bitmap.height });
  }
  async function analizar(file) {
    const t0 = ahora(), bm = await decodificar(file), td = ahora() - t0;
    try { const r = await analizarBitmap(bm); r.msDecodificar = td; return r; } finally { if (bm.close) bm.close(); }
  }
  async function procesarArchivo(file, opc) {   // API de pruebas y modo automático
    opc = opc || {}; const T = { total: 0 }, t0 = ahora();
    const bm = await decodificar(file); T.decodificar = ahora() - t0;
    try {
      let r = null, quad = opc.quad;
      if (!quad) { r = await analizarBitmap(bm); quad = r.quad; T.detectar = r.ms; }
      const c = renderizar(bm, quad, { modo: opc.modo || 'color', maxLado: opc.maxLado || MAX_SALIDA, rot: opc.rot || 0, tiempos: T });
      const t1 = ahora(), blob = await aBlob(c, opc.calidad); T.jpeg = ahora() - t1; T.total = ahora() - t0;
      return { blob, w: c.width, h: c.height, quad, conf: r ? r.conf : 1, ok: r ? r.ok : true, razon: r ? r.razon : '', ms: T, origen: { w: bm.width, h: bm.height } };
    } finally { if (bm.close) bm.close(); }
  }

  /* ---------- interfaz ---------- */
  const U = { listo: false, p: [], cur: 0, modo: 'color', fin: null, seq: 0, temporizador: 0, arrastre: null };
  const $ = s => document.getElementById(s);
  const NOMBRES_ASA = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];

  function mensaje(t, err) { const m = $('escMsg'); m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); }
  function paginaActual() { return U.p[U.cur]; }
  function pintarOrigen() {
    const p = paginaActual(); if (!p) return;
    const c = $('escOrigen'), k = Math.min(1, 900 / Math.max(p.bm.width, p.bm.height));
    c.width = Math.round(p.bm.width * k); c.height = Math.round(p.bm.height * k);
    ctx2d(c).drawImage(p.bm, 0, 0, c.width, c.height);
    c.parentElement.style.aspectRatio = c.width + ' / ' + c.height;
    const tope = (innerWidth < 760 ? 0.48 : 0.62) * innerHeight * c.width / c.height;   // alto máximo sin romper la proporción (las esquinas van en %)
    c.parentElement.style.maxWidth = Math.max(200, tope) + 'px';
    pintarEsquinas();
  }
  function pintarEsquinas() {
    const p = paginaActual(); if (!p) return;
    const pts = p.q.map(a => (a[0] * 100).toFixed(2) + ',' + (a[1] * 100).toFixed(2)).join(' ');
    $('escPoli').setAttribute('points', pts);
    document.querySelectorAll('#dlgEscaner .esc-asa').forEach((b, i) => { b.style.left = p.q[i][0] * 100 + '%'; b.style.top = p.q[i][1] * 100 + '%'; });
  }
  function pintarPaginas() {
    const caja = $('escPaginas');
    caja.hidden = U.p.length < 2;
    caja.innerHTML = '';
    U.p.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm' + (i === U.cur ? ' btn-primary' : '');
      b.textContent = 'Foto ' + (i + 1); b.setAttribute('aria-pressed', i === U.cur ? 'true' : 'false');
      b.addEventListener('click', () => { U.cur = i; pintarPaginas(); pintarOrigen(); programarResultado(0); });
      caja.appendChild(b);
    });
    if (U.p.length > 1) {
      const q = document.createElement('button'); q.type = 'button'; q.className = 'btn btn-sm btn-ghost'; q.textContent = 'Quitar esta foto';
      q.addEventListener('click', () => { const x = U.p.splice(U.cur, 1)[0]; if (x.bm.close) x.bm.close(); U.cur = Math.max(0, U.cur - 1); pintarPaginas(); pintarOrigen(); programarResultado(0); });
      caja.appendChild(q);
    }
    $('escAyuda').textContent = U.p.length > 1 ? `Se unirán ${U.p.length} fotos de arriba abajo en una sola imagen.` : 'Ajusta las esquinas si el recorte no coincide con el ticket. Todo se hace en tu navegador.';
  }
  function programarResultado(ms) { clearTimeout(U.temporizador); U.temporizador = setTimeout(pintarResultado, ms); }
  function pintarResultado() {
    const p = paginaActual(); if (!p) return;
    const quad = p.q.map(a => [a[0] * p.bm.width, a[1] * p.bm.height]);
    if (!esConvexo(quad)) { mensaje('Las esquinas se cruzan: sepáralas para ver el resultado.', true); return; }
    const seq = ++U.seq;
    try {
      const c = renderizar(p.bm, quad, { modo: U.modo, maxLado: PREVIA, rot: p.rot });
      if (seq !== U.seq) return;
      const d = $('escResultado'); d.width = c.width; d.height = c.height; ctx2d(d).drawImage(c, 0, 0);
      d.parentElement.style.aspectRatio = c.width + ' / ' + c.height;
      if (!p.aviso) mensaje(p.ok ? 'Esquinas detectadas. Arrástralas (o usa las flechas) si hace falta.' : 'No se ha detectado bien el ticket. Ajusta las esquinas.', !p.ok);
      else mensaje(p.aviso, !p.ok);
    } catch (e) { mensaje('No se pudo generar la vista previa: ' + e.message, true); }
  }
  async function nuevaPagina(file) {
    const bm = await decodificar(file), r = await analizarBitmap(bm);
    const q = r.quad.map(a => [a[0] / bm.width, a[1] / bm.height]);
    return { file, bm, q, ok: r.ok, rot: 0, aviso: '' };
  }
  function moverEsquina(i, nx, ny) {
    const p = paginaActual(); p.q[i] = [clamp(nx, 0, 1), clamp(ny, 0, 1)]; p.aviso = ''; p.ok = true;
    pintarEsquinas(); programarResultado(60);
  }
  function iniciarUI() {
    if (U.listo) return; U.listo = true;
    const dlg = $('dlgEscaner');
    document.querySelectorAll('#dlgEscaner .esc-asa').forEach((b, i) => {
      b.setAttribute('aria-label', 'Esquina ' + NOMBRES_ASA[i] + '. Flechas para moverla');
      b.addEventListener('pointerdown', e => { e.preventDefault(); U.arrastre = i; b.setPointerCapture(e.pointerId); b.focus(); });
      b.addEventListener('pointermove', e => {
        if (U.arrastre !== i) return;
        const r = $('escLienzo').getBoundingClientRect();
        moverEsquina(i, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      });
      const soltar = e => { if (U.arrastre === i) { U.arrastre = null; try { b.releasePointerCapture(e.pointerId); } catch {} } };
      b.addEventListener('pointerup', soltar); b.addEventListener('pointercancel', soltar);
      b.addEventListener('keydown', e => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
        e.preventDefault(); const p = paginaActual(), paso = e.shiftKey ? 0.05 : 0.01;
        moverEsquina(i, p.q[i][0] + d[0] * paso, p.q[i][1] + d[1] * paso);
      });
    });
    document.querySelectorAll('#dlgEscaner input[name=escModo]').forEach(r => r.addEventListener('change', () => { U.modo = r.value; programarResultado(0); }));
    $('escRotar').addEventListener('click', () => { const p = paginaActual(); p.rot = ((p.rot || 0) + 1) % 4; programarResultado(0); });
    $('escOriginal').addEventListener('click', () => terminar(U.p.map(p => p.file)));
    $('escDescartar').addEventListener('click', () => terminar([]));
    $('escRepetir').addEventListener('click', () => { terminar([]); const i = $('fotoInput') || $('fileInput'); if (i) i.click(); });
    $('escOtra').addEventListener('click', () => $('escOtraArchivo').click());
    $('escOtraArchivo').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      mensaje('Leyendo la otra foto…');
      try { U.p.push(await nuevaPagina(f)); U.cur = U.p.length - 1; pintarPaginas(); pintarOrigen(); programarResultado(0); }
      catch { mensaje('No se pudo leer esa imagen (formato no admitido).', true); }
    });
    $('escAceptar').addEventListener('click', async () => {
      const botones = dlg.querySelectorAll('button'); botones.forEach(b => b.disabled = true); mensaje('Procesando…');
      try {
        await new Promise(r => setTimeout(r, 30));
        const lienzos = U.p.map(p => renderizar(p.bm, p.q.map(a => [a[0] * p.bm.width, a[1] * p.bm.height]), { modo: U.modo, maxLado: MAX_SALIDA, rot: p.rot }));
        const blob = await aBlob(unir(lienzos), CALIDAD);
        terminar([new File([blob], nombreEscaneado(U.p[0].file.name), { type: 'image/jpeg', lastModified: Date.now() })]);
      } catch (e) { mensaje('No se pudo procesar la foto: ' + e.message, true); }
      finally { botones.forEach(b => b.disabled = false); }
    });
    dlg.addEventListener('close', () => { if (U.fin) terminar([]); });
  }
  function terminar(archivos) {
    const dlg = $('dlgEscaner'), fin = U.fin; U.fin = null;
    clearTimeout(U.temporizador); U.seq++;
    U.p.forEach(p => { if (p.bm && p.bm.close) p.bm.close(); }); U.p = [];
    if (dlg.open) dlg.close();
    if (fin) fin(archivos);
  }
  async function dialogo(file) {   // abre el diálogo para una imagen; devuelve [File]
    iniciarUI();
    const dlg = $('dlgEscaner');
    let pag; try { pag = await nuevaPagina(file); } catch { return null; }   // no se puede decodificar (p. ej. HEIC)
    U.p = [pag]; U.cur = 0; U.modo = 'color';
    const r = document.querySelector('#dlgEscaner input[name=escModo][value=color]'); if (r) r.checked = true;
    pag.aviso = '';
    return new Promise(res => {
      U.fin = res;
      pintarPaginas(); dlg.showModal(); pintarOrigen(); pintarResultado();
      const a = $('escTit'); if (a) a.focus({ preventScroll: true });
    });
  }

  /* ---------- entrada desde la web ---------- */
  async function preparar(files, opc) {
    opc = opc || {};
    const cand = files.filter(esImagenEscaneable), avisos = [];
    if (!cand.length) {
      if (files.some(f => /\.(heic|heif)$/i.test(f.name || '') || /heic|heif/i.test(f.type || ''))) avisos.push('Las fotos HEIC se suben tal cual (el navegador no puede escanearlas).');
      return { files, avisos };
    }
    const salida = [];
    if (cand.length === 1) {
      for (const f of files) {
        if (f !== cand[0]) { salida.push(f); continue; }
        const r = await dialogo(f);
        if (r === null) { salida.push(f); avisos.push('No se pudo escanear la foto; se sube como está.'); }
        else if (!r.length) avisos.push('Foto descartada: no se ha subido.');
        else salida.push(...r);
      }
      return { files: salida, avisos };
    }
    let hechas = 0, iguales = 0;
    for (const f of files) {
      if (!esImagenEscaneable(f)) { salida.push(f); continue; }
      try {
        const r = await procesarArchivo(f, { modo: 'color' });
        if (r.ok) { salida.push(new File([r.blob], nombreEscaneado(f.name), { type: 'image/jpeg', lastModified: Date.now() })); hechas++; }
        else { salida.push(f); iguales++; }
      } catch { salida.push(f); iguales++; }
    }
    avisos.push(`Escaneadas ${hechas} foto${hechas === 1 ? '' : 's'} automáticamente` + (iguales ? `; ${iguales} se subieron como estaban (no se detectó el ticket).` : '.') + ' Para ajustar una a mano, súbela sola.');
    return { files: salida, avisos };
  }

  global.Escaner = { preparar, analizar, procesarArchivo, MODOS, _interno: { detectarPapel, homografia, cuadrilatero, casco, ordenar, esConvexo } };
})(window);
