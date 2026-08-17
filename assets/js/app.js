/* =========================================================================
   SISTEMA DE PROGRAMAS SOCIALES — App principal (app.html)
   Consume la API REST del backend (Neon vía Render). Requiere sesión activa.
   ========================================================================= */

/* ---------- GUARD DE SESIÓN ---------- */
const CURRENT_USER = JSON.parse(localStorage.getItem('pb_user') || 'null');
if (!localStorage.getItem('pb_token') || !CURRENT_USER) {
  window.location.href = 'index.html';
  throw new Error('No autenticado');
}

/* ---------- COLORES (paleta validada) ---------- */
const COLOR_AUTORIZADO   = '#9B3A5E';
const COLOR_COMPROMETIDO = '#C9862B';
const COLOR_PAGADO       = '#1BAF7A';
const COLOR_MODIFICADO   = '#6E5A8C';
const COLOR_HACIENDA     = '#2A78D6';

let chartRegistry = {};
let UNIDADES = [];
let state = { view:{name:'inicio'}, programs: [] };

/* ---------- FORMAT HELPERS ---------- */
const fmtMoney = (n)=> '$' + Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtMoneyCompact = (n)=> new Intl.NumberFormat('es-MX',{notation:'compact',compactDisplay:'short',style:'currency',currency:'MXN',maximumFractionDigits:1}).format(n||0);
const fmtNum = (n)=> Number(n||0).toLocaleString('es-MX');
const fmtDate = (iso)=> { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' + d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}); };

function toast(msg, isError){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError? ' error':'');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.remove('show'), 3500);
}
async function safeCall(fn, successMsg){
  try{ const r = await fn(); if(successMsg) toast(successMsg); return r; }
  catch(err){ toast(err.message || 'Ocurrió un error.', true); throw err; }
}

/* ---------- COMPUTED HELPERS (sobre datos numéricos del API) ---------- */
function montoAutorizadoBase(p){ return Number(p.monto_autorizado || 0); }
function totalModificado(p){
  return (p.modificaciones||[]).reduce((s,m)=> s + (m.tipo==='Ampliación'? Number(m.monto) : -Number(m.monto)), 0);
}
function totalAutorizadoNeto(p){ return montoAutorizadoBase(p) + totalModificado(p); }
function totalPersonasDictaminadas(p){
  return (p.dictamenes||[]).reduce((s,d)=> s + (d.solicitudes||[]).reduce((s2,so)=> s2+Number(so.personas||0),0), 0);
}
function totalComprometido(p){ return totalPersonasDictaminadas(p) * Number(p.monto_beneficiario); }
function totalSolicitadoHacienda(p){ return (p.solicitudesHacienda||[]).reduce((s,h)=>s+Number(h.monto),0); }
function totalPagado(p){ return (p.pagos||[]).reduce((s,g)=>s+Number(g.monto),0); }
function totalDisponible(p){ return totalAutorizadoNeto(p) - totalComprometido(p); }

function estadoPrograma(p){
  if(p.monto_autorizado===null || p.monto_autorizado===undefined) return {label:'Registrado', color:'var(--status-registrado)'};
  if(totalComprometido(p)===0) return {label:'Autorizado', color:'var(--status-autorizado)'};
  if(totalPagado(p) < totalComprometido(p)) return {label:'En Dictaminación', color:'var(--status-dictaminacion)'};
  return {label:'Pagado', color:'var(--status-pagado)'};
}

/* =========================================================================
   INIT — carga usuario, unidades y programas
   ========================================================================= */
async function init(){
  document.getElementById('navUserName').textContent = CURRENT_USER.nombre;
  document.getElementById('navUserRole').textContent = 'Administrador';
  document.getElementById('navUserAvatar').textContent = (CURRENT_USER.nombre||'?').trim().charAt(0).toUpperCase();

  document.getElementById('btnLogout').addEventListener('click', ()=>{
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user');
    window.location.href = 'index.html';
  });

  try{
    UNIDADES = await Api.get('/unidades');
    state.programs = await Api.get('/programs');
  }catch(err){
    toast(err.message || 'No se pudieron cargar los datos.', true);
  }
  navigate({name:'inicio'});
}

async function refreshPrograms(){ state.programs = await Api.get('/programs'); }
async function refreshOneProgram(id){
  const idx = state.programs.findIndex(p=>p.id===id);
  const full = await Api.get('/programs/'+id);
  if(idx>=0) state.programs[idx] = full; else state.programs.push(full);
  return full;
}

