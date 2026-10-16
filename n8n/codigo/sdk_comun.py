"""Piezas comunes para generar código SDK de n8n (workflows FACT — Fiscal y FACT — Banco) desde Python.
Los jsCode se incrustan con json.dumps (literal JS válido)."""
import json
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI.parent.parent / "tests" / "auditoria"))

CORS = ("null,http://localhost,http://localhost:3000,http://localhost:5173,http://localhost:5500,http://localhost:8000,"
        "http://localhost:8080,http://localhost:8765,http://127.0.0.1:5500,http://127.0.0.1:8000,http://127.0.0.1:8080,http://127.0.0.1:8765")
CRED = "{ httpHeaderAuth: { id: 'factApiKey0000001', name: 'FACT API Key' } }"
J = json.dumps


def codigo(nombre: str) -> str:
    return (AQUI / "montado" / nombre).read_text(encoding="utf-8")


def webhook(var: str, nombre: str, metodo: str, ruta: str, pos) -> str:
    return f"""const {var} = trigger({{ type: 'n8n-nodes-base.webhook', version: 2.2, config: {{ name: {J(nombre)}, position: {J(pos)},
  parameters: {{ httpMethod: {J(metodo)}, path: {J(ruta)}, authentication: 'headerAuth', responseMode: 'responseNode', options: {{ allowedOrigins: {J(CORS)} }} }},
  credentials: {CRED} }}, output: [{{ headers: {{}}, params: {{}}, query: {{}}, body: {{}} }}] }});
"""


def code(var: str, nombre: str, archivo: str, pos, extra: str = "") -> str:
    return f"""const {var} = node({{ type: 'n8n-nodes-base.code', version: 2, config: {{ name: {J(nombre)}, position: {J(pos)}{extra},
  parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {J(codigo(archivo))} }} }}, output: [{{ ok: true }}] }});
"""


def si_error_false(var: str, nombre: str, campo: str, pos) -> str:
    """IF que deja pasar por true los items con campo === false (igual que «¿PATCH id válido?» de la API)."""
    return f"""const {var} = ifElse({{ version: 2.3, config: {{ name: {J(nombre)}, position: {J(pos)}, parameters: {{ conditions: {{
  options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }},
  conditions: [{{ id: 'ok', leftValue: expr({J('{{ $json.' + campo + ' }}')}), rightValue: '', operator: {{ type: 'boolean', operation: 'false', singleValue: true }} }}],
  combinator: 'and' }} }} }} }});
"""


def si_true(var: str, nombre: str, expr_txt: str, pos) -> str:
    return f"""const {var} = ifElse({{ version: 2.3, config: {{ name: {J(nombre)}, position: {J(pos)}, parameters: {{ conditions: {{
  options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }},
  conditions: [{{ id: 'si', leftValue: expr({J('{{ ' + expr_txt + ' }}')}), rightValue: '', operator: {{ type: 'boolean', operation: 'true', singleValue: true }} }}],
  combinator: 'and' }} }} }} }});
"""


def tabla_get(var: str, nombre: str, tabla_id: str, tabla_nombre: str, pos, filtro_usuario=False, extra: str = "") -> str:
    filtros = (", matchType: 'allConditions', filters: { conditions: [{ keyName: 'usuario_id', condition: 'eq', keyValue: 'default' }] }" if filtro_usuario else "")
    return f"""const {var} = node({{ type: 'n8n-nodes-base.dataTable', version: 1.1, config: {{ name: {J(nombre)}, position: {J(pos)}, alwaysOutputData: true{extra},
  parameters: {{ resource: 'row', operation: 'get', dataTableId: {{ __rl: true, mode: 'id', value: {J(tabla_id)}, cachedResultName: {J(tabla_nombre)} }}{filtros}, returnAll: true }} }}, output: [{{ id: 1 }}] }});
"""


def responder_json(var: str, nombre: str, pos) -> str:
    return f"""const {var} = node({{ type: 'n8n-nodes-base.respondToWebhook', version: 1.5, config: {{ name: {J(nombre)}, position: {J(pos)},
  parameters: {{ respondWith: 'json', responseBody: expr('{{{{ JSON.stringify($json.body) }}}}'), options: {{ responseCode: expr('{{{{ $json.status }}}}') }} }} }} }});
"""


def mcp():
    from mcp_cliente import MCP
    return MCP()
