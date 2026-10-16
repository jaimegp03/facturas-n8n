"""Fase 4b etapa 2: añade a «FACT — Mi dinero» los webhooks de deudas y préstamos (una sola vez). Uso: python n8n/codigo/wf_metas_ops.py"""
import subprocess, sys, uuid
from sdk_comun import AQUI, CORS, codigo, mcp
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)
WID, META = "IqouBXc2YCFH2xEm", "zVO6FlsuD5C6ZRml"
P = "={{ $('Mi dinero: procesar').first().json.id }}"
tabla = lambda: {"__rl": True, "mode": "id", "value": META, "cachedResultName": "fact_deudas"}
auto = {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []}
def si(nombre, accion, pos):
    return {"name": nombre, "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": pos, "parameters": {"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
        "conditions": [{"id": "si", "leftValue": "={{ $json.accion === '%s' }}" % accion, "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}}}
ops, y = [], 3000
rutas = [("GET /deudas", "GET", "deudas"), ("POST /deudas", "POST", "deudas"), ("PATCH /deudas", "PATCH", "deudas"), ("DELETE /deudas", "DELETE", "deudas"),
         ("POST /deudas/simular", "POST", "deudas/simular"), ("GET /deudas/resumen", "GET", "deudas/resumen")]
for i, (n, m, p) in enumerate(rutas):
    ops.append({"type": "addNode", "node": {"name": n, "type": "n8n-nodes-base.webhook", "typeVersion": 2.2, "position": [0, y + 160 * i], "webhookId": str(uuid.uuid4()),
        "parameters": {"httpMethod": m, "path": p, "authentication": "headerAuth", "responseMode": "responseNode", "options": {"allowedOrigins": CORS}},
        "credentials": {"httpHeaderAuth": {"id": "factApiKey0000001", "name": "FACT API Key"}}}})
    ops.append({"type": "addConnection", "source": n, "target": "Leer ingresos"})
js = codigo("mi_dinero_filas.js")
add = lambda node: ops.append({"type": "addNode", "node": node})
add({"name": "Leer deudas", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [1470, 480], "executeOnce": True, "alwaysOutputData": True,
     "parameters": {"resource": "row", "operation": "get", "dataTableId": tabla(), "returnAll": True}})
add(si("¿Insertar deuda?", "insert_deuda", [2900, 1500])); add(si("¿Actualizar deuda?", "update_deuda", [3120, 1620])); add(si("¿Borrar deuda?", "delete_deuda", [3340, 1740]))
add({"name": "Mi dinero: fila (deuda insertar)", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [3120, 1460], "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js}})
add({"name": "Mi dinero: fila (deuda actualizar)", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [3340, 1580], "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js}})
add({"name": "Insertar deuda", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [3560, 1460], "parameters": {"resource": "row", "operation": "insert", "dataTableId": tabla(), "columns": auto, "options": {}}})
add({"name": "Actualizar deuda", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [3780, 1580], "parameters": {"resource": "row", "operation": "update", "dataTableId": tabla(), "matchType": "allConditions",
     "filters": {"conditions": [{"keyName": "id", "condition": "eq", "keyValue": P}]}, "columns": auto, "options": {}}})
add({"name": "Borrar deuda", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [3560, 1740], "alwaysOutputData": True, "parameters": {"resource": "row", "operation": "deleteRows", "dataTableId": tabla(), "matchType": "allConditions",
     "filters": {"conditions": [{"keyName": "id", "condition": "eq", "keyValue": P}]}}})
C = lambda s, t, si_=0: ops.append({"type": "addConnection", "source": s, "target": t, "sourceIndex": si_})
ops += [{"type": "removeConnection", "source": "Leer metas", "target": "Mi dinero: procesar"}, {"type": "removeConnection", "source": "¿Borrar meta?", "target": "¿Insertar ingreso?", "sourceIndex": 1}]
C("Leer metas", "Leer deudas"); C("Leer deudas", "Mi dinero: procesar"); C("¿Borrar meta?", "¿Insertar deuda?", 1)
C("¿Insertar deuda?", "Mi dinero: fila (deuda insertar)", 0); C("¿Insertar deuda?", "¿Actualizar deuda?", 1)
C("¿Actualizar deuda?", "Mi dinero: fila (deuda actualizar)", 0); C("¿Actualizar deuda?", "¿Borrar deuda?", 1)
C("¿Borrar deuda?", "Borrar deuda", 0); C("¿Borrar deuda?", "¿Insertar ingreso?", 1)
C("Mi dinero: fila (deuda insertar)", "Insertar deuda"); C("Insertar deuda", "Mi dinero: respuesta")
C("Mi dinero: fila (deuda actualizar)", "Actualizar deuda"); C("Actualizar deuda", "Mi dinero: respuesta"); C("Borrar deuda", "Mi dinero: respuesta")
# código nuevo de procesar y respuesta
ops.append({"type": "setNodeParameter", "nodeName": "Mi dinero: procesar", "path": "/jsCode", "value": codigo("mi_dinero_procesar.js")})
ops.append({"type": "setNodeParameter", "nodeName": "Mi dinero: respuesta", "path": "/jsCode", "value": codigo("mi_dinero_respuesta.js")})
r = mcp().call("update_workflow", {"workflowId": WID, "operations": ops, "versionName": "Fase 4b: deudas y préstamos"})
print(str(r)[:300])
r2 = mcp().call("update_workflow", {"workflowId": WID, "operations": [
    {"type": "setNodeSettings", "nodeName": "Leer deudas", "settings": {"alwaysOutputData": True, "executeOnce": True}},
    {"type": "setNodeSettings", "nodeName": "Borrar deuda", "settings": {"alwaysOutputData": True}}], "versionName": "Fase 4b: ajustes deudas"})
print(str(r2)[:200])
print(mcp().call("publish_workflow", {"workflowId": WID}))