/* =========================================================================
   ROUTER
   ========================================================================= */
function navigate(view){
  state.view = view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));

  if(view.name==='inicio'){
    document.getElementById('view-inicio').classList.add('active');
    document.querySelector('[data-nav="inicio"]').classList.add('active');
    setHeader('SISTEMA DE PROGRAMAS SOCIALES','Gestión Presupuestal, Dictaminación y Seguimiento','Secretaría de Bienestar e Inclusión Social');
    renderInicio();
  } else if(view.name==='programas'){
    document.getElementById('view-programas').classList.add('active');
    document.querySelector('[data-nav="programas"]').classList.add('active');
    setHeader('PROGRAMAS REGISTRADOS','Listado general de programas sociales', CURRENT_USER.rol==='admin' ? 'Todas las unidades presupuestales' : ('UP '+CURRENT_USER.unidad_codigo));
    renderProgramas();
  } else if(view.name==='detalle'){
    document.getElementById('view-detalle').classList.add('active');
    const p = state.programs.find(x=>x.id===view.id);
    setHeader(p ? p.nombre : 'Programa', 'Ficha de Registro y Seguimiento Presupuestal', p? ('UP '+p.unidad_codigo+' · '+p.unidad_nombre) : '');
    renderDetalle(view.id);
  }
  window.scrollTo({top:0,behavior:'smooth'});
}
function setHeader(t,s,s2){
  document.getElementById('headerTitle').textContent = t;
  document.getElementById('headerSub').textContent = s;
  document.getElementById('headerSub2').textContent = s2;
}
document.getElementById('navLinks').addEventListener('click', (e)=>{
  const link = e.target.closest('[data-nav]');
  if(link){ e.preventDefault(); navigate({name: link.dataset.nav}); }
});

/* =========================================================================
   VIEW: INICIO (DASHBOARD)
   ========================================================================= */
