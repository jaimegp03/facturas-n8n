"""Cliente mínimo del MCP integrado de n8n (JSON-RPC por HTTP). Lee N8N_MCP_TOKEN del entorno."""
import json, os, urllib.request

URL = os.environ.get("N8N_BASE_URL", "http://localhost:5678") + "/mcp-server/http"


class MCP:
    def __init__(self):
        tok = os.environ.get("N8N_MCP_TOKEN")
        if not tok:
            raise SystemExit("Falta la variable de entorno N8N_MCP_TOKEN")
        self.h = {"Authorization": "Bearer " + tok, "Content-Type": "application/json",
                  "Accept": "application/json, text/event-stream"}
        self.sid = None
        self.n = 0
        r = self._rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                     "clientInfo": {"name": "auditoria", "version": "1"}})
        self._rpc("notifications/initialized", None, notif=True)

    def _rpc(self, method, params, notif=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notif:
            self.n += 1
            body["id"] = self.n
        h = dict(self.h)
        if self.sid:
            h["mcp-session-id"] = self.sid
        req = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            self.sid = resp.headers.get("mcp-session-id") or self.sid
            raw = resp.read().decode("utf-8")
        if notif or not raw.strip():
            return None
        if raw.lstrip().startswith("{"):
            msg = json.loads(raw)
        else:  # SSE
            datos = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
            msg = json.loads(datos[-1])
        if "error" in msg:
            raise RuntimeError(msg["error"])
        return msg["result"]

    def call(self, tool, args):
        r = self._rpc("tools/call", {"name": tool, "arguments": args})
        if r.get("isError"):
            raise RuntimeError(r)
        if "structuredContent" in r and r["structuredContent"] is not None:
            return r["structuredContent"]
        txt = "".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
        return json.loads(txt)


PROYECTO = "bZtIqKac0YRZrt14"
TABLAS = {"fact_facturas": "7PLB3ZEQRDVYx6iD", "fact_reglas": "oQBEGmTUhFU6mN8i",
          "fact_recomendaciones": "0LOu68SrmyMgKOIi"}
# Todas las tablas fact_* (copia completa antes de cambios de esquema)
TABLAS_TODAS = dict(TABLAS, fact_categorias="wUG04k8qKHE1fL8A", fact_errores="kJz2JABz5M6eCtR2",
                    fact_clientes="vFk59qcLmkSdGzZg", fact_movimientos="AlnHkQASriQlekIA")


def leer_tabla(mcp, tabla_id):
    filas, skip = [], 0
    total = None
    while True:
        r = mcp.call("get_data_table_rows", {"dataTableId": tabla_id, "projectId": PROYECTO,
                                             "limit": 100, "skip": skip, "sortBy": "id:asc"})
        lote = r.get("data", r.get("rows", []))
        total = r.get("count", total)
        filas.extend(lote)
        skip += len(lote)
        if len(lote) < 100 or (total is not None and skip >= total):
            break
    return filas, total
