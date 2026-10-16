"""Genera/crea «FACT — Mi dinero». Uso: python n8n/codigo/wf_mi_dinero.py [--validar] [--crear]"""
import sys, subprocess
from sdk_comun import AQUI, J, code, mcp, responder_json, si_true, tabla_get, webhook
subprocess.run([sys.executable, str(AQUI / "montar.py")], check=True, capture_output=True)

ING, PRES = "Ua1CCVMNjxVBHfJM", "7QutL5z5jbyFPoYc"


def tabla(var, nombre, op, tid, tnom, pos, filtro=None, extra=""):
    f = ""
    if filtro:
        f = f", matchType: 'allConditions', filters: {{ conditions: [{{ keyName: {J(filtro[0])}, condition: 'eq', keyValue: {filtro[1]} }}] }}"
    return f"""const {var} = node({{ type: 'n8n-nodes-base.dataTable', version: 1.1, config: {{ name: {J(nombre)}, position: {J(pos)}{extra},
  parameters: {{ resource: 'row', operation: {J(op)}, dataTableId: {{ __rl: true, mode: 'id', value: {J(tid)}, cachedResultName: {J(tnom)} }}{f}{"" if op == "deleteRows" else ", columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {}"} }} }}, output: [{{ id: 1 }}] }});
"""


