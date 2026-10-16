"""Monta el jsCode final de los Code nodes que llevan bloques COMÚN: sustituye /*@@COMUN_FISCAL@@*/
por n8n/codigo/comun_fiscal.js (y /*@@EXCEL_FISCAL@@*/ por excel_fiscal_hojas.js) y deja el resultado en n8n/codigo/montado/<archivo>.
Uso: python n8n/codigo/montar.py"""
from pathlib import Path

AQUI = Path(__file__).resolve().parent
COMUN = (AQUI / "comun_fiscal.js").read_text(encoding="utf-8").rstrip("\n")
(AQUI / "montado").mkdir(exist_ok=True)
for f in sorted(AQUI.glob("*.js")):
    if f.name in ("comun_fiscal.js", "excel_fiscal_hojas.js", "mi_dinero_comun.js", "ingesta_tipo_suministro.js"):
        continue
    txt = f.read_text(encoding="utf-8")
    if "/*@@COMUN_FISCAL@@*/" in txt:
        txt = txt.replace("/*@@COMUN_FISCAL@@*/", COMUN)
    if "/*@@EXCEL_FISCAL@@*/" in txt:
        txt = txt.replace("/*@@EXCEL_FISCAL@@*/", (AQUI / "excel_fiscal_hojas.js").read_text(encoding="utf-8").rstrip(chr(10)))
    if "/*@@COMUN_MI_DINERO@@*/" in txt:
        txt = txt.replace("/*@@COMUN_MI_DINERO@@*/", (AQUI / "mi_dinero_comun.js").read_text(encoding="utf-8").rstrip(chr(10)))
    if "/*@@TIPO_SUMINISTRO@@*/" in txt:
        txt = txt.replace("/*@@TIPO_SUMINISTRO@@*/", (AQUI / "ingesta_tipo_suministro.js").read_text(encoding="utf-8").rstrip(chr(10)))
    (AQUI / "montado" / f.name).write_text(txt, encoding="utf-8", newline="\n")
    print("montado", f.name, len(txt))
