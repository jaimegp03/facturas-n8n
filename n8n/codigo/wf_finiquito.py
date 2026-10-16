"""Genera/crea «FACT — Finiquito» (POST /finiquito). Uso: python n8n/codigo/wf_finiquito.py [--validar] [--crear]"""
import sys, subprocess
from sdk_comun import AQUI, code, mcp, responder_json, webhook
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)
sdk = "import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';\n" + \
    webhook("tFin", "POST /finiquito", "POST", "finiquito", [0, 0]) + \
    code("cCalc", "Calcular finiquito", "finiquito.js", [240, 0]) + \
    responder_json("rJson", "Responder", [480, 0]) + \
    "const nota = sticky('## FACT — Finiquito\\nPOST /finiquito: calculadora orientativa de finiquito e indemnización (España). Todo en Code, céntimos enteros, sin LLM.', [], { position: [0, -220], width: 520, height: 140 });\n" + \
    "export default workflow('fact-finiquito', 'FACT — Finiquito').add(tFin).to(cCalc).to(rJson).add(nota);\n"
m = mcp()
if "--validar" in sys.argv or "--crear" in sys.argv:
    print(str(m.call("validate_workflow", {"code": sdk}))[:2000])
if "--crear" in sys.argv:
    print(str(m.call("create_workflow_from_code", {"code": sdk, "name": "FACT — Finiquito", "projectId": "bZtIqKac0YRZrt14",
        "description": "POST /finiquito: calculadora de finiquito e indemnización (España, orientativa).", "versionName": "Finiquito inicial"}))[:1500])