P = "$('Mi dinero: procesar').first().json"
partes = [
    "import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';\n",
    webhook("tGI", "GET /ingresos", "GET", "ingresos", [0, 0]),
    webhook("tPI", "POST /ingresos", "POST", "ingresos", [0, 160]),
    webhook("tPAI", "PATCH /ingresos", "PATCH", "ingresos", [0, 320]),
    webhook("tDI", "DELETE /ingresos", "DELETE", "ingresos", [0, 480]),
    webhook("tGP", "GET /presupuestos", "GET", "presupuestos", [0, 640]),
    webhook("tPP", "PUT /presupuestos", "PUT", "presupuestos", [0, 800]),
    webhook("tMD", "GET /mi-dinero", "GET", "mi-dinero", [0, 960]),
    webhook("tNom", "POST /nomina/simular", "POST", "nomina/simular", [0, 1200]),
    tabla_get("dIng", "Leer ingresos", ING, "fact_ingresos", [260, 480], extra=", executeOnce: true"),
    tabla_get("dPres", "Leer presupuestos", PRES, "fact_presupuestos", [480, 480], extra=", executeOnce: true"),
    tabla_get("dCat", "Leer categorías", "wUG04k8qKHE1fL8A", "fact_categorias", [700, 480], extra=", executeOnce: true"),
    tabla_get("dCli", "Leer clientes", "vFk59qcLmkSdGzZg", "fact_clientes", [920, 480], extra=", executeOnce: true"),
    tabla_get("dFac", "Leer facturas", "7PLB3ZEQRDVYx6iD", "fact_facturas", [1140, 480], filtro_usuario=True, extra=", executeOnce: true"),
    code("cProc", "Mi dinero: procesar", "mi_dinero_procesar.js", [1360, 480]),
    si_true("iNone", "¿Solo lectura o error?", "$json.accion === 'none'", [1580, 480]),
    si_true("iIns", "¿Insertar ingreso?", "$json.accion === 'insert_ingreso'", [1800, 600]),
    si_true("iUpd", "¿Actualizar ingreso?", "$json.accion === 'update_ingreso'", [2020, 720]),
    si_true("iDel", "¿Borrar ingreso?", "$json.accion === 'delete_ingreso'", [2240, 840]),
    code("cFIns", "Mi dinero: fila (insertar)", "mi_dinero_filas.js", [2020, 560]),
    code("cFUpd", "Mi dinero: fila (actualizar)", "mi_dinero_filas.js", [2240, 680]),
    code("cFPut", "Mi dinero: filas (presupuestos)", "mi_dinero_filas.js", [2680, 960]),
    tabla("tIns", "Insertar ingreso", "insert", ING, "fact_ingresos", [2240, 560]),
    f"""const tUpd = node({{ type: 'n8n-nodes-base.dataTable', version: 1.1, config: {{ name: 'Actualizar ingreso', position: [2460, 680],
  parameters: {{ resource: 'row', operation: 'update', dataTableId: {{ __rl: true, mode: 'id', value: {J(ING)}, cachedResultName: 'fact_ingresos' }}, matchType: 'allConditions',
  filters: {{ conditions: [{{ keyName: 'id', condition: 'eq', keyValue: expr({J('{{ ' + P + '.id }}')}) }}] }},
  columns: {{ mappingMode: 'autoMapInputData', value: {{}}, matchingColumns: [], schema: [] }}, options: {{}} }} }}, output: [{{ id: 1 }}] }});
""",
    tabla("tDelI", "Borrar ingreso", "deleteRows", ING, "fact_ingresos", [2460, 840], filtro=("id", "expr(" + J("{{ " + P + ".id }}") + ")"), extra=", alwaysOutputData: true"),
    tabla("tDelP", "Borrar presupuestos del cliente", "deleteRows", PRES, "fact_presupuestos", [2460, 960], filtro=("cliente_id", "expr(" + J("{{ " + P + ".cliente_id }}") + ")"), extra=", alwaysOutputData: true"),
    si_true("iHay", "¿Hay presupuestos que guardar?", "$json._vacio !== true", [2900, 960]),
    tabla("tInsP", "Insertar presupuestos", "insert", PRES, "fact_presupuestos", [3120, 900]),
    code("cResp", "Mi dinero: respuesta", "mi_dinero_respuesta.js", [3340, 760]),
    code("cNom", "Nómina: simular", "mi_dinero_nomina.js", [260, 1200]),
    responder_json("rJson", "Responder", [3560, 480]),
    "const nota = sticky('## FACT — Mi dinero\\nGET/POST/PATCH/DELETE /ingresos, GET/PUT /presupuestos, GET /mi-dinero y POST /nomina/simular.\\nTodo en Code (céntimos, EUR, sin LLM). Bloque «COMÚN Mi dinero» (fuente n8n/codigo/mi_dinero_comun.js) copiado en la web (modo demo).', [], { position: [260, 240], width: 640, height: 160 });\n",
    """export default workflow('fact-mi-dinero', 'FACT — Mi dinero')
  .add(tGI).to(dIng)
  .add(tPI).to(dIng)
  .add(tPAI).to(dIng)
  .add(tDI).to(dIng)
  .add(tGP).to(dIng)
  .add(tPP).to(dIng)
  .add(tMD).to(dIng)
  .add(dIng).to(dPres.to(dCat.to(dCli.to(dFac.to(cProc.to(iNone
    .onTrue(rJson)
    .onFalse(iIns
      .onTrue(cFIns.to(tIns.to(cResp)))
      .onFalse(iUpd
        .onTrue(cFUpd.to(tUpd.to(cResp)))
        .onFalse(iDel
          .onTrue(tDelI.to(cResp))
          .onFalse(tDelP.to(cFPut.to(iHay.onTrue(tInsP.to(cResp)).onFalse(cResp)))))))))))))
  .add(cResp).to(rJson)
  .add(tNom).to(cNom.to(rJson))
  .add(nota);
""",
]
sdk = "".join(partes)
(AQUI / "montado" / "wf_mi_dinero.sdk.js").write_text(sdk, encoding="utf-8")
print("SDK", len(sdk))
if "--validar" in sys.argv or "--crear" in sys.argv:
    m = mcp()
    print(str(m.call("validate_workflow", {"code": sdk}))[:3000])
    if "--crear" in sys.argv:
        print(str(m.call("create_workflow_from_code", {"code": sdk, "name": "FACT — Mi dinero", "projectId": "bZtIqKac0YRZrt14",
            "description": "Fase 2: ingresos, presupuestos, Mi dinero y simulador de nómina.",
            "versionName": "Fase 2: Mi dinero"}))[:3000])
