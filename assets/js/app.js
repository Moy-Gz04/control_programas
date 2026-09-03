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
const COLOR_AUTORIZADO   = '#8C3358';
const COLOR_COMPROMETIDO = '#C9862B';
const COLOR_PAGADO       = '#159C6C';
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

/* ---------- ESTADO DE CARGA EN BOTONES ----------
   Deshabilita el botón, muestra un spinner + texto de carga mientras la
   operación async está en curso, y lo regresa a su estado normal al
   terminar (haya salido bien o mal). Úsese en cualquier botón que dispare
   una llamada a la API, para que quede claro que algo está pasando y evitar
   doble-click accidental. */
async function withLoading(btn, fn, loadingText){
  if(!btn) return fn();
  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span>${loadingText || 'Procesando…'}`;
  try{
    return await fn();
  } finally {
    btn.disabled = wasDisabled;
    btn.innerHTML = original;
  }
}

/* ---------- CONFIRMACIÓN DE ACCIONES DESTRUCTIVAS ----------
   Modal de confirmación reutilizable (más consistente que window.confirm,
   que se ve feo y no combina con el diseño). Devuelve una Promise<boolean>. */
function confirmAction({ title = '¿Estás seguro?', message = 'Esta acción no se puede deshacer.', confirmText = 'Sí, continuar', danger = true } = {}){
  return new Promise((resolve)=>{
    openModal(`
      <div class="modal-header"><h3>${title}</h3><button class="modal-close" id="confirmClose">✕</button></div>
      <div class="modal-body"><p style="margin:0;">${message}</p></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="confirmCancel">Cancelar</button>
        <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirmOk">${confirmText}</button>
      </div>
    `);
    const finish = (result)=>{
      closeModal();
      resolve(result);
    };
    document.getElementById('confirmClose').addEventListener('click', ()=>finish(false));
    document.getElementById('confirmCancel').addEventListener('click', ()=>finish(false));
    document.getElementById('confirmOk').addEventListener('click', ()=>finish(true));
  });
}

/* ---------- COMPUTED HELPERS (sobre datos numéricos del API) ----------
   Estas funciones aceptan dos formas del mismo programa:
   1) El detalle completo (GET /programs/:id) con arreglos anidados
      (modificaciones, dictamenes.solicitudes, solicitudesHacienda, pagos).
   2) La fila resumida del listado (GET /programs), que YA trae los totales
      pre-calculados en SQL (modificado_total, personas_total, etc.) para
      que las tarjetas y el dashboard muestren cifras correctas de inmediato,
      sin depender de que el programa se haya abierto antes.
   Si el arreglo anidado existe se usa (dato más fresco/editable); si no,
   se cae al total agregado que manda el listado. ---------- */
function montoAutorizadoBase(p){ return Number(p.monto_autorizado || 0); }
function totalModificado(p){
  if(p.modificaciones) return p.modificaciones.reduce((s,m)=> s + (m.tipo==='Ampliación'? Number(m.monto) : -Number(m.monto)), 0);
  return Number(p.modificado_total || 0);
}
function totalAutorizadoNeto(p){ return montoAutorizadoBase(p) + totalModificado(p); }
function totalPersonasDictaminadas(p){
  if(p.dictamenes) return p.dictamenes.reduce((s,d)=> s + (d.solicitudes||[]).reduce((s2,so)=> s2+Number(so.personas||0),0), 0);
  return Number(p.personas_total || 0);
}
function totalComprometido(p){
  if(p.dictamenes) return totalPersonasDictaminadas(p) * Number(p.monto_beneficiario);
  return Number(p.comprometido_total || 0);
}
function totalSolicitadoHacienda(p){
  if(p.solicitudesHacienda) return p.solicitudesHacienda.reduce((s,h)=>s+Number(h.monto),0);
  return Number(p.hacienda_total || 0);
}
function totalPagado(p){
  if(p.pagos) return p.pagos.reduce((s,g)=>s+Number(g.monto),0);
  return Number(p.pagado_total || 0);
}
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

  document.getElementById('view-inicio').innerHTML = `<div class="loading-block"><span class="loading-spinner"></span> Cargando información…</div>`;

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
    <div class="chart-flex">
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
      <div class="insight-card">
        <div class="insight-head">Situación Actual</div>
        ${generateInsightGeneral(state.programs)}
      </div>
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
  el.innerHTML = `<div class="loading-block"><span class="loading-spinner"></span> Cargando programa…</div>`;

  // La lista general (GET /programs) no trae dictámenes, modificaciones, etc.
  // Siempre se pide el detalle completo antes de dibujar, para que los datos
  // (personas dictaminadas, montos, movimientos) nunca se vean incompletos.
  let p;
  try{
    p = await refreshOneProgram(id);
  }catch(err){
    el.innerHTML = `<div class="empty-state">${err.message || 'No se pudo cargar el programa.'}</div>`;
    return;
  }
  if(!p){ el.innerHTML = `<div class="empty-state">Programa no encontrado.</div>`; return; }
  // Puede haber cambiado de vista mientras cargaba (por ejemplo, el usuario
  // navegó a otra pantalla); si ya no estamos en el detalle de este id, no dibujar.
  if(state.view.name!=='detalle' || state.view.id!==id) return;

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
            <button class="btn btn-ghost btn-sm" id="btnEditarPrograma">Editar</button>
            <button class="btn btn-danger btn-sm" id="btnEliminarPrograma">Eliminar</button>
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

    <div class="chart-flex">
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
            <tr><td>Solicitado a Hacienda</td><td>${fmtMoney(solicitadoHacienda)}</td></tr>
            <tr><td>Recurso Pagado</td><td>${fmtMoney(pagado)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="insight-card">
        <div class="insight-head">Situación Actual</div>
        ${generateInsightPrograma(p)}
      </div>
    </div>

    <div class="section-title"><h2>Monto Autorizado y Modificaciones</h2></div>
    <div class="card">
      ${p.monto_autorizado!==null ? `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <div class="kpi-label">Monto Autorizado inicial</div>
            <div class="kpi-value">${fmtMoney(autorizadoBase)}</div>
            <div class="kpi-sub">Referencia ${p.monto_autorizado_referencia} · ${fmtDate(p.monto_autorizado_fecha)}
              ${p.monto_autorizado_documento_url ? ` · <a href="${p.monto_autorizado_documento_url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="padding:2px 10px;">Ver Documento</a>` : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" id="btnAddModificacion">+ Registrar Modificación</button>
        </div>
        <hr class="divider">
        <div class="log-list">
          ${(p.modificaciones||[]).length ? p.modificaciones.map(m=>`
            <div class="log-row">
              <div>
                <div style="font-weight:700;">${m.tipo}</div>
                <div class="lmeta">${m.motivo||''} · ${fmtDate(m.created_at)}
                  ${m.documento_url ? ` · <a href="${m.documento_url}" target="_blank" rel="noopener">Ver Documento</a>` : ''}
                </div>
              </div>
              <div class="lamount ${m.tipo==='Ampliación'?'pos':'neg'}">${m.tipo==='Ampliación'?'+':'−'} ${fmtMoney(m.monto)}</div>
            </div>`).join('') : `<div class="empty-state">Sin modificaciones registradas.</div>`}
        </div>
      ` : `
        <div class="empty-state" style="padding:10px 10px 16px;">Este programa aún no tiene Monto Autorizado cargado.</div>
        <div style="text-align:center;"><button class="btn btn-gold" id="btnCargarMonto">Cargar Monto Autorizado</button></div>
      `}
    </div>

    <div class="section-title"><h2>Dictaminación</h2><span class="hint">${(p.dictamenes||[]).length} dictamen(es) · ${fmtNum(personas)} personas</span></div>
    <div class="card" id="dictamenesCard">
      ${(p.dictamenes||[]).map(d=>dictamenBlockHTML(p,d)).join('') || `<div class="empty-state">Sin dictámenes registrados.</div>`}
      <div style="text-align:center;margin-top:8px;" id="dictamenAddWrap">
        <button class="btn btn-primary btn-sm" id="btnAddDictamen">+ Agregar Otro Dictamen</button>
      </div>
    </div>

    <div class="section-title"><h2>Recurso Solicitado a Hacienda</h2></div>
    <div class="card">
      <div class="log-list">
        ${(p.solicitudesHacienda||[]).length? p.solicitudesHacienda.map(h=>`
          <div class="log-row">
            <div><div style="font-weight:700;">Folio ${h.folio}</div><div class="lmeta">${fmtDate(h.fecha)}
              ${h.documento_url ? ` · <a href="${h.documento_url}" target="_blank" rel="noopener">Ver Documento</a>` : ''}
            </div></div>
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
            <div><div style="font-weight:700;">Folio ${g.folio}</div><div class="lmeta">${fmtDate(g.fecha)}
              ${g.documento_url ? ` · <a href="${g.documento_url}" target="_blank" rel="noopener">Ver Documento</a>` : ''}
            </div></div>
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
  document.getElementById('btnAddDictamen').addEventListener('click', ()=> addDictamenLocal(p));
  document.getElementById('btnAddHacienda').addEventListener('click', ()=>openModalHacienda(p.id));
  document.getElementById('btnAddPago').addEventListener('click', ()=>openModalPago(p.id));

  // Nada de lo que pasa dentro de un dictamen (agregar el dictamen, llenar
  // el monto, agregar solicitudes, llenar personas) toca el servidor ni
  // vuelve a dibujar la pantalla. Todo se arma en el DOM y solo se envía a
  // la API —en un solo paso— al presionar "Guardar Dictamen" (ver
  // saveDictamen). Eliminar un dictamen/solicitud ya guardado sí llama a la
  // API (con confirmación), pero uno agregado localmente y aún no guardado
  // simplemente se quita del formulario.
  el.querySelectorAll('.dictamen-block').forEach(block=> bindDictamenBlock(block, p));

  buildComparativeChart('chartPrograma', [p], true);
}

/* ---------- Dictaminación: alta/edición local + guardado en un solo paso ----------
   Un dictamen o una solicitud recién agregados en el formulario (todavía no
   guardados en el servidor) se identifican con un id temporal "tmp-...".
   saveDictamen() decide, por cada uno, si debe crearlo (POST) o actualizarlo
   (PATCH) según tenga o no un id real. ---------- */
let __tmpSeq = 0;
function tmpId(){ return 'tmp-' + (++__tmpSeq) + '-' + Date.now(); }
function esTemporal(id){ return String(id).startsWith('tmp-'); }

function dictamenBlockHTML(p,d){
  const personas = (d.solicitudes||[]).reduce((s,so)=>s+Number(so.personas||0),0);
  const comprometido = personas * Number(p.monto_beneficiario);
  const titulo = d.numero!=null ? ('Dictamen '+d.numero) : 'Dictamen (nuevo, sin guardar)';
  return `
  <div class="dictamen-block" data-dictamen-block="${d.id}">
    <div class="dictamen-head">
      <h4>${titulo}</h4>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="chip">${fmtMoney(d.monto_autorizado)} autorizados</div>
        <button class="btn btn-danger btn-sm" data-del-dictamen="${d.id}">Eliminar Dictamen</button>
      </div>
    </div>
    <div class="field" style="max-width:260px;margin-bottom:12px;">
      <label>Monto Autorizado del Dictamen</label>
      <input type="number" min="0" step="0.01" value="${d.monto_autorizado}" data-dic-monto="${d.id}">
    </div>
    <div class="solicitudes-list">
      ${(d.solicitudes||[]).map(s=>solicitudRowHTML(d.id,s)).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px;" data-dictamen-actions>
      <div class="field-hint" style="margin:0;">Agrega las solicitudes que necesites y llena los campos; nada se guarda hasta presionar “Guardar Dictamen”.</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" data-add-solicitud>+ Agregar otra solicitud</button>
        <button class="btn btn-gold btn-sm" data-save-dictamen>Guardar Dictamen</button>
      </div>
    </div>
    <div class="dictamen-total">
      <div>Personas: <b>${fmtNum(personas)}</b></div>
      <div>Recurso comprometido: <b>${fmtMoney(comprometido)}</b></div>
    </div>
  </div>`;
}

function solicitudRowHTML(dicId, s){
  const esNueva = esTemporal(s.id);
  return `
      <div class="solicitud-row">
        <div class="sfield"><label>Solicitud No.</label><input value="${esNueva? 'Nueva' : s.numero}" disabled></div>
        <div class="sfield"><label>Cantidad de Personas</label><input type="number" min="0" value="${s.personas||0}" data-sol-personas="${dicId}|${s.id}"></div>
        <button class="icon-btn" title="Eliminar solicitud" data-del-solicitud="${s.id}">✕</button>
      </div>`;
}

/* Recalcula en vivo (sin llamar a la API) las cifras de "Personas" y
   "Recurso comprometido" que se muestran al pie del dictamen, conforme se
   agregan/quitan solicitudes o se edita la cantidad de personas. */
function recomputeDictamenTotals(block, montoBeneficiario){
  const personas = Array.from(block.querySelectorAll('[data-sol-personas]')).reduce((s,inp)=> s+Number(inp.value||0), 0);
  const comprometido = personas * Number(montoBeneficiario||0);
  const totalDiv = block.querySelector('.dictamen-total');
  if(totalDiv){
    totalDiv.innerHTML = `<div>Personas: <b>${fmtNum(personas)}</b></div><div>Recurso comprometido: <b>${fmtMoney(comprometido)}</b></div>`;
  }
}

function bindDictamenBlock(block, p){
  const pid = p.id;
  const dicId = block.dataset.dictamenBlock;

  block.querySelector('[data-del-dictamen]').addEventListener('click', (e)=> handleDeleteDictamen(pid, block, dicId, e.currentTarget));
  block.querySelector('[data-add-solicitud]').addEventListener('click', ()=> addSolicitudLocal(block, p));
  block.querySelector('[data-save-dictamen]').addEventListener('click', (e)=> saveDictamen(pid, dicId, block, e.currentTarget));
  block.querySelectorAll('.solicitud-row').forEach(row=> bindSolicitudRow(row, block, p));
}

function bindSolicitudRow(row, block, p){
  const delBtn = row.querySelector('[data-del-solicitud]');
  delBtn.addEventListener('click', (e)=> handleDeleteSolicitud(p, block, delBtn.dataset.delSolicitud, e.currentTarget));
  const inp = row.querySelector('[data-sol-personas]');
  inp.addEventListener('input', ()=> recomputeDictamenTotals(block, p.monto_beneficiario));
}

/* + Agregar Otro Dictamen: solo inserta un bloque vacío en el formulario.
   No se registra nada en el servidor hasta presionar "Guardar Dictamen". */
function addDictamenLocal(p){
  const card = document.getElementById('dictamenesCard');
  const emptyState = card.querySelector('.empty-state');
  if(emptyState) emptyState.remove();

  const draft = { id: tmpId(), numero: null, monto_autorizado: 0, solicitudes: [] };
  const wrap = document.createElement('div');
  wrap.innerHTML = dictamenBlockHTML(p, draft).trim();
  const block = wrap.firstElementChild;

  document.getElementById('dictamenAddWrap').insertAdjacentElement('beforebegin', block);
  bindDictamenBlock(block, p);
  block.scrollIntoView({behavior:'smooth', block:'center'});
}

/* + Agregar otra solicitud: inserta la fila dentro del mismo dictamen, sin
   tocar el servidor ni redibujar la pantalla. */
function addSolicitudLocal(block, p){
  const dicId = block.dataset.dictamenBlock;
  const draft = { id: tmpId(), numero: null, personas: 0 };
  const wrap = document.createElement('div');
  wrap.innerHTML = solicitudRowHTML(dicId, draft).trim();
  const row = wrap.firstElementChild;

  const actionsRow = block.querySelector('[data-dictamen-actions]');
  actionsRow.insertAdjacentElement('beforebegin', row);
  bindSolicitudRow(row, block, p);
  recomputeDictamenTotals(block, p.monto_beneficiario);
}

/* ---------- Mutaciones vía API ---------- */
/* Guarda el dictamen completo de una sola vez: crea (POST) lo que se haya
   agregado localmente —el dictamen mismo y/o sus solicitudes nuevas— y
   actualiza (PATCH) lo que ya existía, leyendo los valores actuales del
   formulario. Solo aquí se llama a la API y se refresca la pantalla. */
async function saveDictamen(pid, dicId, blockEl, btn){
  if(!blockEl) return;
  const montoInput = blockEl.querySelector('[data-dic-monto]');
  const montoValue = Number(montoInput ? montoInput.value : 0) || 0;
  const solRows = Array.from(blockEl.querySelectorAll('.solicitud-row'));

  await withLoading(btn, ()=>safeCall(async ()=>{
    let realDicId = dicId;
    if(esTemporal(dicId)){
      const creado = await Api.post(`/programs/${pid}/dictamenes`, {monto_autorizado: montoValue});
      realDicId = creado.id;
    } else {
      await Api.patch(`/programs/${pid}/dictamenes/${dicId}`, {monto_autorizado: montoValue});
    }

    for(const row of solRows){
      const inp = row.querySelector('[data-sol-personas]');
      if(!inp) continue;
      const [, solId] = inp.dataset.solPersonas.split('|');
      const personas = Number(inp.value||0);
      if(esTemporal(solId)){
        await Api.post(`/programs/${pid}/dictamenes/${realDicId}/solicitudes`, {personas});
      } else {
        await Api.patch(`/programs/${pid}/dictamenes/${realDicId}/solicitudes/${solId}`, {personas});
      }
    }
  }, 'Dictamen guardado correctamente.'), 'Guardando…');

  await refreshOneProgram(pid); renderDetalle(pid);
}

async function handleDeleteSolicitud(p, block, solId, btn){
  if(esTemporal(solId)){
    btn.closest('.solicitud-row').remove();
    recomputeDictamenTotals(block, p.monto_beneficiario);
    return;
  }
  const dicId = block.dataset.dictamenBlock;
  const ok = await confirmAction({
    title: 'Eliminar Solicitud',
    message: '¿Eliminar esta solicitud ya guardada? Esta acción no se puede deshacer.',
    confirmText: 'Sí, Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(`/programs/${p.id}/dictamenes/${dicId}/solicitudes/${solId}`), 'Solicitud eliminada.'), 'Eliminando…');
  await refreshOneProgram(p.id); renderDetalle(p.id);
}

async function handleDeleteDictamen(pid, block, dicId, btn){
  if(esTemporal(dicId)){
    block.remove();
    return;
  }
  const ok = await confirmAction({
    title: 'Eliminar Dictamen',
    message: '¿Eliminar este dictamen ya guardado y todas sus solicitudes? Esta acción no se puede deshacer.',
    confirmText: 'Sí, Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(`/programs/${pid}/dictamenes/${dicId}`), 'Dictamen eliminado.'), 'Eliminando…');
  await refreshOneProgram(pid); renderDetalle(pid);
}

/* =========================================================================
   ANÁLISIS DINÁMICO — texto que describe la situación actual de la gráfica.
   Se recalcula cada vez que se renderiza, a partir de los datos vigentes,
   siguiendo el flujo real del recurso: Autorizado → Comprometido →
   Solicitado a Hacienda → Pagado.
   ========================================================================= */
function generateInsightGeneral(programs){
  if(!programs.length){
    return `<p>Aún no hay programas registrados. En cuanto captures el primero, aquí aparecerá un resumen automático de su situación presupuestal.</p>`;
  }

  const totA = programs.reduce((s,p)=>s+totalAutorizadoNeto(p),0);
  const totComp = programs.reduce((s,p)=>s+totalComprometido(p),0);
  const totHac = programs.reduce((s,p)=>s+totalSolicitadoHacienda(p),0);
  const totPag = programs.reduce((s,p)=>s+totalPagado(p),0);
  const pctComprometido = totA>0 ? (totComp/totA*100) : 0;
  const pctSolicitado = totComp>0 ? (totHac/totComp*100) : 0;
  const pctPagadoDeSolicitado = totHac>0 ? (totPag/totHac*100) : 0;
  const pendienteComprometido = Math.max(totComp - totPag, 0);

  const sobregirados = programs.filter(p=> p.monto_autorizado!==null && totalDisponible(p) < 0);
  const sinAutorizar = programs.filter(p=> p.monto_autorizado===null);
  const mayor = programs.slice().sort((a,b)=> totalComprometido(b)-totalComprometido(a))[0];

  let html = `<p>De los <b>${programs.length}</b> programa${programs.length===1?'':'s'} registrados, el recurso autorizado total es de <b>${fmtMoney(totA)}</b>. Se ha comprometido <b>${fmtMoney(totComp)}</b> mediante dictaminación, equivalente al <b>${pctComprometido.toFixed(1)}%</b> del autorizado.</p>`;

  if(totComp>0){
    if(totHac===0){
      html += `<p>De ese recurso comprometido, ningún programa ha enviado todavía una solicitud a Hacienda; ese es el siguiente paso pendiente antes de poder ministrar los pagos.</p>`;
    } else {
      html += `<p>De lo comprometido se ha solicitado a Hacienda <b>${fmtMoney(totHac)}</b> (<b>${pctSolicitado.toFixed(1)}%</b>), y de lo solicitado se ha pagado <b>${fmtMoney(totPag)}</b> (<b>${pctPagadoDeSolicitado.toFixed(1)}%</b>). Quedan <b>${fmtMoney(pendienteComprometido)}</b> pendientes por ministrar del total comprometido.</p>`;
    }
  }

  if(totComp>0 && mayor){
    html += `<p>El programa con mayor recurso comprometido es <b>${mayor.nombre}</b>, con <b>${fmtMoney(totalComprometido(mayor))}</b>.</p>`;
  }

  if(totHac > totComp + 0.01){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: el total solicitado a Hacienda (${fmtMoney(totHac)}) supera el total comprometido (${fmtMoney(totComp)}). Conviene revisar los trámites registrados.</p>`;
  }
  if(totPag > totHac + 0.01 && totHac>0){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: el total pagado (${fmtMoney(totPag)}) supera lo solicitado a Hacienda (${fmtMoney(totHac)}). Conviene revisar los pagos registrados.</p>`;
  }

  if(sobregirados.length){
    const peor = sobregirados.slice().sort((a,b)=> totalDisponible(a)-totalDisponible(b))[0];
    html += `<p style="color:#FF9FB0;font-weight:700;">${sobregirados.length} programa${sobregirados.length===1?'':'s'} exceden su recurso autorizado. El más crítico es <b>${peor.nombre}</b>, con un sobregiro de <b>${fmtMoney(Math.abs(totalDisponible(peor)))}</b>.</p>`;
  } else if(programs.some(p=>p.monto_autorizado!==null)){
    html += `<p style="color:#7FE3B4;font-weight:700;">Ningún programa excede actualmente su recurso autorizado.</p>`;
  }

  if(sinAutorizar.length){
    html += `<p class="kpi-sub">${sinAutorizar.length} programa${sinAutorizar.length===1?'':'s'} aún sin Monto Autorizado cargado.</p>`;
  }

  return html;
}

function generateInsightPrograma(p){
  if(p.monto_autorizado===null || p.monto_autorizado===undefined){
    return `<p>Este programa todavía no tiene Monto Autorizado cargado, por lo que aún no hay cifras que comparar en la gráfica. Carga el monto autorizado para comenzar el seguimiento presupuestal.</p>`;
  }

  const autorizado = totalAutorizadoNeto(p);
  const comprometido = totalComprometido(p);
  const solicitado = totalSolicitadoHacienda(p);
  const pagado = totalPagado(p);
  const disponible = totalDisponible(p);
  const personas = totalPersonasDictaminadas(p);
  const numDictamenes = (p.dictamenes||[]).length;
  const numTramitesHacienda = (p.solicitudesHacienda||[]).length;
  const numPagos = (p.pagos||[]).length;
  const pctComprometido = autorizado>0 ? (comprometido/autorizado*100) : 0;
  const pctSolicitado = comprometido>0 ? (solicitado/comprometido*100) : 0;
  const pctPagado = solicitado>0 ? (pagado/solicitado*100) : (comprometido>0 ? (pagado/comprometido*100) : 0);

  let html = '';

  if(numDictamenes===0){
    html += `<p>Con un recurso autorizado de <b>${fmtMoney(autorizado)}</b>, este programa aún no tiene dictámenes registrados: dictaminar es el primer paso pendiente antes de poder comprometer recurso.</p>`;
    if(disponible<0){
      html += `<p style="color:#FF9FB0;font-weight:700;">El programa excede su recurso autorizado por <b>${fmtMoney(Math.abs(disponible))}</b>.</p>`;
    }
    return html;
  }

  html += `<p>De los <b>${fmtMoney(autorizado)}</b> autorizados, se han comprometido <b>${fmtMoney(comprometido)}</b> a través de <b>${numDictamenes}</b> dictamen${numDictamenes===1?'':'es'} y <b>${fmtNum(personas)}</b> persona${personas===1?'':'s'} dictaminada${personas===1?'':'s'} (<b>${pctComprometido.toFixed(1)}%</b> del autorizado).</p>`;

  if(numTramitesHacienda===0){
    html += `<p>Aún no se ha enviado ninguna solicitud a Hacienda; el siguiente paso es tramitar la ministración del recurso comprometido.</p>`;
  } else {
    html += `<p>Se ha solicitado a Hacienda <b>${fmtMoney(solicitado)}</b> en <b>${numTramitesHacienda}</b> trámite${numTramitesHacienda===1?'':'s'} (<b>${pctSolicitado.toFixed(1)}%</b> de lo comprometido).</p>`;
  }

  if(numPagos===0){
    html += solicitado>0
      ? `<p>Todavía no se registra ningún pago; el recurso solicitado a Hacienda sigue pendiente de ministración.</p>`
      : `<p>Todavía no se registra ningún pago a beneficiarios.</p>`;
  } else {
    html += `<p>Se han ministrado <b>${fmtMoney(pagado)}</b> en <b>${numPagos}</b> pago${numPagos===1?'':'s'} (<b>${pctPagado.toFixed(1)}%</b> de lo solicitado a Hacienda), quedando <b>${fmtMoney(Math.max(comprometido-pagado,0))}</b> pendientes por ministrar del total comprometido.</p>`;
  }

  if(solicitado > comprometido + 0.01){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: lo solicitado a Hacienda (${fmtMoney(solicitado)}) supera el recurso comprometido (${fmtMoney(comprometido)}). Conviene revisar los trámites registrados.</p>`;
  }
  if(pagado > solicitado + 0.01 && solicitado>0){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: el recurso pagado (${fmtMoney(pagado)}) supera lo solicitado a Hacienda (${fmtMoney(solicitado)}). Conviene revisar los pagos registrados.</p>`;
  }

  if(disponible<0){
    html += `<p style="color:#FF9FB0;font-weight:700;">El programa excede su recurso autorizado por <b>${fmtMoney(Math.abs(disponible))}</b>. Se recomienda registrar una ampliación o revisar los dictámenes.</p>`;
  } else {
    html += `<p style="color:#7FE3B4;font-weight:700;">Recurso disponible sin comprometer: ${fmtMoney(disponible)}.</p>`;
  }

  return html;
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
        ctx.fillStyle = '#221B18';
        ctx.font = '700 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const pos = element.tooltipPosition ? element.tooltipPosition() : element.getCenterPoint();
        ctx.fillText(fmtMoney(value), pos.x, pos.y - 5);
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
      {label:'Autorizado', data:dataAut, backgroundColor:COLOR_AUTORIZADO, borderRadius:6, maxBarThickness:40},
      {label:'Comprometido', data:dataComp, backgroundColor:COLOR_COMPROMETIDO, borderRadius:6, maxBarThickness:40},
      {label:'Pagado', data:dataPag, backgroundColor:COLOR_PAGADO, borderRadius:6, maxBarThickness:40},
    ]},
    options:{
      responsive:true, maintainAspectRatio:false, layout:{padding:{top:24}},
      plugins:{
        legend:{position:'top', labels:{usePointStyle:true, boxWidth:8, font:{size:11.5, weight:'600'}, color:'#221B18'}},
        tooltip:{
          backgroundColor:'#32091D', padding:11, cornerRadius:10, titleFont:{weight:'700'},
          callbacks:{
            label:(c)=> c.dataset.label+': '+fmtMoney(c.raw),
            footer:(items)=>{
              const total = items.reduce((s,it)=>s+it.raw,0);
              return 'Total en esta barra: '+fmtMoney(total);
            }
          },
          footerFont:{weight:'700'}, footerColor:'#C9A84E'
        }
      },
      scales:{
        x:{ grid:{display:false}, ticks:{color:'#6E665C', font:{size:11}} },
        y:{ beginAtZero:true, grid:{color:'#ECE6D8'}, ticks:{color:'#6E665C', font:{size:10.5}, callback:(v)=>fmtMoney(v)} }
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
  document.getElementById('submitNuevoPrograma').addEventListener('click', (e)=>submitNuevoPrograma(e.currentTarget));
}
async function submitNuevoPrograma(btn){
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
    const programa = await withLoading(btn, ()=>Api.post('/programs', { unidad_codigo:codigo, nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta }), 'Creando…');
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
  document.getElementById('submitEditarPrograma').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
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
      await withLoading(btn, ()=>Api.patch(`/programs/${p.id}`, { nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta }), 'Guardando…');
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
  document.getElementById('submitEliminarPrograma').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    try{
      await withLoading(btn, ()=>Api.del(`/programs/${p.id}`), 'Eliminando…');
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
        <div class="field"><label>Oficio (documento)</label><input type="file" id="m-doc" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
        <div class="field-hint">Este monto será la base de referencia para las gráficas y cálculos del programa.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" id="submitMonto">Guardar Monto</button>
    </div>
  `);
  document.getElementById('submitMonto').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const monto = Number(document.getElementById('m-monto').value);
    const referencia = document.getElementById('m-ref').value.trim() || 'S/R';
    const archivo = document.getElementById('m-doc').files[0];
    if(!monto) return;
    const fd = new FormData();
    fd.append('monto', monto);
    fd.append('referencia', referencia);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/monto-autorizado`, fd), 'Monto autorizado cargado.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
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
        <div class="field"><label>Oficio (documento)</label><input type="file" id="mo-doc" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitMod">Registrar</button>
    </div>
  `);
  document.getElementById('submitMod').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const tipo = document.getElementById('mo-tipo').value;
    const monto = Number(document.getElementById('mo-monto').value);
    const motivo = document.getElementById('mo-motivo').value.trim();
    const archivo = document.getElementById('mo-doc').files[0];
    if(!monto) return;
    const fd = new FormData();
    fd.append('tipo', tipo);
    fd.append('monto', monto);
    fd.append('motivo', motivo);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/modificaciones`, fd), 'Modificación registrada.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
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
        <div class="field"><label>Documento que avala la solicitud</label><input type="file" id="h-doc" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitHac">Registrar</button>
    </div>
  `);
  document.getElementById('submitHac').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const folio = document.getElementById('h-folio').value.trim();
    const monto = Number(document.getElementById('h-monto').value);
    const archivo = document.getElementById('h-doc').files[0];
    if(!monto) return;
    const fd = new FormData();
    fd.append('folio', folio);
    fd.append('monto', monto);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/hacienda`, fd), 'Solicitud a Hacienda registrada.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
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
        <div class="field"><label>Documento que avala el pago</label><input type="file" id="g-doc" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitPago">Registrar</button>
    </div>
  `);
  document.getElementById('submitPago').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const folio = document.getElementById('g-folio').value.trim();
    const monto = Number(document.getElementById('g-monto').value);
    const archivo = document.getElementById('g-doc').files[0];
    if(!monto) return;
    const fd = new FormData();
    fd.append('folio', folio);
    fd.append('monto', monto);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/pagos`, fd), 'Pago registrado.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---------- START ---------- */
init();