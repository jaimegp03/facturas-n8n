"""Inyecta (idempotente) en web/index.html la vista aparte «Mi dinero» (#sceneMd, hash #/mi-dinero/<sección>), el diálogo del simulador de nómina,
el diálogo de ingresos, las rutas del modo demo y la copia «COMÚN Mi dinero» (de n8n/codigo/mi_dinero_comun.js).
Las piezas de interfaz viven en n8n/codigo/web_mi_dinero/ (css.css, seccion.html, dialogos.html, ui.js, demo_ruta.js).
Uso: python n8n/codigo/inyectar_mi_dinero_web.py   (si cambias mi_dinero_comun.js, vuelve a ejecutarlo y sube los Code con actualizar_code.py)"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
AQUI = RAIZ / "n8n" / "codigo"
PIEZAS = AQUI / "web_mi_dinero"
web = RAIZ / "web" / "index.html"
NL = chr(10)
js = (AQUI / "mi_dinero_comun.js").read_text(encoding="utf-8")
bloque = js[js.index("// === COMÚN Mi dinero: inicio ==="): js.index("// === COMÚN Mi dinero: fin ===") + len("// === COMÚN Mi dinero: fin ===")]
h = web.read_text(encoding="utf-8")


def pieza(n):
    return (PIEZAS / n).read_text(encoding="utf-8")


CSS, SECCION, DIALOGOS, DEMO_RUTA = (pieza("css.css"), pieza("seccion.html"), pieza("dialogos.html"), pieza("demo_ruta.js"))
UI = pieza("ui.js").replace("@@BLOQUE@@", bloque) + pieza("ui_metas.js") + pieza("ui_renta.js") + pieza("ui_deudas.js") + pieza("ui_vistas.js")

# idempotente: quita lo inyectado antes (HTML entre marcadores <!--MD:x--> ... <!--/MD-->)
h = re.sub(r"\n/\* ---- Mi dinero ---- \*/.*?(?=</style>)", "", h, flags=re.S)
h = h.replace("sincronizarVista();" + NL + "cargarTodo();", "cargarTodo();")
h = re.sub(r"<!--MD:[a-z]+-->.*?<!--/MD-->\n?", "", h, flags=re.S)
h = re.sub(r"/\* ================= Mi dinero \(fase 2\) ================= \*/.*?(?=/\* ================= ajustes)", "", h, flags=re.S)
h = re.sub(r"/\* demo Mi dinero \*/.*?/\* fin demo Mi dinero \*/\n", "", h, flags=re.S)
h = re.sub(r", ingresos:mdDemoIngresos\(hoyIso\), presupuestos:mdDemoPres\(\), sigIng:10, sigPres:100(, metas:mdDemoMetas\(hoyIso\), sigMeta:10)?(, deudas:mdDemoDeudas\(hoyIso\), sigDeuda:10)?\};", "};", h)
h = h.replace(", cargarMovimientos(), cargarMiDinero()]);", ", cargarMovimientos()]);")


def mk(n, x):
    return "<!--MD:" + n + "-->" + x + "<!--/MD-->" + NL


h = h.replace("</style>", CSS + "</style>", 1)
h = h.replace("  </main>" + NL + "</div>" + NL + NL + '<footer class="foot"', "  </main>" + NL + "</div>" + NL + mk("seccion", SECCION) + NL + '<footer class="foot"', 1)
h = h.replace('<dialog id="dlgPreview"', mk("dialogos", DIALOGOS) + '<dialog id="dlgPreview"', 1)
h = h.replace("/* ================= ajustes ================= */", UI + "/* ================= ajustes ================= */", 1)
h = h.replace("recs:{}, importados:{}};", "recs:{}, importados:{}, ingresos:mdDemoIngresos(hoyIso), presupuestos:mdDemoPres(), sigIng:10, sigPres:100, metas:mdDemoMetas(hoyIso), sigMeta:10, deudas:mdDemoDeudas(hoyIso), sigDeuda:10};", 1)
h = h.replace("throw fallo(404, 'Ruta no disponible en la demo: ' + ruta);" + NL + "}", DEMO_RUTA + "throw fallo(404, 'Ruta no disponible en la demo: ' + ruta);" + NL + "}", 1)
h = h.replace("cargarRecs(), cargarMovimientos()]);", "cargarRecs(), cargarMovimientos(), cargarMiDinero()]);", 1)
h = h.replace("cargarTodo();" + NL + "revelar();" + NL + "})();", "sincronizarVista();" + NL + "cargarTodo();" + NL + "revelar();" + NL + "})();", 1)
web.write_text(h, encoding="utf-8", newline=NL)
print("inyectado", len(h))
