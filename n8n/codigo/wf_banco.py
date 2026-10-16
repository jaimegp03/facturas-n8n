"""Genera el código SDK de «FACT — Banco» (POST /banco/importar, GET /banco/movimientos, PATCH /banco/conciliar).
Uso: python n8n/codigo/wf_banco.py [--validar] [--crear]"""
import sys
from sdk_comun import AQUI, J, code, mcp, responder_json, si_error_false, si_true, tabla_get, webhook

MOV = ("AlnHkQASriQlekIA", "fact_movimientos")
FAC = ("7PLB3ZEQRDVYx6iD", "fact_facturas")


def tabla_escribir(var, nombre, tabla, operacion, pos, filtro_id_expr=None):
    filtro = (f", matchType: 'allConditions', filters: {{ conditions: [{{ keyName: 'id', condition: 'eq', keyValue: expr({J('{{ ' + filtro_id_expr + ' }}')}) }}] }}"
              if filtro_id_expr else "")
    return f"""const {var} = node({{ type: 'n8n-nodes-base.dataTable', version: 1.1, config: {{ name: {J(nombre)}, position: {J(pos)},
  parameters: {{ resource: 'row', operation: {J(operacion)}, dataTableId: {{ __rl: true, mode: 'id', value: {J(tabla[0])}, cachedResultName: {J(tabla[1])} }}{filtro},
    columns: {{ mappingMode: 'autoMapInputData', value: {{}}, matchingColumns: [], schema: [] }}, options: {{}} }} }}, output: [{{ id: 1 }}] }});
"""


def regla(clave, ruta):
    return (f"{{ outputKey: {J(clave)}, renameOutput: true, conditions: {{ options: {{ caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }}, combinator: 'and', conditions: ["
            f"{{ id: {J(clave + '-r')}, leftValue: expr('{{{{ $json.ruta }}}}'), rightValue: {J(ruta)}, operator: {{ type: 'string', operation: 'equals' }} }},"
            f"{{ id: {J(clave + '-s')}, leftValue: expr('{{{{ $json.status }}}}'), rightValue: 200, operator: {{ type: 'number', operation: 'equals' }} }} ] }} }}")