function renderInicio(){
  const el = document.getElementById('view-inicio');
  const totA = state.programs.reduce((s,p)=>s+totalAutorizadoNeto(p),0);
  const totMod = state.programs.reduce((s,p)=>s+totalModificado(p),0);
  const totComp = state.programs.reduce((s,p)=>s+totalComprometido(p),0);
  const totHac = state.programs.reduce((s,p)=>s+totalSolicitadoHacienda(p),0);
  const totPag = state.programs.reduce((s,p)=>s+totalPagado(p),0);

  el.innerHTML = `
    <div class="kpi-grid">
      ${kpiTile('Recurso Autorizado', fmtMoney(totA), state.programs.length+' programas', COLOR_AUTORIZADO)}
      ${kpiTile('Recurso Modificado', fmtMoney(totMod), 'Ampliaciones / reducciones', COLOR_MODIFICADO)}
      ${kpiTile('Recurso Comprometido', fmtMoney(totComp), 'Vía dictaminación', COLOR_COMPROMETIDO)}
      ${kpiTile('Solicitado a Hacienda', fmtMoney(totHac), 'Trámites enviados', COLOR_HACIENDA)}
      ${kpiTile('Recurso Pagado', fmtMoney(totPag), 'Ministrado a beneficiarios', COLOR_PAGADO)}
    </div>

    <div class="section-title"><h2>Comparativo por Programa</h2><span class="hint">Autorizado · Comprometido · Pagado</span></div>
    <div class="chart-card">
      <div class="chart-head">
        <h3>Recurso Autorizado vs. Comprometido vs. Pagado</h3>
        <button class="table-toggle" id="toggleTableDash">Ver tabla de datos</button>
      </div>
      <div style="height:320px;"><canvas id="chartDashboard"></canvas></div>
      <table class="data-table" id="tableDash">
        <thead><tr><th>Programa</th><th>Autorizado</th><th>Comprometido</th><th>Pagado</th></tr></thead>
        <tbody>
          ${state.programs.map(p=>`<tr><td>${p.nombre}</td><td>${fmtMoney(totalAutorizadoNeto(p))}</td><td>${fmtMoney(totalComprometido(p))}</td><td>${fmtMoney(totalPagado(p))}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title"><h2>Programas</h2><span class="hint">${state.programs.length} registrados</span></div>
    <div class="programs-grid">
      ${state.programs.map(programTileHTML).join('') || emptyPrograms()}
    </div>
  `;

  document.getElementById('toggleTableDash').addEventListener('click', ()=>document.getElementById('tableDash').classList.toggle('show'));
  bindProgramTileClicks(el);
  buildComparativeChart('chartDashboard', state.programs);
}

function kpiTile(label,value,sub,color){
  return `<div class="kpi-card" style="--accent:${color}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}
function emptyPrograms(){
  return `<div class="empty-state" style="grid-column:1/-1;">Aún no hay programas registrados. Usa “+ Nuevo Programa” para comenzar.</div>`;
}
function programTileHTML(p){
  const st = estadoPrograma(p);
  const disponible = totalAutorizadoNeto(p);
  const comp = totalComprometido(p);
  const pag = totalPagado(p);
  const pct = comp>0 ? Math.min(100, Math.round((pag/comp)*100)) : 0;
  return `
  <div class="prog-tile" data-open="${p.id}" style="--accent:${st.color}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div class="pid">${p.clave}</div>
      <span class="status-badge" style="background:${st.color}22;color:${st.color}">${st.label}</span>
    </div>
    <div class="pname">${p.nombre}</div>
    <div class="punidad">UP ${p.unidad_codigo} · ${p.unidad_nombre}</div>
    <div class="metrics">
      <div><span>Autorizado</span><b>${fmtMoneyCompact(disponible)}</b></div>
      <div><span>Comprometido</span><b>${fmtMoneyCompact(comp)}</b></div>
      <div><span>Pagado</span><b>${fmtMoneyCompact(pag)}</b></div>
    </div>
    <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="kpi-sub" style="margin-top:6px;">${pct}% pagado del monto comprometido</div>
  </div>`;
}
function bindProgramTileClicks(root){
  root.querySelectorAll('[data-open]').forEach(t=>{
    t.addEventListener('click', ()=> navigate({name:'detalle', id:Number(t.dataset.open)}));
  });
}

/* =========================================================================
   VIEW: PROGRAMAS (listado)
   ========================================================================= */
function renderProgramas(){
  const el = document.getElementById('view-programas');
  el.innerHTML = `
    <div class="section-title"><h2>Todos los Programas</h2><span class="hint">${state.programs.length} registrados</span></div>
    <div class="programs-grid">
      ${state.programs.map(programTileHTML).join('') || emptyPrograms()}
    </div>
  `;
  bindProgramTileClicks(el);
}

/* =========================================================================
   VIEW: DETALLE DE PROGRAMA
   ========================================================================= */
async function renderDetalle(id){
  const el = document.getElementById('view-detalle');
  const p = state.programs.find(x=>x.id===id);
  if(!p){ el.innerHTML = `<div class="empty-state">Programa no encontrado.</div>`; return; }

  const st = estadoPrograma(p);
  const autorizadoBase = montoAutorizadoBase(p);
  const modificado = totalModificado(p);
  const autorizadoNeto = totalAutorizadoNeto(p);
  const comprometido = totalComprometido(p);
  const disponible = totalDisponible(p);
  const solicitadoHacienda = totalSolicitadoHacienda(p);
  const pagado = totalPagado(p);
  const personas = totalPersonasDictaminadas(p);

  el.innerHTML = `
    <button class="back-link" id="backToList">← Volver a Programas</button>

    <div class="card accent" style="--accent:${st.color}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="chip">${p.clave}</div>
          <h2 style="margin:8px 0 4px;font-size:19px;color:var(--maroon-800);">${p.nombre}</h2>
          <div class="kpi-sub">UP ${p.unidad_codigo} · ${p.unidad_nombre} · Creado el ${fmtDate(p.created_at)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;">
          <span class="status-badge" style="background:${st.color}22;color:${st.color};font-size:12px;padding:7px 16px;">${st.label}</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" id="btnEditarPrograma">✎ Editar</button>
            <button class="btn btn-danger btn-sm" id="btnEliminarPrograma">🗑 Eliminar</button>
          </div>
        </div>
      </div>
      <hr class="divider">
      <div class="info-grid">
        <div class="info-item"><div class="label">Monto por beneficiario</div><div class="value">${fmtMoney(p.monto_beneficiario)}</div></div>
        <div class="info-item"><div class="label">Meta de beneficiarios</div><div class="value">${fmtNum(p.meta_beneficiarios)}</div></div>
        <div class="info-item"><div class="label">Personas dictaminadas</div><div class="value">${fmtNum(personas)} <span class="kpi-sub">(${p.meta_beneficiarios? Math.round(personas/p.meta_beneficiarios*100):0}% de la meta)</span></div></div>
        <div class="info-item"><div class="label">Recurso disponible</div><div class="value" style="color:${disponible<0?'var(--red)':'var(--text-dark)'}">${fmtMoney(disponible)}</div></div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiTile('Recurso Autorizado', fmtMoney(autorizadoNeto), autorizadoBase? 'Base '+fmtMoney(autorizadoBase):'Sin monto cargado', COLOR_AUTORIZADO)}
      ${kpiTile('Recurso Modificado', fmtMoney(modificado), (p.modificaciones||[]).length+' movimiento(s)', COLOR_MODIFICADO)}
      ${kpiTile('Recurso Comprometido', fmtMoney(comprometido), fmtNum(personas)+' personas', COLOR_COMPROMETIDO)}
      ${kpiTile('Solicitado a Hacienda', fmtMoney(solicitadoHacienda), (p.solicitudesHacienda||[]).length+' trámite(s)', COLOR_HACIENDA)}
      ${kpiTile('Recurso Pagado', fmtMoney(pagado), (p.pagos||[]).length+' pago(s)', COLOR_PAGADO)}
    </div>

    <div class="chart-card">
      <div class="chart-head">
        <h3>Comparativo del Programa</h3>
        <button class="table-toggle" id="toggleTableProg">Ver tabla de datos</button>
      </div>
      <div style="height:260px;"><canvas id="chartPrograma"></canvas></div>
      <table class="data-table" id="tableProg">
        <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          <tr><td>Recurso Autorizado</td><td>${fmtMoney(autorizadoNeto)}</td></tr>
          <tr><td>Recurso Comprometido</td><td>${fmtMoney(comprometido)}</td></tr>
          <tr><td>Recurso Pagado</td><td>${fmtMoney(pagado)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section-title"><h2>Monto Autorizado y Modificaciones</h2></div>
    <div class="card">
      ${p.monto_autorizado!==null ? `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <div class="kpi-label">Monto Autorizado inicial</div>
            <div class="kpi-value">${fmtMoney(autorizadoBase)}</div>
            <div class="kpi-sub">Referencia ${p.monto_autorizado_referencia} · ${fmtDate(p.monto_autorizado_fecha)}</div>
          </div>
          <button class="btn btn-outline btn-sm" id="btnAddModificacion">+ Registrar Modificación</button>
        </div>
        <hr class="divider">
        <div class="log-list">
          ${(p.modificaciones||[]).length ? p.modificaciones.map(m=>`
            <div class="log-row">
              <div>
                <div style="font-weight:700;">${m.tipo}</div>
                <div class="lmeta">${m.motivo||''} · ${fmtDate(m.created_at)}</div>
              </div>
              <div class="lamount ${m.tipo==='Ampliación'?'pos':'neg'}">${m.tipo==='Ampliación'?'+':'−'} ${fmtMoney(m.monto)}</div>
            </div>`).join('') : `<div class="empty-state">Sin modificaciones registradas.</div>`}
        </div>
      ` : `
        <div class="empty-state" style="padding:10px 10px 16px;">Este programa aún no tiene Monto Autorizado cargado.</div>
        <div style="text-align:center;"><button class="btn btn-gold" id="btnCargarMonto">💰 Cargar Monto Autorizado</button></div>
      `}
    </div>

    <div class="section-title"><h2>Dictaminación</h2><span class="hint">${(p.dictamenes||[]).length} dictamen(es) · ${fmtNum(personas)} personas</span></div>
    <div class="card">
      ${(p.dictamenes||[]).map(d=>dictamenBlockHTML(p,d)).join('') || `<div class="empty-state">Sin dictámenes registrados.</div>`}
      <div style="text-align:center;margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="btnAddDictamen">+ Agregar Otro Dictamen</button>
      </div>
    </div>

    <div class="section-title"><h2>Recurso Solicitado a Hacienda</h2></div>
    <div class="card">
      <div class="log-list">
        ${(p.solicitudesHacienda||[]).length? p.solicitudesHacienda.map(h=>`
          <div class="log-row">
            <div><div style="font-weight:700;">Folio ${h.folio}</div><div class="lmeta">${fmtDate(h.fecha)}</div></div>
            <div class="lamount">${fmtMoney(h.monto)}</div>
          </div>`).join('') : `<div class="empty-state">Sin trámites enviados a Hacienda.</div>`}
      </div>
      <div style="text-align:center;margin-top:10px;">
        <button class="btn btn-outline btn-sm" id="btnAddHacienda">+ Registrar Solicitud a Hacienda</button>
      </div>
    </div>

    <div class="section-title"><h2>Recurso Pagado</h2></div>
    <div class="card">
      <div class="log-list">
        ${(p.pagos||[]).length? p.pagos.map(g=>`
          <div class="log-row">
            <div><div style="font-weight:700;">Folio ${g.folio}</div><div class="lmeta">${fmtDate(g.fecha)}</div></div>
            <div class="lamount pos">${fmtMoney(g.monto)}</div>
          </div>`).join('') : `<div class="empty-state">Sin pagos registrados.</div>`}
      </div>
      <div style="text-align:center;margin-top:10px;">
        <button class="btn btn-outline btn-sm" id="btnAddPago">+ Registrar Pago</button>
      </div>
    </div>
  `;

  document.getElementById('backToList').addEventListener('click', ()=>navigate({name:'programas'}));
  document.getElementById('toggleTableProg').addEventListener('click', ()=>document.getElementById('tableProg').classList.toggle('show'));
  document.getElementById('btnEditarPrograma').addEventListener('click', ()=>openModalEditarPrograma(p));
  document.getElementById('btnEliminarPrograma').addEventListener('click', ()=>openModalEliminarPrograma(p));
  const btnCargar = document.getElementById('btnCargarMonto');
  if(btnCargar) btnCargar.addEventListener('click', ()=>openModalCargarMonto(p.id));
  const btnMod = document.getElementById('btnAddModificacion');
  if(btnMod) btnMod.addEventListener('click', ()=>openModalModificacion(p.id));
  document.getElementById('btnAddDictamen').addEventListener('click', ()=>addDictamen(p.id));
  document.getElementById('btnAddHacienda').addEventListener('click', ()=>openModalHacienda(p.id));
  document.getElementById('btnAddPago').addEventListener('click', ()=>openModalPago(p.id));

  el.querySelectorAll('[data-add-solicitud]').forEach(b=>b.addEventListener('click', ()=>addSolicitud(p.id,b.dataset.addSolicitud)));
  el.querySelectorAll('[data-del-solicitud]').forEach(b=>b.addEventListener('click', ()=>delSolicitud(p.id,b.dataset.dic,b.dataset.delSolicitud)));
  el.querySelectorAll('[data-dic-monto]').forEach(inp=>inp.addEventListener('change', (e)=>updateDictamenMonto(p.id, inp.dataset.dicMonto, e.target.value)));
  el.querySelectorAll('[data-sol-personas]').forEach(inp=>inp.addEventListener('change', (e)=>{
    const [dicId, solId] = inp.dataset.solPersonas.split('|');
    updateSolicitudPersonas(p.id, dicId, solId, e.target.value);
  }));

  buildComparativeChart('chartPrograma', [p], true);
}

function dictamenBlockHTML(p,d){
  const personas = (d.solicitudes||[]).reduce((s,so)=>s+Number(so.personas||0),0);
  const comprometido = personas * Number(p.monto_beneficiario);
  return `
  <div class="dictamen-block">
    <div class="dictamen-head">
      <h4>Dictamen ${d.numero}</h4>
      <div class="chip">${fmtMoney(d.monto_autorizado)} autorizados</div>
    </div>
    <div class="field" style="max-width:260px;margin-bottom:12px;">
      <label>Monto Autorizado del Dictamen</label>
      <input type="number" min="0" step="0.01" value="${d.monto_autorizado}" data-dic-monto="${d.id}">
    </div>
    ${(d.solicitudes||[]).map(s=>`
      <div class="solicitud-row">
        <div class="sfield"><label>Solicitud No.</label><input value="${s.numero}" disabled></div>
        <div class="sfield"><label>Cantidad de Personas</label><input type="number" min="0" value="${s.personas}" data-sol-personas="${d.id}|${s.id}"></div>
        <button class="icon-btn" title="Eliminar solicitud" data-dic="${d.id}" data-del-solicitud="${s.id}">✕</button>
      </div>
    `).join('')}
    <div style="text-align:right;margin-top:6px;">
      <button class="btn btn-ghost btn-sm" data-add-solicitud="${d.id}">+ Agregar otra solicitud</button>
    </div>
    <div class="dictamen-total">
      <div>Personas: <b>${fmtNum(personas)}</b></div>
      <div>Recurso comprometido: <b>${fmtMoney(comprometido)}</b></div>
    </div>
  </div>`;
}

/* ---------- Mutaciones vía API ---------- */
async function addDictamen(pid){
  await safeCall(()=>Api.post(`/programs/${pid}/dictamenes`, {monto_autorizado:0}), 'Dictamen agregado.');
  await refreshOneProgram(pid); renderDetalle(pid);
}
async function updateDictamenMonto(pid, dicId, value){
  await safeCall(()=>Api.patch(`/programs/${pid}/dictamenes/${dicId}`, {monto_autorizado:Number(value||0)}));
  await refreshOneProgram(pid); renderDetalle(pid);
}
async function addSolicitud(pid, dicId){
  await safeCall(()=>Api.post(`/programs/${pid}/dictamenes/${dicId}/solicitudes`, {personas:0}), 'Solicitud agregada.');
  await refreshOneProgram(pid); renderDetalle(pid);
}
async function updateSolicitudPersonas(pid, dicId, solId, value){
  await safeCall(()=>Api.patch(`/programs/${pid}/dictamenes/${dicId}/solicitudes/${solId}`, {personas:Number(value||0)}));
  await refreshOneProgram(pid); renderDetalle(pid);
}
async function delSolicitud(pid, dicId, solId){
  await safeCall(()=>Api.del(`/programs/${pid}/dictamenes/${dicId}/solicitudes/${solId}`), 'Solicitud eliminada.');
  await refreshOneProgram(pid); renderDetalle(pid);
}

/* =========================================================================
   CHARTS
   ========================================================================= */
const valueLabelPlugin = {
  id:'valueLabels',
  afterDatasetsDraw(chart){
    const {ctx} = chart;
    chart.data.datasets.forEach((dataset, dsIndex)=>{
      const meta = chart.getDatasetMeta(dsIndex);
      if(meta.hidden) return;
      meta.data.forEach((element, index)=>{
        const value = dataset.data[index];
        if(value===null || value===undefined) return;
        ctx.save();
        ctx.fillStyle = '#2B2320';
        ctx.font = '700 10.5px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const pos = element.tooltipPosition ? element.tooltipPosition() : element.getCenterPoint();
        ctx.fillText(fmtMoneyCompact(value), pos.x, pos.y - 5);
        ctx.restore();
      });
    });
  }
};
Chart.register(valueLabelPlugin);

function buildComparativeChart(canvasId, programs){
  const ctx = document.getElementById(canvasId);
  if(!ctx) return;
  if(chartRegistry[canvasId]){ chartRegistry[canvasId].destroy(); }

  const labels = programs.map(p=> p.nombre.length>26 ? p.nombre.slice(0,24)+'…' : p.nombre);
  const dataAut = programs.map(p=>totalAutorizadoNeto(p));
  const dataComp = programs.map(p=>totalComprometido(p));
  const dataPag = programs.map(p=>totalPagado(p));

  chartRegistry[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[
      {label:'Autorizado', data:dataAut, backgroundColor:COLOR_AUTORIZADO, borderRadius:4, maxBarThickness:44},
      {label:'Comprometido', data:dataComp, backgroundColor:COLOR_COMPROMETIDO, borderRadius:4, maxBarThickness:44},
      {label:'Pagado', data:dataPag, backgroundColor:COLOR_PAGADO, borderRadius:4, maxBarThickness:44},
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, layout:{padding:{top:20}},
      plugins:{
        legend:{position:'top', labels:{usePointStyle:true, boxWidth:8, font:{size:11.5, weight:'600'}, color:'#2B2320'}},
        tooltip:{ backgroundColor:'#3E0E20', padding:10, cornerRadius:8, titleFont:{weight:'700'}, callbacks:{ label:(c)=> c.dataset.label+': '+fmtMoney(c.raw) } }
      },
      scales:{
        x:{ grid:{display:false}, ticks:{color:'#736A5E', font:{size:11}} },
        y:{ beginAtZero:true, grid:{color:'#F0E6CE'}, ticks:{color:'#736A5E', font:{size:11}, callback:(v)=>fmtMoneyCompact(v)} }
      }
    }
  });
}

