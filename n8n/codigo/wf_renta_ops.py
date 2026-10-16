"""Fase 4b etapa 1: añade GET /renta a «FACT — Mi dinero» (una sola vez) y sube el código. Uso: python n8n/codigo/wf_renta_ops.py"""
import subprocess, sys, uuid
from sdk_comun import AQUI, CORS, codigo, mcp
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)
WID = "IqouBXc2YCFH2xEm"
ops = [{"type": "addNode", "node": {"name": "GET /renta", "type": "n8n-nodes-base.webhook", "typeVersion": 2.2, "position": [0, 2400], "webhookId": str(uuid.uuid4()),
        "parameters": {"httpMethod": "GET", "path": "renta", "authentication": "headerAuth", "responseMode": "responseNode", "options": {"allowedOrigins": CORS}},
        "credentials": {"httpHeaderAuth": {"id": "factApiKey0000001", "name": "FACT API Key"}}}},
       {"type": "addConnection", "source": "GET /renta", "target": "Leer ingresos"}]
for n, f in (("Mi dinero: procesar", "mi_dinero_procesar.js"), ("Nómina: simular", "mi_dinero_nomina.js")):
    ops.append({"type": "setNodeParameter", "nodeName": n, "path": "/jsCode", "value": codigo(f)})
m = mcp()
r = m.call("update_workflow", {"workflowId": WID, "operations": ops, "versionName": "Fase 4b: GET /renta"})
print(str(r)[:600])
print(m.call("publish_workflow", {"workflowId": WID}))
