"""Genera tests/escaner/: «fotos» sintéticas de tickets (sobre mesa oscura/clara, con giro, perspectiva, sombra, ruido,
apaisadas y con orientación EXIF) a partir de tests/tickets-ejemplo/TEST_T0[1-4]_*.png, más verdad.json con las esquinas reales.
Uso: .venv\\Scripts\\python tests\\generar_escaner.py   (determinista: semilla fija)"""
import json, math, os, random, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'tests', 'tickets-ejemplo')
SALIDA = os.path.join(RAIZ, 'tests', 'escaner')
random.seed(20261021)


def resolver(A, b):
    n = len(b)
    M = [A[i][:] + [b[i]] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            for k in range(c, n + 1):
                M[r][k] -= f * M[c][k]
    x = [0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (M[r][n] - sum(M[r][k] * x[k] for k in range(r + 1, n))) / M[r][r]
    return x


def coef_perspectiva(destino, origen):
    """Coeficientes para Image.transform(PERSPECTIVE): píxel de salida -> píxel de la imagen de origen."""
    A, b = [], []
    for (x, y), (u, v) in zip(destino, origen):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return resolver(A, b)


def fondo(tam, tipo):
    w, h = tam
    if tipo == 'oscura':
        base, grano = (58, 46, 38), 14
    elif tipo == 'gris_oscura':
        base, grano = (52, 54, 56), 8
    elif tipo == 'gris_clara':
        base, grano = (196, 198, 200), 7
    elif tipo == 'madera_clara':
        base, grano = (196, 168, 130), 16
    else:  # gris_media
        base, grano = (150, 152, 150), 9
    im = Image.new('RGB', (w, h), base)
    ruido = Image.effect_noise((w // 4, h // 4), grano * 2).resize((w, h), Image.BILINEAR).convert('RGB')
    im = ImageChops.add(im, ruido, scale=1, offset=-128 + 0)
    if tipo in ('oscura', 'madera_clara'):   # veta
        d = ImageDraw.Draw(im, 'RGBA')
        for _ in range(int(h / 18)):
            y = random.randint(0, h)
            d.line([(0, y), (w, y + random.randint(-12, 12))], fill=(0, 0, 0, 22 if tipo == 'oscura' else 28), width=random.randint(2, 6))
    return im


def gradiente(tam, a, b, angulo):
    """Imagen L con degradado lineal de a (0-255) a b en la dirección dada (grados)."""
    w, h = tam
    g = Image.linear_gradient('L').resize((max(w, h) * 2, max(w, h) * 2))
    g = g.rotate(angulo, expand=False, resample=Image.BILINEAR)
    g = g.crop(((g.width - w) // 2, (g.height - h) // 2, (g.width + w) // 2, (g.height + h) // 2))
    return g.point(lambda v: a + (b - a) * v / 255.0)


CASOS = [
    # nombre, ticket, lienzo, fondo, ancho_relativo (de la altura/anchura), giro, jitter de perspectiva, sombra (a,b,angulo), ruido, exif, quieto90
    dict(n='01_oscura_12mp', t='TEST_T01_super.png', c=(4000, 3000), f='oscura', e=0.80, giro=8, p=0.03, s=(0.80, 1.0, 20), r=10),
    dict(n='02_oscura_vertical', t='TEST_T02_farmacia.png', c=(3000, 4000), f='gris_oscura', e=0.70, giro=-15, p=0.04, s=(0.7, 1.0, 100), r=8),
    dict(n='03_gris_clara', t='TEST_T04_bar.png', c=(2400, 3200), f='gris_clara', e=0.66, giro=20, p=0.06, s=(0.62, 1.0, 30), r=8),
    dict(n='04_madera_clara', t='TEST_T03_gasolinera.png', c=(2400, 3200), f='madera_clara', e=0.62, giro=-5, p=0.03, s=(0.72, 1.0, 150), r=10),
    dict(n='05_apaisada', t='TEST_T01_super.png', c=(4000, 3000), f='oscura', e=0.86, giro=3, p=0.02, s=(0.85, 1.0, 0), r=8),
    dict(n='06_exif6', t='TEST_T02_farmacia.png', c=(3000, 2250), f='gris_oscura', e=0.72, giro=6, p=0.04, s=(0.8, 1.0, 60), r=8, exif=6),
    dict(n='07_sombra_fuerte', t='TEST_T04_bar.png', c=(2400, 3200), f='oscura', e=0.70, giro=30, p=0.05, s=(0.45, 1.0, 45), r=18),
    dict(n='08_ticket_girado_90', t='TEST_T03_gasolinera.png', c=(3200, 2400), f='gris_oscura', e=0.62, giro=93, p=0.03, s=(0.8, 1.0, 10), r=8),
    dict(n='09_pequeno_gris_media', t='TEST_T01_super.png', c=(3000, 4000), f='gris_media', e=0.40, giro=-25, p=0.04, s=(0.75, 1.0, 120), r=9),
    dict(n='10_clara_perspectiva', t='TEST_T02_farmacia.png', c=(2400, 3200), f='gris_clara', e=0.60, giro=12, p=0.09, s=(0.7, 1.0, 75), r=7),
    dict(n='11_exif8_clara', t='TEST_T04_bar.png', c=(2400, 1800), f='madera_clara', e=0.78, giro=-10, p=0.04, s=(0.75, 1.0, 100), r=9, exif=8),
]


def generar(c):
    papel = Image.open(os.path.join(ORIGEN, c['t'])).convert('RGB')
    W, H = c['c']
    if c.get('exif'):   # se compone ya girado: la imagen «visual» es (H, W) y luego se guarda con la etiqueta EXIF
        W, H = H, W
    pw, ph = papel.size
    # el lado largo del papel mide «e» veces el lado corto del lienzo
    esc = c['e'] * min(W, H) / max(pw, ph)
    w, h = pw * esc, ph * esc
    # que quepa girado
    th = math.radians(c['giro'])
    ext_x = abs(w * math.cos(th)) + abs(h * math.sin(th)); ext_y = abs(w * math.sin(th)) + abs(h * math.cos(th))
    k = min(1.0, 0.92 * W / ext_x, 0.92 * H / ext_y); w, h = w * k, h * k
    cx, cy = W / 2 + random.uniform(-0.03, 0.03) * W, H / 2 + random.uniform(-0.03, 0.03) * H
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    cos, sin = math.cos(th), math.sin(th)
    quad = []
    for x, y in pts:
        xr, yr = x * cos - y * sin, x * sin + y * cos
        jx, jy = random.uniform(-c['p'], c['p']) * w, random.uniform(-c['p'], c['p']) * h
        quad.append([cx + xr + jx, cy + yr + jy])
    lienzo = fondo((W, H), c['f'])
    # papel con borde y grano
    pap = papel.copy()
    ImageDraw.Draw(pap).rectangle([0, 0, pw - 1, ph - 1], outline=(214, 214, 208), width=2)
    coef = coef_perspectiva(quad, [(0, 0), (pw, 0), (pw, ph), (0, ph)])
    warped = pap.transform((W, H), Image.PERSPECTIVE, coef, resample=Image.BICUBIC)
    mascara = Image.new('L', (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, coef, resample=Image.BILINEAR)
    sombra = mascara.filter(ImageFilter.GaussianBlur(max(W, H) / 160)).point(lambda v: int(v * 0.55))
    sombra = ImageChops.offset(sombra, int(W / 130), int(H / 90))
    lienzo = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), lienzo, sombra)
    lienzo = Image.composite(warped, lienzo, mascara.point(lambda v: 255 if v > 127 else v * 2))
    # iluminación irregular (degradado) y ruido de sensor
    a, b, ang = c['s']
    luz = gradiente((W, H), a * 255, b * 255, ang)
    lienzo = ImageChops.multiply(lienzo, Image.merge('RGB', (luz, luz, luz)))
    ruido = Image.effect_noise((W, H), c['r']).convert('RGB')
    lienzo = ImageChops.add(lienzo, ruido, scale=1, offset=-128)
    lienzo = lienzo.filter(ImageFilter.GaussianBlur(0.6))
    return lienzo, quad, (W, H)


def main():
    os.makedirs(SALIDA, exist_ok=True)
    verdad = []
    for c in CASOS:
        im, quad, (W, H) = generar(c)
        ruta = os.path.join(SALIDA, c['n'] + '.jpg')
        ex = c.get('exif')
        if ex:   # se guarda girado y con la etiqueta; la «verdad» queda en el marco visual (ya orientado)
            im_guardar = im.transpose(Image.ROTATE_90) if ex == 6 else im.transpose(Image.ROTATE_270)
            exif = Image.Exif(); exif[0x0112] = ex
            im_guardar.save(ruta, 'JPEG', quality=88, exif=exif)
        else:
            im.save(ruta, 'JPEG', quality=88)
        verdad.append({'archivo': c['n'] + '.jpg', 'ancho': W, 'alto': H, 'esquinas': [[round(x, 1), round(y, 1)] for x, y in quad],
                       'giro_deg': c['giro'], 'fondo': c['f'], 'exif': ex or 1, 'bytes': os.path.getsize(ruta)})
        print(c['n'], W, H, os.path.getsize(ruta) // 1024, 'KB')
    json.dump(verdad, open(os.path.join(SALIDA, 'verdad.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