partes = [
    "import { workflow, node, trigger, sticky, ifElse, switchCase, expr } from '@n8n/workflow-sdk';\n",
    webhook("tImportar", "POST /banco/importar", "POST", "banco/importar", [0, 0]),
    webhook("tListar", "GET /banco/movimientos", "GET", "banco/movimientos", [0, 240]),
    webhook("tConciliar", "PATCH /banco/conciliar", "PATCH", "banco/conciliar", [0, 420]),
    code("cImportar", "Importar: leer extracto", "banco_importar.js", [240, 0]),
    code("cParam", "Banco: parámetros", "banco_parametros.js", [240, 330]),
    si_error_false("iValidos", "¿Parámetros válidos?", "_error", [480, 160]),
    tabla_get("dClientes", "Leer clientes", "vFk59qcLmkSdGzZg", "fact_clientes", [720, 60]),
    tabla_get("dFacturas", "Leer facturas", FAC[0], FAC[1], [940, 60], filtro_usuario=True, extra=", executeOnce: true"),
    tabla_get("dMovs", "Leer movimientos", MOV[0], MOV[1], [1160, 60], extra=", executeOnce: true"),
    code("cProc", "Banco: procesar", "banco_procesar.js", [1380, 60]),
    f"""const sRuta = switchCase({{ version: 3.4, config: {{ name: '¿Qué hacer?', position: [1600, 60], parameters: {{ mode: 'rules',
  rules: {{ values: [ {regla('importar', 'importar')}, {regla('conciliar', 'conciliar')} ] }},
  options: {{ fallbackOutput: 'extra', renameFallbackOutput: 'Responder' }} }} }} }});
""",
    si_true("iNuevos", "¿Hay movimientos nuevos?", "$json.insertar.length > 0", [1840, -140]),
    code("cFilas", "Importar: filas", "banco_importar_filas.js", [2060, -220]),
    tabla_escribir("dInsertar", "Insertar movimientos", MOV, "insert", [2280, -220]),
    code("cRespImp", "Importar: respuesta", "banco_importar_respuesta.js", [2500, -140], extra=", executeOnce: true"),
    code("cFilaMov", "Conciliar: fila movimiento", "banco_conciliar_mov.js", [1840, 60]),
    tabla_escribir("dActMov", "Actualizar movimiento", MOV, "update", [2060, 60], "$('Banco: procesar').first().json.mov_id"),
    si_true("iFacturas", "¿Cambia alguna factura?", "$('Banco: procesar').first().json.facturas.length > 0", [2280, 60]),
    code("cFacs", "Conciliar: facturas", "banco_conciliar_facturas.js", [2500, -20], extra=", executeOnce: true"),
    code("cFilaFac", "Conciliar: fila factura", "banco_conciliar_fila_factura.js", [2720, -20]),
    tabla_escribir("dActFac", "Actualizar factura", FAC, "update", [2940, -20], "$('Conciliar: facturas').item.json.id"),
    code("cRespCon", "Conciliar: respuesta", "banco_conciliar_respuesta.js", [3160, 60], extra=", executeOnce: true"),
    responder_json("rJson", "Responder", [3400, 240]),
    """const nota = sticky('## FACT — Banco\\nPOST /banco/importar (Norma 43 AEB o CSV; dedupe por hash; sugerencias), GET /banco/movimientos (con sugerencia) y PATCH /banco/conciliar (pagada, ignorado o deshacer).\\nTodo en Code; cifras en céntimos y EUR.', [], { position: [240, -300], width: 640, height: 180 });
""",
    """export default workflow('fact-banco', 'FACT — Banco')
  .add(tImportar).to(cImportar).to(iValidos)
  .add(tListar).to(cParam)
  .add(tConciliar).to(cParam)
  .add(cParam).to(iValidos)
  .add(iValidos.onTrue(dClientes.to(dFacturas.to(dMovs.to(cProc.to(sRuta
      .onCase(0, iNuevos.onTrue(cFilas.to(dInsertar.to(cRespImp.to(rJson)))).onFalse(cRespImp))
      .onCase(1, cFilaMov.to(dActMov.to(iFacturas.onTrue(cFacs.to(cFilaFac.to(dActFac.to(cRespCon)))).onFalse(cRespCon))))
      .onCase(2, rJson)))))).onFalse(rJson))
  .add(cRespCon).to(rJson)
  .add(nota)
  .group('Leer datos', [dClientes, dFacturas, dMovs, cProc], { description: 'Lee clientes, facturas y movimientos y decide: importar, listar con sugerencias o conciliar.' })
  .group('Importar', [iNuevos, cFilas, dInsertar, cRespImp], { description: 'Inserta los movimientos nuevos (los repetidos se descartan por hash) y devuelve las sugerencias con su id.' })
  .group('Conciliar', [cFilaMov, dActMov, iFacturas, cFacs, cFilaFac, dActFac, cRespCon], { description: 'Actualiza el movimiento y marca la factura pagada (o revierte la anterior).' });
""",
]
sdk = "".join(partes)
(AQUI / "montado" / "wf_banco.sdk.js").write_text(sdk, encoding="utf-8")
print("SDK", len(sdk))
if "--validar" in sys.argv or "--crear" in sys.argv:
    m = mcp()
    r = m.call("validate_workflow", {"code": sdk})
    print(str(r)[:3000])
    if "--crear" in sys.argv:
        r = m.call("create_workflow_from_code", {"code": sdk, "name": "FACT — Banco", "projectId": "bZtIqKac0YRZrt14",
                                                 "description": "POST /banco/importar, GET /banco/movimientos y PATCH /banco/conciliar (modo gestoría, tanda C).",
                                                 "versionName": "Tanda C: banco y conciliación"})
        print(str(r)[:3000])
