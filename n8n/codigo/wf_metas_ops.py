"""Fase 4a: añade a «FACT — Mi dinero» los webhooks de metas y resumen mensual (una sola vez). Uso: python n8n/codigo/wf_metas_ops.py"""
import subprocess, sys, uuid
from sdk_comun import AQUI, CORS, codigo, mcp
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)
WID, META = "IqouBXc2YCFH2xEm", "YA0SHAljOCDAsU86"
P = "={{ $('Mi dinero: procesar').first().json.id }}"
tabla = lambda: {"__rl": True, "mode": "id", "value": META, "cachedResultName": "fact_metas"}
auto = {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []}
def si(nombre, accion, pos):
    return {"name": nombre, "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": pos, "parameters": {"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
        "conditions": [{"id": "si", "leftValue": "={{ $json.accion === '%s' }}" % accion, "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}}}
ops, y = [], 1400
rutas = [("GET /metas", "GET", "metas"), ("POST /metas", "POST", "metas"), ("PATCH /metas", "PATCH", "metas"), ("DELETE /metas", "DELETE", "metas"),
         ("POST /metas/aportar", "POST", "metas/aportar"), ("GET /resumen-mensual", "GET", "resumen-mensual")]
for i, (n, m, p) in enumerate(rutas):
    ops.append({"type": "addNode", "node": {"name": n, "type": "n8n-nodes-base.webhook", "typeVersion": 2.2, "position": [0, y + 160 * i], "webhookId": str(uuid.uuid4()),
        "parameters": {"httpMethod": m, "path": p, "authentication": "headerAuth", "responseMode": "responseNode", "options": {"allowedOrigins": CORS}},
        "credentials": {"httpHeaderAuth": {"id": "factApiKey0000001", "name": "FACT API Key"}}}})
    ops.append({"type": "addConnection", "source": n, "target": "Leer ingresos"})
js = codigo("mi_dinero_filas.js")
add = lambda node: ops.append({"type": "addNode", "node": node})
add({"name": "Leer metas", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [1250, 480], "executeOnce": True, "alwaysOutputData": True,
     "parameters": {"resource": "row", "operation": "get", "dataTableId": tabla(), "returnAll": True}})
add(si("¿Insertar meta?", "insert_meta", [1800, 1500])); add(si("¿Actualizar meta?", "update_meta", [2020, 1620])); add(si("¿Borrar meta?", "delete_meta", [2240, 1740]))
add({"name": "Mi dinero: fila (meta insertar)", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [2020, 1460], "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js}})
add({"name": "Mi dinero: fila (meta actualizar)", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [2240, 1580], "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js}})
add({"name": "Insertar meta", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [2460, 1460], "parameters": {"resource": "row", "operation": "insert", "dataTableId": tabla(), "columns": auto, "options": {}}})
add({"name": "Actualizar meta", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [2680, 1580], "parameters": {"resource": "row", "operation": "update", "dataTableId": tabla(), "matchType": "allConditions",
     "filters": {"conditions": [{"keyName": "id", "condition": "eq", "keyValue": P}]}, "columns": auto, "options": {}}})
add({"name": "Borrar meta", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [2460, 1740], "alwaysOutputData": True, "parameters": {"resource": "row", "operation": "deleteRows", "dataTableId": tabla(), "matchType": "allConditions",
     "filters": {"conditions": [{"keyName": "id", "condition": "eq", "keyValue": P}]}}})
C = lambda s, t, si_=0: ops.append({"type": "addConnection", "source": s, "target": t, "sourceIndex": si_})
ops += [{"type": "removeConnection", "source": "Leer facturas", "target": "Mi dinero: procesar"}, {"type": "removeConnection", "source": "¿Solo lectura o error?", "target": "¿Insertar ingreso?", "sourceIndex": 1}]
C("Leer facturas", "Leer metas"); C("Leer metas", "Mi dinero: procesar"); C("¿Solo lectura o error?", "¿Insertar meta?", 1)
C("¿Insertar meta?", "Mi dinero: fila (meta insertar)", 0); C("¿Insertar meta?", "¿Actualizar meta?", 1)
C("¿Actualizar meta?", "Mi dinero: fila (meta actualizar)", 0); C("¿Actualizar meta?", "¿Borrar meta?", 1)
C("¿Borrar meta?", "Borrar meta", 0); C("¿Borrar meta?", "¿Insertar ingreso?", 1)
C("Mi dinero: fila (meta insertar)", "Insertar meta"); C("Insertar meta", "Mi dinero: respuesta")
C("Mi dinero: fila (meta actualizar)", "Actualizar meta"); C("Actualizar meta", "Mi dinero: respuesta"); C("Borrar meta", "Mi dinero: respuesta")
# código nuevo de procesar y respuesta
ops.append({"type": "setNodeParameter", "nodeName": "Mi dinero: procesar", "path": "/jsCode", "value": codigo("mi_dinero_procesar.js")})
ops.append({"type": "setNodeParameter", "nodeName": "Mi dinero: respuesta", "path": "/jsCode", "value": codigo("mi_dinero_respuesta.js")})
r = mcp().call("update_workflow", {"workflowId": WID, "operations": ops, "versionName": "Fase 4a: metas y resumen mensual"})
print(str(r)[:1500])
