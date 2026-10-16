"""Sustituye el jsCode de uno o varios Code nodes desde n8n/codigo/montado (sin pegar código en las llamadas).
Uso: python n8n/codigo/actualizar_code.py <workflowId> "<nodo>=<archivo.js>" [...] [--publicar] [--version "texto"]"""
import subprocess, sys
from pathlib import Path
from sdk_comun import AQUI, mcp
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)
wid = sys.argv[1]
pares = [a.split("=", 1) for a in sys.argv[2:] if "=" in a and not a.startswith("--")]
version = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else "Actualiza Code nodes"
ops = [{"type": "setNodeParameter", "nodeName": n, "path": "/jsCode", "value": (AQUI / "montado" / f).read_text(encoding="utf-8")} for n, f in pares]
m = mcp()
r = m.call("update_workflow", {"workflowId": wid, "operations": ops, "versionName": version[:80]})
print({k: r.get(k) for k in ("appliedOperations", "removedGroups", "skippedOperations")})
if "--publicar" in sys.argv:
    print(m.call("publish_workflow", {"workflowId": wid}))
