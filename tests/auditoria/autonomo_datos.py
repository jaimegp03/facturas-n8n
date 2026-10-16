"""Crea (crear) o borra (borrar) los datos personales TEST del autonomo: cliente particular, ingresos, presupuestos, metas, deudas."""
import json, sys, os, urllib.request
R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split('=', 1) for l in open(os.path.join(R, '.env'), encoding='utf8').read().splitlines() if '=' in l)
B = env.get('N8N_BASE_URL', 'http://localhost:5678') + '/webhook'
def api(m, p, b=None):
    rq = urllib.request.Request(B + p, method=m, data=json.dumps(b).encode() if b is not None else None,
                                headers={'X-API-Key': env['FACT_API_KEY'], 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(rq) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
if sys.argv[1] == 'crear':
    s, j = api('POST', '/clientes', {'nombre': 'TEST·Autónomo personal', 'nif': '', 'regimen_iva': 'particular', 'prorrata_pct': 100}); print(s, j)
    cid = j['cliente']['id']
    for x in [dict(tipo='extra', concepto='TEST·Factura emitida cliente A', importe=2420.5, periodicidad='puntual', fecha_inicio='2026-10-03'),
              dict(tipo='otros', concepto='TEST·Factura emitida cliente B', importe=1210.33, periodicidad='puntual', fecha_inicio='2026-09-18'),
              dict(tipo='extra', concepto='TEST·Cuota paga extra', importe=1234.57, periodicidad='anual', fecha_inicio='2026-06-15')]:
        print(api('POST', '/ingresos', dict(cliente_id=cid, **x))[0])
    print(api('PUT', '/presupuestos', dict(cliente_id=cid, presupuestos=[dict(categoria='Alimentación y supermercado', limite_mensual=400.5), dict(categoria='Transporte y combustible', limite_mensual=150)]))[0])
    print(api('POST', '/metas', dict(cliente_id=cid, nombre='TEST·Colchón 6 meses', importe_objetivo=9000, importe_ahorrado=1500.5, fecha_objetivo='2027-10-15', aportacion_mensual_prevista=300)))
    print(api('POST', '/deudas', dict(cliente_id=cid, nombre='TEST·Hipoteca', tipo='hipoteca', capital_inicial=150000, tipo_interes_anual=3.1, plazo_meses=300, fecha_inicio='2024-03-01', dia_pago=5)))
    print(api('POST', '/deudas', dict(cliente_id=cid, nombre='TEST·Préstamo coche', tipo='coche', capital_inicial=12000, tipo_interes_anual=6.5, plazo_meses=60, fecha_inicio='2025-01-01', dia_pago=31)))
    print('CID', cid)
else:
    cid = next(c['id'] for c in api('GET', '/clientes')[1]['items'] if c['nombre'].startswith('TEST·Autónomo'))
    for ruta in ('ingresos', 'metas', 'deudas'):
        for i in api('GET', f'/{ruta}?cliente_id={cid}')[1]['items']: print(ruta, api('DELETE', f'/{ruta}?id={i["id"]}')[0])
    print(api('PUT', '/presupuestos', dict(cliente_id=cid, presupuestos=[]))[0])
