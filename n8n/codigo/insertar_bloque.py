"""Inserta (idempotente) un fichero de funciones en el bloque COMÚN Mi dinero antes de la marca de fin.
Uso: python n8n/codigo/insertar_bloque.py <fichero.js> <funcion_marca>"""
import sys
from pathlib import Path
AQUI = Path(__file__).resolve().parent
f, marca = sys.argv[1], sys.argv[2]
p = AQUI / "mi_dinero_comun.js"
t = p.read_text(encoding="utf-8")
if "function " + marca in t:
    print("ya estaba"); sys.exit(0)
fin = "// === COMÚN Mi dinero: fin ==="
t = t.replace(fin, (AQUI / f).read_text(encoding="utf-8") + fin)
p.write_text(t, encoding="utf-8", newline="\n")
print("insertado")