/* =========================================================================
   MODALS
   ========================================================================= */
const overlay = document.getElementById('modalOverlay');
const modalBox = document.getElementById('modalBox');
function openModal(html){ modalBox.innerHTML = html; overlay.classList.add('show'); }
function closeModal(){ overlay.classList.remove('show'); modalBox.innerHTML=''; }
overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeModal(); });

/* ---- Nuevo Programa ---- */
document.getElementById('btnNuevoPrograma').addEventListener('click', openModalNuevoPrograma);
function openModalNuevoPrograma(){
  openModal(`
    <div class="modal-header"><h3>Registrar Nuevo Programa</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field">
          <label>Unidad Presupuestal</label>
          <select id="f-unidad">
            <option value="">Selecciona una unidad presupuestal…</option>
            ${UNIDADES.map(u=>`<option value="${u.codigo}">${u.codigo} — ${u.nombre}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Nombre del Proyecto</label><input type="text" id="f-nombre" placeholder="Ej. Programa de Apoyo a..."></div>
      </div>
      <div class="form-grid" style="margin-top:16px;">
        <div class="field"><label>Cantidad por Beneficiario</label><input type="number" id="f-montoBenef" min="0" step="0.01" placeholder="$0.00"></div>
        <div class="field"><label>Meta de Beneficiarios</label><input type="number" id="f-meta" min="0" step="1" placeholder="0"></div>
      </div>
      <div id="f-error" style="color:var(--red);font-size:12.5px;font-weight:700;margin-top:12px;display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitNuevoPrograma">Crear Registro</button>
    </div>
  `);
  document.getElementById('submitNuevoPrograma').addEventListener('click', submitNuevoPrograma);
}
async function submitNuevoPrograma(){
  const codigo = document.getElementById('f-unidad').value;
  const nombre = document.getElementById('f-nombre').value.trim();
  const montoBenef = Number(document.getElementById('f-montoBenef').value);
  const meta = Number(document.getElementById('f-meta').value);
  const err = document.getElementById('f-error');

  if(!codigo || !nombre || !montoBenef || !meta){
    err.textContent = 'Completa todos los campos para continuar.';
    err.style.display = 'block';
    return;
  }
  try{
    const programa = await Api.post('/programs', { unidad_codigo:codigo, nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta });
    closeModal();
    toast('Programa creado correctamente.');
    await refreshPrograms();
    navigate({name:'detalle', id:programa.id});
  }catch(e){
    err.textContent = e.message || 'No se pudo crear el programa.';
    err.style.display = 'block';
  }
}

/* ---- Editar Programa ---- */
function openModalEditarPrograma(p){
  openModal(`
    <div class="modal-header"><h3>Editar Programa</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Nombre del Proyecto</label><input type="text" id="e-nombre" value="${p.nombre.replace(/"/g,'&quot;')}"></div>
      </div>
      <div class="form-grid" style="margin-top:16px;">
        <div class="field"><label>Cantidad por Beneficiario</label><input type="number" id="e-montoBenef" min="0" step="0.01" value="${p.monto_beneficiario}"></div>
        <div class="field"><label>Meta de Beneficiarios</label><input type="number" id="e-meta" min="0" step="1" value="${p.meta_beneficiarios}"></div>
      </div>
      <div class="field-hint" style="margin-top:12px;">La Unidad Presupuestal y la clave (${p.clave}) no se pueden cambiar una vez creado el programa.</div>
      <div id="e-error" style="color:var(--red);font-size:12.5px;font-weight:700;margin-top:12px;display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitEditarPrograma">Guardar Cambios</button>
    </div>
  `);
  document.getElementById('submitEditarPrograma').addEventListener('click', async ()=>{
    const nombre = document.getElementById('e-nombre').value.trim();
    const montoBenef = Number(document.getElementById('e-montoBenef').value);
    const meta = Number(document.getElementById('e-meta').value);
    const err = document.getElementById('e-error');

    if(!nombre || !montoBenef || !meta){
      err.textContent = 'Completa todos los campos para continuar.';
      err.style.display = 'block';
      return;
    }
    try{
      await Api.patch(`/programs/${p.id}`, { nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta });
      closeModal();
      toast('Programa actualizado correctamente.');
      await refreshOneProgram(p.id);
      renderDetalle(p.id);
    }catch(e){
      err.textContent = e.message || 'No se pudo actualizar el programa.';
      err.style.display = 'block';
    }
  });
}

/* ---- Eliminar Programa ---- */
function openModalEliminarPrograma(p){
  openModal(`
    <div class="modal-header"><h3>Eliminar Programa</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <p style="font-size:13.5px;line-height:1.6;margin:0 0 10px;">
        Estás a punto de eliminar permanentemente el programa <b>${p.nombre}</b> (${p.clave}).
      </p>
      <p style="font-size:13.5px;line-height:1.6;color:var(--red);font-weight:700;margin:0;">
        Esto borra también todos sus movimientos: monto autorizado, modificaciones, dictámenes, solicitudes, trámites a Hacienda y pagos. Esta acción no se puede deshacer.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="submitEliminarPrograma">Sí, Eliminar Definitivamente</button>
    </div>
  `);
  document.getElementById('submitEliminarPrograma').addEventListener('click', async ()=>{
    try{
      await Api.del(`/programs/${p.id}`);
      closeModal();
      toast('Programa eliminado.');
      state.programs = state.programs.filter(x=>x.id!==p.id);
      navigate({name:'programas'});
    }catch(e){
      toast(e.message || 'No se pudo eliminar el programa.', true);
    }
  });
}

/* ---- Cargar Monto Autorizado ---- */
function openModalCargarMonto(pid){
  openModal(`
    <div class="modal-header"><h3>Cargar Monto Autorizado</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Monto Autorizado</label><input type="number" id="m-monto" min="0" step="0.01" placeholder="$0.00"></div>
        <div class="field"><label>Referencia / Oficio</label><input type="text" id="m-ref" placeholder="Ej. OF-DGPPE-0001-2026"></div>
        <div class="field-hint">Este monto será la base de referencia para las gráficas y cálculos del programa.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" id="submitMonto">Guardar Monto</button>
    </div>
  `);
  document.getElementById('submitMonto').addEventListener('click', async ()=>{
    const monto = Number(document.getElementById('m-monto').value);
    const referencia = document.getElementById('m-ref').value.trim() || 'S/R';
    if(!monto) return;
    await safeCall(()=>Api.post(`/programs/${pid}/monto-autorizado`, {monto, referencia}), 'Monto autorizado cargado.');
    closeModal();
    await refreshOneProgram(pid); renderDetalle(pid);
  });
}

/* ---- Registrar Modificación ---- */
function openModalModificacion(pid){
  openModal(`
    <div class="modal-header"><h3>Registrar Modificación</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Tipo de Movimiento</label>
          <select id="mo-tipo"><option value="Ampliación">Ampliación (+)</option><option value="Reducción">Reducción (−)</option></select>
        </div>
        <div class="field"><label>Monto</label><input type="number" id="mo-monto" min="0" step="0.01" placeholder="$0.00"></div>
        <div class="field"><label>Motivo</label><textarea id="mo-motivo" rows="3" placeholder="Describe el motivo de la modificación…"></textarea></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitMod">Registrar</button>
    </div>
  `);
  document.getElementById('submitMod').addEventListener('click', async ()=>{
    const tipo = document.getElementById('mo-tipo').value;
    const monto = Number(document.getElementById('mo-monto').value);
    const motivo = document.getElementById('mo-motivo').value.trim();
    if(!monto) return;
    await safeCall(()=>Api.post(`/programs/${pid}/modificaciones`, {tipo, monto, motivo}), 'Modificación registrada.');
    closeModal();
    await refreshOneProgram(pid); renderDetalle(pid);
  });
}

/* ---- Solicitud a Hacienda ---- */
function openModalHacienda(pid){
  openModal(`
    <div class="modal-header"><h3>Registrar Solicitud a Hacienda</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Folio</label><input type="text" id="h-folio" placeholder="Ej. SH-2026-0001"></div>
        <div class="field"><label>Monto Solicitado</label><input type="number" id="h-monto" min="0" step="0.01" placeholder="$0.00"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitHac">Registrar</button>
    </div>
  `);
  document.getElementById('submitHac').addEventListener('click', async ()=>{
    const folio = document.getElementById('h-folio').value.trim();
    const monto = Number(document.getElementById('h-monto').value);
    if(!monto) return;
    await safeCall(()=>Api.post(`/programs/${pid}/hacienda`, {folio, monto}), 'Solicitud a Hacienda registrada.');
    closeModal();
    await refreshOneProgram(pid); renderDetalle(pid);
  });
}

/* ---- Pago ---- */
function openModalPago(pid){
  openModal(`
    <div class="modal-header"><h3>Registrar Pago</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Folio</label><input type="text" id="g-folio" placeholder="Ej. PG-2026-0001"></div>
        <div class="field"><label>Monto Pagado</label><input type="number" id="g-monto" min="0" step="0.01" placeholder="$0.00"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitPago">Registrar</button>
    </div>
  `);
  document.getElementById('submitPago').addEventListener('click', async ()=>{
    const folio = document.getElementById('g-folio').value.trim();
    const monto = Number(document.getElementById('g-monto').value);
    if(!monto) return;
    await safeCall(()=>Api.post(`/programs/${pid}/pagos`, {folio, monto}), 'Pago registrado.');
    closeModal();
    await refreshOneProgram(pid); renderDetalle(pid);
  });
}

/* ---------- START ---------- */
init();