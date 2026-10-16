"""Inyecta (idempotente) el botón, el diálogo y la copia «COMÚN Finiquito» en web/index.html.
La función de cálculo se copia de n8n/codigo/finiquito.js (entre las marcas); la UI está aquí.
Uso: python n8n/codigo/inyectar_finiquito_web.py"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
web = RAIZ / "web" / "index.html"
js = (RAIZ / "n8n" / "codigo" / "finiquito.js").read_text(encoding="utf-8")
bloque = js[js.index("// === COMÚN Finiquito: inicio ==="): js.index("// === COMÚN Finiquito: fin ===") + len("// === COMÚN Finiquito: fin ===")]
h = web.read_text(encoding="utf-8")

CSS = """
/* ---- Finiquito ---- */
#dlgFiniquito{width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto}
.fin-legal{background:var(--amber-soft);color:var(--ink);border:1px solid var(--line-strong);border-radius:var(--r-ctl);padding:8px 12px;font-size:13px;margin:0 0 12px}
.fin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
.fin-grid .field{min-width:0}
.fin-grid .full{grid-column:1/-1}
.fin-grid input,.fin-grid select{width:100%;min-width:0}
.fin-chk{display:flex;align-items:center;gap:8px;font-weight:500;font-size:13px;margin-bottom:12px}
.fin-tbl{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}
.fin-tbl caption{text-align:left;font-weight:600;padding:4px 0}
.fin-tbl th,.fin-tbl td{padding:6px 8px 6px 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.fin-tbl th{font-weight:500;color:var(--ink)}
.fin-tbl th.imp,.fin-tbl td.imp{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-right:0}
.fin-tbl small{display:block;color:var(--muted);font-weight:400}
.fin-tbl tr.subtotal th,.fin-tbl tr.subtotal td{font-weight:700;background:var(--surface-2)}
.fin-tbl tr.total th,.fin-tbl tr.total td{font-weight:800;font-size:15px;background:var(--accent-soft);color:var(--accent)}
.fin-avisos{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--ink-2)}
@media (max-width:1400px){.bt-fin{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@media (max-width:560px){.fin-grid{grid-template-columns:minmax(0,1fr)}}
@media print{body.imprimiendo-fin > *:not(#dlgFiniquito){display:none!important}body.imprimiendo-fin #dlgFiniquito{position:static;max-height:none;box-shadow:none;border:0;width:auto}.fin-grid,.dlg-actions{display:none!important}}
"""

BOTON = """    <button class="btn btn-sm btn-ghost" id="btnFiniquito" type="button" aria-haspopup="dialog" title="Calculadora de finiquito e indemnización">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/></svg>
      <span class="bt-fin">Finiquito</span>
    </button>
"""

DIALOGO = """
<dialog id="dlgFiniquito" aria-labelledby="finTit">
  <form class="dlg" id="finForm" novalidate>
    <h2 id="finTit">Calculadora de finiquito</h2>
    <p class="fin-legal" id="finLegal" role="note"><strong>Estimación orientativa.</strong> No es asesoramiento legal ni una liquidación oficial: tu convenio, tu contrato o un cálculo laboral pueden dar importes distintos (mejoras, pagas, vacaciones, fiscalidad). Consulta a un profesional antes de firmar.</p>
    <div class="fin-grid">
      <div class="field full"><label for="finTipo">Motivo de la extinción</label><select id="finTipo">
        <option value="dimision">Dimisión</option><option value="fin_contrato_temporal">Fin de contrato temporal</option><option value="despido_improcedente">Despido improcedente</option><option value="despido_objetivo">Despido objetivo</option><option value="despido_disciplinario_procedente">Despido disciplinario procedente</option><option value="mutuo_acuerdo">Mutuo acuerdo</option><option value="fin_obra_o_servicio">Fin de obra o servicio</option></select></div>
      <div class="field"><label for="finIni">Fecha de inicio del contrato</label><input id="finIni" type="date" required></div>
      <div class="field"><label for="finFin">Fecha de fin</label><input id="finFin" type="date" required></div>
      <div class="field"><label for="finSal">Salario bruto anual (€)</label><input id="finSal" type="number" step="any" min="0" inputmode="decimal" required></div>
      <div class="field"><label for="finPagas">Número de pagas</label><select id="finPagas"><option value="12">12</option><option value="14" selected>14</option><option value="15">15</option></select></div>
      <div class="full"><label class="fin-chk" for="finProrr"><input id="finProrr" type="checkbox"> Las pagas extra van prorrateadas en la nómina</label></div>
      <div class="field"><label for="finVacAnu">Días de vacaciones al año (naturales)</label><input id="finVacAnu" type="number" step="any" min="0" value="30" inputmode="decimal"></div>
      <div class="field"><label for="finVacDis">Vacaciones ya disfrutadas este año (días)</label><input id="finVacDis" type="number" step="any" min="0" value="0" inputmode="decimal"></div>
      <div class="field"><label for="finPre">Días de preaviso incumplidos</label><input id="finPre" type="number" step="any" min="0" value="0" inputmode="decimal"></div>
      <div class="field"><label for="finPact">Indemnización pactada (días por año, opcional)</label><input id="finPact" type="number" step="any" min="0" inputmode="decimal"></div>
      <div class="field"><label for="finIrpf">Retención de IRPF estimada (%)</label><input id="finIrpf" type="number" step="any" min="0" max="60" value="0" inputmode="decimal"><small>Pon el de tu nómina; con 0 no se estima.</small></div>
      <div class="field"><label for="finSs">Seguridad Social estimada (%)</label><input id="finSs" type="number" step="any" min="0" max="30" value="6.5" inputmode="decimal"><small>Estimación editable.</small></div>
    </div>
    <p class="msg" id="finMsg" role="status"></p>
    <div id="finRes" aria-live="polite"></div>
    <div class="dlg-actions">
      <button class="btn btn-ghost" type="button" id="finCerrar">Cerrar</button>
      <button class="btn" type="button" id="finCopiar" disabled>Copiar resumen</button>
      <button class="btn" type="button" id="finImprimir" disabled>Imprimir</button>
      <button class="btn btn-primary" type="submit" id="finCalcular">Calcular</button>
    </div>
  </form>
</dialog>
"""

UI = """/* ================= Finiquito ================= */
@@BLOQUE@@
window.calcularFiniquito = calcularFiniquito; // expuesta para la prueba que la compara con n8n
const FIN_ETQ_SIN_USO = {dimision:'Dimisión', fin_contrato_temporal:'Fin de contrato temporal', despido_improcedente:'Despido improcedente', despido_objetivo:'Despido objetivo', despido_disciplinario_procedente:'Despido disciplinario procedente', mutuo_acuerdo:'Mutuo acuerdo', fin_obra_o_servicio:'Fin de obra o servicio'};
const dlgFin = $('#dlgFiniquito');
let finUltimo = null;
async function finiquitoApi(cuerpo) {
  if (DEMO) { // modo demo: la copia JS de la función, sin llamar a n8n
    const r = calcularFiniquito(cuerpo, isoLocal(new Date()));
    if (r.status !== 200) { const e = new Error(r.body.error); e.data = r.body; throw e; }
    return r.body;
  }
  return api('/finiquito', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(cuerpo)});
}
function finCuerpo() {
  const n = id => { const v = $(id).value.trim(); return v === '' ? undefined : v; };
  return {fecha_inicio: $('#finIni').value, fecha_fin: $('#finFin').value, tipo_extincion: $('#finTipo').value, salario_bruto_anual: n('#finSal'),
    num_pagas: Number($('#finPagas').value), pagas_prorrateadas: $('#finProrr').checked, dias_vacaciones_anuales: n('#finVacAnu'),
    dias_vacaciones_disfrutadas: n('#finVacDis'), preaviso_dias_incumplidos: n('#finPre'), irpf_pct: n('#finIrpf'), ss_pct: n('#finSs'),
    indemnizacion_pactada_dias_por_anio: n('#finPact')};
}
function finPintar(r) {
  const filas = r.desglose.map(l => `<tr class="${l.tipo}"><th scope="row">${esc(l.concepto)}${l.detalle ? `<small>${esc(l.detalle)}</small>` : ''}</th><td class="imp">${fmtEur(l.importe)}</td></tr>`).join('');
  const a = r.antiguedad;
  $('#finRes').innerHTML = `<table class="fin-tbl"><caption>${esc(r.tipo_etiqueta)} · ${fmtFecha(r.fecha_inicio)} a ${fmtFecha(r.fecha_fin)} · antigüedad ${a.anios} años, ${a.meses} meses y ${a.dias} días</caption><thead><tr><th scope="col">Concepto</th><th scope="col" class="imp">Importe</th></tr></thead><tbody>${filas}</tbody></table>
    <ul class="fin-avisos">${r.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  $('#finCopiar').disabled = false; $('#finImprimir').disabled = false;
}
function finResumenTexto(r) {
  return [`Finiquito estimado (${r.tipo_etiqueta}) · ${fmtFecha(r.fecha_inicio)} a ${fmtFecha(r.fecha_fin)}`,
    ...r.desglose.map(l => `${l.concepto}: ${fmtEur(l.importe)}${l.detalle ? ` (${l.detalle})` : ''}`),
    'Estimación orientativa, sin valor de asesoramiento legal ni liquidación oficial.'].join('\\n');
}
function abrirFiniquito() {
  if (!$('#finFin').value) $('#finFin').value = isoLocal(new Date());
  $('#finMsg').textContent = ''; dlgFin.showModal(); $('#finTipo').focus();
}
$('#btnFiniquito').addEventListener('click', abrirFiniquito);
$('#finCerrar').addEventListener('click', () => dlgFin.close());
$('#finForm').addEventListener('submit', async e => {
  e.preventDefault();
  const m = $('#finMsg'); m.className = 'msg'; m.textContent = 'Calculando…';
  try { finUltimo = await finiquitoApi(finCuerpo()); m.textContent = ''; finPintar(finUltimo); }
  catch (err) { finUltimo = null; m.className = 'msg err'; m.textContent = (err.data && err.data.detalles ? err.data.detalles.join(' ') : err.message); $('#finRes').innerHTML = ''; $('#finCopiar').disabled = true; $('#finImprimir').disabled = true; }
});
$('#finCopiar').addEventListener('click', async () => {
  if (!finUltimo) return;
  const t = finResumenTexto(finUltimo);
  try { await navigator.clipboard.writeText(t); toast('Resumen copiado'); }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Resumen copiado'); } catch { toast('No se pudo copiar'); } ta.remove(); }
});
$('#finImprimir').addEventListener('click', () => { document.body.classList.add('imprimiendo-fin'); window.print(); });
window.addEventListener('afterprint', () => document.body.classList.remove('imprimiendo-fin'));

"""
UI = UI.replace("@@BLOQUE@@", bloque)

# idempotente: quita lo inyectado antes
h = re.sub(r"\n/\* ---- Finiquito ---- \*/.*?(?=</style>)", "\n", h, flags=re.S)
h = re.sub(r'    <button class="btn btn-sm btn-ghost" id="btnFiniquito".*?</button>\n', "", h, flags=re.S)
h = re.sub(r'\n<dialog id="dlgFiniquito".*?</dialog>\n', "\n", h, flags=re.S)
h = re.sub(r"/\* ================= Finiquito ================= \*/.*?(?=/\* ================= ajustes)", "", h, flags=re.S)

h = h.replace("</style>", CSS + "</style>", 1)
h = h.replace('    <button class="btn btn-sm btn-ghost" id="btnAjustes"', BOTON + '    <button class="btn btn-sm btn-ghost" id="btnAjustes"', 1)
h = h.replace('<dialog id="dlgPreview"', DIALOGO.lstrip("\n") + "\n" + '<dialog id="dlgPreview"', 1)
h = h.replace("/* ================= ajustes ================= */", UI + "/* ================= ajustes ================= */", 1)
web.write_text(h, encoding="utf-8", newline="\n")
print("inyectado", len(h))
