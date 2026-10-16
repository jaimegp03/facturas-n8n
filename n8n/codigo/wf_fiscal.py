"""Genera el código SDK de «FACT — Fiscal» (GET /fiscal, /libro-registro, /asientos).
Uso: python n8n/codigo/wf_fiscal.py [--validar] [--crear] -> escribe montado/wf_fiscal.sdk.js"""
import sys
from sdk_comun import AQUI, J, code, mcp, responder_json, si_error_false, si_true, tabla_get, webhook

EXPOSE = "Content-Disposition, X-Formato-Estado, X-Excluidas, X-Avisos"
partes = [
    "import { workflow, node, trigger, sticky, ifElse, expr } from '@n8n/workflow-sdk';\n",
    webhook("tFiscal", "GET /fiscal", "GET", "fiscal", [0, 0]),
    webhook("tLibro", "GET /libro-registro", "GET", "libro-registro", [0, 200]),
    webhook("tAsientos", "GET /asientos", "GET", "asientos", [0, 400]),
    code("cParam", "Parámetros", "fiscal_parametros.js", [260, 200]),
    si_error_false("iValidos", "¿Parámetros válidos?", "_error", [500, 200]),
    tabla_get("dClientes", "Leer clientes", "vFk59qcLmkSdGzZg", "fact_clientes", [740, 100]),
    tabla_get("dFacturas", "Leer facturas", "7PLB3ZEQRDVYx6iD", "fact_facturas", [980, 100], filtro_usuario=True, extra=", executeOnce: true"),
    code("cCalc", "Fiscal: calcular", "fiscal_calcular.js", [1220, 100]),
    si_true("iFichero", "¿Es fichero?", "$json.fichero === true", [1460, 100]),
    f"""const rFichero = node({{ type: 'n8n-nodes-base.respondToWebhook', version: 1.5, config: {{ name: 'Responder fichero', position: [1700, 0],
  parameters: {{ respondWith: 'binary', responseDataSource: 'set', inputFieldName: 'data', options: {{ responseCode: 200, responseHeaders: {{ entries: [
    {{ name: 'Content-Type', value: expr('{{{{ $json.mime }}}}') }},
    {{ name: 'Content-Disposition', value: expr('attachment; filename="{{{{ $json.nombre }}}}"') }},
    {{ name: 'X-Formato-Estado', value: expr('{{{{ $json.formato_estado }}}}') }},
    {{ name: 'X-Excluidas', value: expr('{{{{ $json.excluidas }}}}') }},
    {{ name: 'X-Avisos', value: expr('{{{{ $json.avisos }}}}') }},
    {{ name: 'Access-Control-Expose-Headers', value: {J(EXPOSE)} }},
    {{ name: 'Cache-Control', value: 'no-store' }} ] }} }} }} }} }});
""",
    responder_json("rJson", "Responder", [1700, 260]),
    """const nota = sticky('## FACT — Fiscal\\nGET /fiscal (303 por tipo, 111/115, 349, 347 anual, avisos), GET /libro-registro (json|csv) y GET /asientos (csv|a3|holded).\\nTodo en Code (céntimos, EUR). Bloque «COMÚN Fiscal» idéntico en Exportar Excel («Generar Excel»); fuente n8n/codigo/comun_fiscal.js.', [], { position: [240, -260], width: 620, height: 200 });
""",
    """export default workflow('fact-fiscal', 'FACT — Fiscal')
  .add(tFiscal).to(cParam)
  .add(tLibro).to(cParam)
  .add(tAsientos).to(cParam)
  .add(cParam).to(iValidos.onTrue(dClientes.to(dFacturas.to(cCalc.to(iFichero.onTrue(rFichero).onFalse(rJson))))).onFalse(rJson))
  .add(nota)
  .group('Cálculo fiscal', [dClientes, dFacturas, cCalc], { description: 'Lee clientes y facturas y calcula 303, retenciones, 349, 347, libro registro o asientos en Code (céntimos, EUR).' });
""",
]
sdk = "".join(partes)
(AQUI / "montado" / "wf_fiscal.sdk.js").write_text(sdk, encoding="utf-8")
print("SDK", len(sdk))
if "--validar" in sys.argv or "--crear" in sys.argv:
    m = mcp()
    r = m.call("validate_workflow", {"code": sdk})
    print(str(r)[:3000])
    if "--crear" in sys.argv:
        r = m.call("create_workflow_from_code", {"code": sdk, "name": "FACT — Fiscal", "projectId": "bZtIqKac0YRZrt14",
                                                 "description": "GET /fiscal, /libro-registro y /asientos (modo gestoría, tanda B).",
                                                 "versionName": "Tanda B: fiscal, libro registro y asientos"})
        print(str(r)[:3000])
