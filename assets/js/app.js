/* =========================================================================
   SISTEMA DE PROGRAMAS SOCIALES — App principal (app.html)
   Consume la API REST del backend (Neon vía Render). Requiere sesión activa.
   ========================================================================= */

/* ---------- GUARD DE SESIÓN ----------
   sessionStorage (no localStorage): la sesión se pierde al cerrar la
   pestaña/ventana del navegador, así que cada vez que se abre de nuevo hay
   que volver a iniciar sesión — no queda "recordada" entre visitas. */
const CURRENT_USER = JSON.parse(sessionStorage.getItem('pb_user') || 'null');
if (!sessionStorage.getItem('pb_token') || !CURRENT_USER) {
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
let state = { view:{name:'programas'}, programs: [] };

/* ---------- FORMAT HELPERS ---------- */
const fmtMoney = (n)=> '$' + Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtMoneyCompact = (n)=> new Intl.NumberFormat('es-MX',{notation:'compact',compactDisplay:'short',style:'currency',currency:'MXN',maximumFractionDigits:1}).format(n||0);
const fmtNum = (n)=> Number(n||0).toLocaleString('es-MX');
const fmtDate = (iso)=> { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' + d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}); };
// Solo fecha, sin hora — para "Registro del dictamen", que ya no captura hora.
// Lee el año-mes-día directo del string ISO (los primeros 10 caracteres,
// "YYYY-MM-DD") en vez de construir un Date y formatearlo en la zona
// horaria del navegador: esto último resta horas a una fecha guardada en
// UTC medianoche y puede mostrar el día anterior (ej. "2026-09-15" se veía
// como "14 sep" en un navegador en UTC-6).
const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fmtDateOnly = (iso)=> {
  if(!iso) return 'S/F';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return 'S/F';
  const [, y, mo, d] = m;
  return `${d} ${MESES_CORTOS[Number(mo)-1]} ${y}`;
};
const fmtFileSize = (bytes)=>{
  if(!bytes && bytes!==0) return '';
  if(bytes < 1024) return bytes+' B';
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1)+' KB';
  return (bytes/(1024*1024)).toFixed(1)+' MB';
};

/* ---------- ESCAPE DE TEXTO LIBRE ----------
   Cualquier texto capturado por el usuario que se inserte dentro de HTML
   armado con template literals (folio, motivo, etc.) debe pasar por aquí
   antes de insertarse, para evitar inyección de HTML/XSS. */
function esc(str){
  return String(str===null||str===undefined ? '' : str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* ---------- "VER DOCUMENTO" + "ELIMINAR DOCUMENTO" ----------
   Cualquier documento cargado (Monto Autorizado, Modificación, Solicitud a
   Hacienda, Autorización, Archivo de Asignación, Dispersión, Acta de
   Dictamen) se muestra con este mismo par de botones: "Ver Documento" y un
   botón de eliminar (icon-btn) al lado. `delPath` es la ruta completa que se
   manda a Api.del() para limpiar SOLO ese documento (nunca borra el
   registro al que pertenece — folio/monto/fecha/estatus quedan intactos).
   Se resuelve con un único data-del-doc delegado en bindDocDeleteButtons(). */
function docLinkRowHTML(url, delPath, label){
  if(!url) return '';
  return `<div class="doc-link-row">
    <a class="btn-ver-documento" href="${url}" target="_blank" rel="noopener">${label || 'Ver Documento'}</a>
    <button type="button" class="icon-btn" data-del-doc="${delPath}" title="Eliminar documento">✕</button>
  </div>`;
}

async function handleEliminarDocumento(pid, path, btn){
  const ok = await confirmAction({
    title: 'Eliminar Documento',
    message: '¿Eliminar este documento? Esta acción no se puede deshacer. El registro al que pertenece (folio, monto, fecha, etc.) no se ve afectado.',
    confirmText: 'Sí, Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(path), 'Documento eliminado.'), 'Eliminando…');
  await refreshOneProgram(pid); renderDetalle(pid);
}

// Delegación única para todos los botones "Eliminar Documento" del detalle
// del programa (monto autorizado, modificaciones, hacienda, autorización,
// asignación, dispersión y acta de dictamen quedan cubiertos con esto,
// porque data-del-doc se usa en todos por igual, sin importar en qué
// bloque/sub-componente esté anidado el botón).
function bindDocDeleteButtons(el, pid){
  el.querySelectorAll('[data-del-doc]').forEach(btn=>{
    btn.addEventListener('click', ()=> handleEliminarDocumento(pid, btn.dataset.delDoc, btn));
  });
}

/* ---------- CAMPOS NUMÉRICOS CON SEPARADOR DE MILES EN VIVO ----------
   Un <input type="number"> nativo no admite comas, así que estos campos
   (montos y cantidades) se escriben como texto y se les agrega separador
   de miles y punto decimal mientras el usuario teclea, para que las
   cifras grandes sean legibles (ej. 1,000,000.00). data-money admite
   decimales (dinero); data-int solo enteros (personas, meta de
   beneficiarios). numValue() quita las comas antes de usar el valor en
   cálculos o al enviarlo a la API — el valor real nunca lleva comas. */
function formatDigitsLive(raw, allowDecimals){
  let clean = String(raw||'').replace(/[^\d.]/g,'');
  if(!allowDecimals){
    clean = clean.replace(/\./g,'');
  } else {
    const firstDot = clean.indexOf('.');
    if(firstDot!==-1) clean = clean.slice(0,firstDot+1) + clean.slice(firstDot+1).replace(/\./g,'');
  }
  const [intRaw, decRaw] = clean.split('.');
  const intFormatted = intRaw ? Number(intRaw).toLocaleString('es-MX') : '';
  if(decRaw!==undefined) return intFormatted + '.' + decRaw.slice(0,2);
  return intFormatted;
}
function bindNumberInputs(root){
  (root||document).querySelectorAll('[data-money],[data-int]').forEach(el=>{
    if(el.dataset.fmtBound) return;
    el.dataset.fmtBound = '1';
    const allowDecimals = el.hasAttribute('data-money');
    el.setAttribute('inputmode','decimal');
    el.addEventListener('input', ()=>{
      const prevPos = el.selectionStart===null ? el.value.length : el.selectionStart;
      const digitsBefore = el.value.slice(0, prevPos).replace(/[^\d.]/g,'').length;
      el.value = formatDigitsLive(el.value, allowDecimals);
      let count = 0, pos = el.value.length;
      for(let i=0;i<el.value.length;i++){
        if(/[\d.]/.test(el.value[i])) count++;
        if(count>=digitsBefore){ pos = i+1; break; }
      }
      el.setSelectionRange(pos,pos);
    });
  });
}
function numValue(el){
  if(!el) return 0;
  const n = Number(String(el.value||'').replace(/,/g,''));
  return isNaN(n) ? 0 : n;
}
function fmtInputMoney(v){
  if(v===null||v===undefined||v==='') return '';
  const n = Number(v);
  return isNaN(n) ? '' : n.toLocaleString('es-MX',{maximumFractionDigits:2});
}
function fmtInputInt(v){
  if(v===null||v===undefined||v==='') return '';
  const n = Number(v);
  return isNaN(n) ? '' : n.toLocaleString('es-MX');
}

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
   Modal de confirmación reutilizable, simple y centrado (icono + título +
   mensaje + acciones), más consistente que window.confirm y sin el ruido
   visual de un modal-header/footer completo para algo tan puntual.
   Devuelve una Promise<boolean>. */
const CONFIRM_ICON_TRASH_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
function confirmAction({ title = '¿Estás seguro?', message = 'Esta acción no se puede deshacer.', confirmText = 'Sí, continuar', danger = true } = {}){
  return new Promise((resolve)=>{
    openModal(`
      <div class="confirm-modal">
        <div class="confirm-icon ${danger?'is-danger':'is-neutral'}">${CONFIRM_ICON_TRASH_SVG}</div>
        <h3 class="confirm-title">${title}</h3>
        <p class="confirm-message">${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" id="confirmCancel">Cancelar</button>
          <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirmOk">${confirmText}</button>
        </div>
      </div>
    `);
    const finish = (result)=>{
      closeModal();
      resolve(result);
    };
    document.getElementById('confirmCancel').addEventListener('click', ()=>finish(false));
    document.getElementById('confirmOk').addEventListener('click', ()=>finish(true));
  });
}

/* ---------- FECHA Y HORA MANUAL ----------
   Cada etapa del proceso (dictamen, recurso comprometido, solicitud a
   Hacienda, autorización, pago) captura su propia fecha/hora real de
   ejecución mediante un selector visual de calendario + hora, en vez de
   usar siempre la fecha/hora automática del servidor. Los campos se
   precargan con "ahora" pero son 100% editables. */
function pad2(n){ return String(n).padStart(2,'0'); }
function splitFechaHora(value){
  const d = value ? new Date(value) : new Date();
  const base = isNaN(d.getTime()) ? new Date() : d;
  return {
    fecha: `${base.getFullYear()}-${pad2(base.getMonth()+1)}-${pad2(base.getDate())}`,
    hora: `${pad2(base.getHours())}:${pad2(base.getMinutes())}`
  };
}
/* Bloque compacto de Fecha + Hora para usarse dentro de modales. */
function dateTimeFieldGroupHTML(idPrefix, label, value){
  const { fecha, hora } = splitFechaHora(value);
  return `
    <div class="field-group">
      <div class="field-group-label">${label}</div>
      <div class="field"><label>Fecha</label><input type="date" id="${idPrefix}-fecha" value="${fecha}"></div>
      <div class="field"><label>Hora</label><input type="time" id="${idPrefix}-hora" value="${hora}"></div>
    </div>`;
}
/* Combina fecha (YYYY-MM-DD) + hora (HH:mm), tal como las capturó el
   usuario en SU hora local (la del navegador, que es la de Ciudad de
   México/Pachuca), y regresa un ISO string en UTC (con sufijo "Z").
   Es importante construir el Date con el constructor de componentes
   (año, mes, día, hora, minuto) y NO con `new Date("YYYY-MM-DDTHH:mm")`:
   esa segunda forma también se interpreta en hora local del navegador,
   pero si el string se mandara tal cual al backend, Node.js lo
   interpretaría en la zona horaria DEL SERVIDOR (normalmente UTC en
   Render), desfasando la hora capturada por varias horas. Al convertir a
   ISO/UTC aquí mismo, el backend puede hacer `new Date(iso)` sin ambigüedad
   sin importar en qué zona horaria corra. */
function combineFechaHoraISO(fechaStr, horaStr){
  if(!fechaStr) return null;
  const [y,m,d] = fechaStr.split('-').map(Number);
  const [hh,mm] = (horaStr||'00:00').split(':').map(Number);
  if(!y || !m || !d) return null;
  const dt = new Date(y, m-1, d, hh||0, mm||0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}
function readDateTimeGroup(idPrefix){
  const fechaEl = document.getElementById(idPrefix+'-fecha');
  const horaEl = document.getElementById(idPrefix+'-hora');
  if(!fechaEl || !fechaEl.value) return null;
  return combineFechaHoraISO(fechaEl.value, horaEl ? horaEl.value : '00:00');
}

/* ---------- SECCIONES MINIMIZABLES ----------
   Envuelve un bloque grande del detalle de programa en un encabezado
   colapsable + tarjeta de contenido. El estado (abierta/cerrada) se
   conserva en memoria por sección mientras dura la sesión, para que no se
   pierda cada vez que se vuelve a dibujar la pantalla tras guardar algo. */
const __sectionState = {};
function isSectionOpen(id, defaultOpen){
  return __sectionState.hasOwnProperty(id) ? __sectionState[id] : defaultOpen;
}
function collapsibleSection(id, title, hint, bodyHtml, defaultOpen, extraHeaderHTML){
  const open = isSectionOpen(id, defaultOpen !== false);
  return `
    <div class="section-title collapsible-header" data-toggle-section="${id}">
      <h2>${title}</h2>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="hint section-summary">${hint||''}</span>
        ${extraHeaderHTML ? `<span onclick="event.stopPropagation()">${extraHeaderHTML}</span>` : ''}
        <button type="button" class="section-toggle-btn" data-section-toggle-btn aria-expanded="${open}" title="${open?'Minimizar':'Expandir'}">▾</button>
      </div>
    </div>
    <div class="card section-body" id="section-body-${id}" ${open?'':'hidden'}>${bodyHtml}</div>`;
}
function bindCollapsibleSections(root){
  root.querySelectorAll('[data-toggle-section]').forEach(header=>{
    header.addEventListener('click', ()=>{
      const id = header.dataset.toggleSection;
      const body = document.getElementById('section-body-'+id);
      const btn = header.querySelector('[data-section-toggle-btn]');
      if(!body || !btn) return;
      const willOpen = body.hasAttribute('hidden');
      if(willOpen){ body.removeAttribute('hidden'); } else { body.setAttribute('hidden',''); }
      btn.setAttribute('aria-expanded', String(willOpen));
      btn.title = willOpen ? 'Minimizar' : 'Expandir';
      __sectionState[id] = willOpen;
    });
  });
}

/* ---------- DRAG & DROP DE ARCHIVOS ----------
   Reemplaza el <input type="file"> tradicional por una zona moderna:
   arrastrar, hacer clic, ver nombre/tipo/tamaño del archivo cargado, y
   poder quitarlo o reemplazarlo. El <input type="file"> real se conserva
   (oculto) dentro de la zona, así que el resto del código que lee
   `document.getElementById(id).files[0]` sigue funcionando sin cambios. */
const DROPZONE_UPLOAD_ICON_SVG = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 2.5v6h6"/><path d="M12 18.5v-6.5"/><path d="M9.2 14.5 12 11.7l2.8 2.8"/></svg>`;
function fileDropZoneHTML(id, label, accept, hint, titulo){
  return `
    <div class="field">
      <label>${label}</label>
      <div class="dropzone" data-dropzone="${id}" tabindex="0">
        <input type="file" id="${id}" accept="${accept||''}" hidden>
        <div class="dropzone-empty" data-dz-empty="${id}">
          <div class="dropzone-icon">${DROPZONE_UPLOAD_ICON_SVG}</div>
          <div class="dropzone-title">${titulo || 'Archivo'}</div>
          <div class="dropzone-hint">${hint || 'Arrastra tu archivo aquí o haz clic para seleccionarlo'}</div>
        </div>
        <div class="dropzone-file" data-dz-file="${id}" hidden>
          <div class="dz-file-icon">📄</div>
          <div class="dz-file-info">
            <div class="dz-file-name" data-dz-name="${id}"></div>
            <div class="dz-file-meta" data-dz-meta="${id}"></div>
          </div>
          <div class="dz-file-status" data-dz-status="${id}">✓ Cargado</div>
          <button type="button" class="icon-btn" data-dz-remove="${id}" title="Quitar archivo">✕</button>
        </div>
      </div>
    </div>`;
}
function bindDropZone(id){
  const zone = document.querySelector(`[data-dropzone="${id}"]`);
  const input = document.getElementById(id);
  if(!zone || !input) return;
  const empty = zone.querySelector(`[data-dz-empty="${id}"]`);
  const fileBox = zone.querySelector(`[data-dz-file="${id}"]`);
  const nameEl = zone.querySelector(`[data-dz-name="${id}"]`);
  const metaEl = zone.querySelector(`[data-dz-meta="${id}"]`);
  const removeBtn = zone.querySelector(`[data-dz-remove="${id}"]`);

  function showFile(file){
    empty.hidden = true; fileBox.hidden = false;
    nameEl.textContent = file.name;
    const ext = (file.name.split('.').pop()||'').toUpperCase();
    metaEl.textContent = `${ext} · ${fmtFileSize(file.size)}`;
    zone.classList.add('has-file');
  }
  function clearFile(){
    input.value = '';
    empty.hidden = false; fileBox.hidden = true;
    zone.classList.remove('has-file');
  }
  zone.addEventListener('click', (e)=>{ if(e.target.closest('[data-dz-remove]')) return; input.click(); });
  zone.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); input.click(); } });
  input.addEventListener('change', ()=>{ if(input.files[0]) showFile(input.files[0]); else clearFile(); });
  ['dragenter','dragover'].forEach(evt=> zone.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); zone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt=> zone.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', (e)=>{
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if(!file) return;
    input.files = e.dataTransfer.files;
    showFile(file);
  });
  removeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); clearFile(); });
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
   se cae al total agregado que manda el listado.

   ---- TOTALES vs. ESTADO REAL ----
   Las funciones total*() de abajo (totalModificado, totalComprometido,
   totalSolicitadoHacienda, totalPagado) son y siempre han sido acumulados
   históricos: suman TODOS los registros capturados y nunca "restan" nada
   porque el recurso haya avanzado a la siguiente etapa (comprometer,
   solicitar a Hacienda o pagar no elimina ni reduce el historial anterior).

   Las funciones *Disponible/*Pendiente de más abajo sí son dinámicas: se
   calculan restando lo que ya avanzó a una etapa posterior. El mismo peso
   jamás se cuenta dos veces como disponible: por eso se restan de manera
   acumulada siguiendo el flujo Autorizado → Comprometido → Solicitado a
   Hacienda → Pagado, y se acotan a 0 como piso cuando no tiene sentido un
   pendiente negativo (p. ej. si se pagó de más respecto a lo solicitado).
   Estas cifras alimentan el pipeline "Flujo y Estado del Presupuesto"
   (pipelinePresupuestoHTML). ---------- */
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
/* Total histórico autorizado por Hacienda: suma de los montos ya
   autorizados (h.autorizacion.monto_autorizado) de las solicitudes a
   Hacienda del programa. Mismo campo/fuente que ya se usa en
   haciendaItemHTML y en openModalPago para mostrar "Autorizado por
   Hacienda" — se reutiliza aquí tal cual, sin inventar otro dato. */
function totalAutorizadoPorHacienda(p){
  if(p.solicitudesHacienda) return p.solicitudesHacienda.reduce((s,h)=> s + (h.autorizacion ? Number(h.autorizacion.monto_autorizado||0) : 0), 0);
  return Number(p.autorizado_hacienda_total || 0);
}
/* "Disponible" contra el monto autorizado neto (autorizado + modificaciones).
   Se conserva con este nombre porque ya se usaba en otras vistas (tarjetas
   de listado, insights, gráfica comparativa). */
function totalDisponible(p){ return totalAutorizadoNeto(p) - totalComprometido(p); }

/* Estado Real: cuánto queda disponible contra el autorizado ORIGINAL (sin
   contar modificaciones) una vez descontado lo ya comprometido. */
function totalAutorizadoDisponible(p){ return montoAutorizadoBase(p) - totalComprometido(p); }
/* Estado Real: de lo comprometido, cuánto sigue comprometido pendiente de
   solicitar/pagar (lo ya pagado deja de contar aquí, pero sigue intacto en
   el histórico de totalComprometido). */
function totalComprometidoPendiente(p){ return Math.max(totalComprometido(p) - totalPagado(p), 0); }
/* Estado Real: de lo solicitado a Hacienda, cuánto sigue pendiente de pago
   (lo ya pagado deja de contar aquí, pero sigue intacto en el histórico de
   totalSolicitadoHacienda). */
function totalHaciendaPendiente(p){ return Math.max(totalSolicitadoHacienda(p) - totalPagado(p), 0); }
/* Estado Real: de lo solicitado a Hacienda, cuánto sigue pendiente de que
   Hacienda lo AUTORICE (una vez autorizado deja de ser "solicitado
   pendiente" — ya avanzó a la siguiente etapa del flujo — aunque sigue
   intacto en el histórico de totalSolicitadoHacienda). Antes esta etapa
   mostraba el histórico completo aunque ya estuviera aprobado por
   Hacienda, contando el mismo peso dos veces (como "solicitado" y como
   "aprobado") — con este cálculo el peso ya autorizado deja de sumar aquí. */
function totalSolicitadoHaciendaPendiente(p){ return Math.max(totalSolicitadoHacienda(p) - totalAutorizadoPorHacienda(p), 0); }
/* Estado Real: de lo ya autorizado por Hacienda, cuánto sigue pendiente de
   dispersión (lo ya pagado deja de contar aquí, pero sigue intacto en el
   histórico de totalAutorizadoPorHacienda). */
function totalAutorizadoHaciendaPendiente(p){ return Math.max(totalAutorizadoPorHacienda(p) - totalPagado(p), 0); }

/* ---------- Cantidad de pagos por beneficiario / Meta - Dispersión ----------
   cantidadPagosDe() siempre regresa al menos 1 (COALESCE en el mismo
   espíritu que hace el backend con COALESCE(cantidad_pagos,1) para
   programas creados antes de que existiera este campo).
   montoTotalBeneficiario() = monto por beneficiario * cantidad de pagos.

   ---- DISPERSIÓN POR DICTAMEN (seguimiento inteligente) ----
   El cálculo de "Meta - Dispersión" ya NO es una estimación global del
   programa (antes: floor(total dispersado del programa / monto total por
   beneficiario), sin saber a qué dictamen correspondía ese dinero). Ahora
   cada Solicitud a Hacienda puede venir vinculada a un dictamen específico
   (h.dictamen_id, ver migración 004_solicitud_hacienda_dictamen_link.sql y
   el selector "Dictamen relacionado" en openModalHacienda), así que se
   puede calcular la dispersión REAL de cada dictamen: cuánto de lo que
   pertenece a ESE dictamen ya se dispersó entre SUS personas.

   dispersionPorDictamen(p, dictamenId) usa exactamente el mismo criterio de
   "ya dispersada" que el resto del sistema (h.pagada, calculado en el
   backend a partir de si existe un registro en `pagos` para esa solicitud —
   ver getProgramaCompleto en programs.routes.js), y suma el monto de la
   propia solicitud a Hacienda (no el del pago) porque una solicitud
   dispersada representa el compromiso de ese dictamen ya liquidado.

   totalPersonasDispersion(p) sigue siendo el nombre público que consume el
   resto de la UI (tarjeta e info-grid del detalle), pero ahora es la SUMA
   de la dispersión real de cada dictamen del programa, MÁS un término de
   respaldo (totalPersonasDispersionSinVincular) para las Solicitudes a
   Hacienda que quedaron sin vincular a ningún dictamen (registros
   anteriores a esta funcionalidad, o capturados a propósito sin elegir uno)
   — calculado con la fórmula proporcional anterior, para no perder de vista
   dinero realmente dispersado solo porque no está ligado a un dictamen. */
function cantidadPagosDe(p){ const n = Number(p.cantidad_pagos||1); return n>=1 ? Math.floor(n) : 1; }
function montoTotalBeneficiario(p){ return Number(p.monto_beneficiario||0) * cantidadPagosDe(p); }

/* Dispersión real de UN dictamen: suma el monto de las Solicitudes a
   Hacienda vinculadas a ese dictamen (h.dictamen_id === dictamenId) que ya
   fueron dispersadas (h.pagada), y calcula cuántas personas de ese mismo
   dictamen quedan cubiertas con ese monto.

   ---- DENOMINADOR CORRECTO: propio del dictamen, no del programa ----
   Antes se dividía entre montoTotalBeneficiario(p) (monto_beneficiario del
   PROGRAMA × cantidad_pagos del PROGRAMA, un ajuste global de "cuántos
   pagos recibe cada beneficiario en general"). Eso es incorrecto cuando la
   cantidad de pagos realmente pactada para ESTE dictamen es distinta de la
   del programa: por ejemplo, si el programa tiene cantidad_pagos=4 (usado
   para otro fin, "Monto total por beneficiario" en la tarjeta del
   programa) pero este dictamen comprometió a sus personas con 1 solo pago
   cada una, dividir entre el monto con 4 pagos subestima gravemente cuánta
   gente ya quedó cubierta.

   Ahora cada fila de Solicitud (dentro del dictamen) trae su propia
   cantidad_pagos (ver migración 005_solicitud_cantidad_pagos.sql y el
   selector "Cantidad de Pagos" en openModalNuevaSolicitud), así que
   se calcula un monto total por persona PROPIO de este dictamen: la suma,
   sobre cada una de sus solicitudes, de (personas de la fila × monto por
   beneficiario del programa × cantidad_pagos de ESA fila), dividida entre
   el total de personas del dictamen. Si todas las filas del dictamen
   comparten la misma cantidad_pagos esto da exactamente ese monto; si hay
   filas con distinta cantidad_pagos, da el promedio ponderado por
   personas — lo correcto para no perder precisión en ningún caso. */
function dispersionPorDictamen(p, dictamenId){
  const dictamen = (p.dictamenes||[]).find(d=>Number(d.id)===Number(dictamenId));
  const montoBeneficiario = Number(p.monto_beneficiario||0);
  const solicitudesDictamen = dictamen ? (dictamen.solicitudes||[]) : [];
  const totalPersonasDictamen = solicitudesDictamen.reduce((s,so)=> s + Number(so.personas||0), 0);
  const totalMontoTotalDictamen = solicitudesDictamen.reduce((s,so)=>{
    const cantidadPagosFila = Number(so.cantidad_pagos||1) >= 1 ? Math.floor(Number(so.cantidad_pagos||1)) : 1;
    return s + (Number(so.personas||0) * montoBeneficiario * cantidadPagosFila);
  }, 0);
  const montoTotalPorPersonaPromedio = totalPersonasDictamen>0 ? (totalMontoTotalDictamen / totalPersonasDictamen) : montoBeneficiario;

  const montoDispersado = (p.solicitudesHacienda||[])
    .filter(h => h.dictamen_id!=null && dictamenId!=null && Number(h.dictamen_id)===Number(dictamenId) && h.pagada)
    .reduce((s,h)=> s + Number(h.monto||0), 0);
  const personasDispersadas = montoTotalPorPersonaPromedio>0 ? Math.floor(montoDispersado / montoTotalPorPersonaPromedio) : 0;
  return { montoDispersado, personasDispersadas };
}

/* Respaldo (fallback) para Solicitudes a Hacienda dispersadas que NO están
   vinculadas a ningún dictamen (legado / sin elegir uno en el formulario):
   se calcula de manera proporcional, tal como funcionaba el sistema antes
   de esta funcionalidad, para no dejar fuera del total dinero que
   realmente ya se dispersó. */
function totalPersonasDispersionSinVincular(p){
  const montoTotalPorBeneficiario = montoTotalBeneficiario(p);
  if(montoTotalPorBeneficiario<=0) return { montoDispersado:0, personas:0 };
  const montoDispersado = (p.solicitudesHacienda||[])
    .filter(h => h.dictamen_id==null && h.pagada)
    .reduce((s,h)=> s + Number(h.monto||0), 0);
  return { montoDispersado, personas: Math.floor(montoDispersado / montoTotalPorBeneficiario) };
}

/* Meta - Dispersión del programa completo: suma de la dispersión real de
   cada uno de sus dictámenes, más el respaldo de lo dispersado sin
   vincular a ningún dictamen (ver comentario arriba). Reemplaza el cálculo
   global anterior — no queda ninguna otra fórmula de "Meta - Dispersión"
   compitiendo con esta en el resto del archivo. */
function totalPersonasDispersion(p){
  const porDictamenes = (p.dictamenes||[]).reduce((s,d)=> s + dispersionPorDictamen(p, d.id).personasDispersadas, 0);
  return porDictamenes + totalPersonasDispersionSinVincular(p).personas;
}

function estadoPrograma(p){
  if(p.monto_autorizado===null || p.monto_autorizado===undefined) return {label:'Registrado', color:'var(--status-registrado)'};
  if(totalComprometido(p)===0) return {label:'Autorizado', color:'var(--status-autorizado)'};
  if(totalPagado(p) < totalComprometido(p)) return {label:'En Dictaminación', color:'var(--status-dictaminacion)'};
  return {label:'Dispersado', color:'var(--status-pagado)'};
}

/* =========================================================================
   INIT — carga usuario, unidades y programas
   ========================================================================= */
async function init(){
  document.getElementById('navUserName').textContent = CURRENT_USER.nombre;
  document.getElementById('navUserRole').textContent = 'Administrador';
  document.getElementById('navUserAvatar').textContent = (CURRENT_USER.nombre||'?').trim().charAt(0).toUpperCase();

  document.getElementById('btnLogout').addEventListener('click', ()=>{
    sessionStorage.removeItem('pb_token');
    sessionStorage.removeItem('pb_user');
    window.location.href = 'index.html';
  });

  const footerYearEl = document.getElementById('footerYear');
  if(footerYearEl) footerYearEl.textContent = new Date().getFullYear();

  const navDateEl = document.getElementById('navDate');
  if(navDateEl){
    const hoy = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    navDateEl.textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);
  }

  document.getElementById('view-programas').innerHTML = `<div class="loading-block"><span class="loading-spinner"></span> Cargando información…</div>`;

  try{
    UNIDADES = await Api.get('/unidades');
    state.programs = await Api.get('/programs');
  }catch(err){
    toast(err.message || 'No se pudieron cargar los datos.', true);
  }
  navigate({name:'programas'});
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

  if(view.name==='programas'){
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
      <div><span>Dispersado</span><b>${fmtMoneyCompact(pag)}</b></div>
    </div>
    <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="kpi-sub" style="margin-top:6px;">${pct}% dispersado del monto comprometido</div>
  </div>`;
}
function bindProgramTileClicks(root){
  root.querySelectorAll('[data-open]').forEach(t=>{
    t.addEventListener('click', ()=> navigate({name:'detalle', id:Number(t.dataset.open)}));
  });
}

/* =========================================================================
   VIEW: PROGRAMAS (única vista principal del sistema: solo el listado).
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
  const autorizadoNeto = totalAutorizadoNeto(p);
  const disponible = totalDisponible(p);
  const personas = totalPersonasDictaminadas(p);
  const montoTotalBenef = montoTotalBeneficiario(p);
  const personasDispersion = totalPersonasDispersion(p);
  const dispersionSinVincular = totalPersonasDispersionSinVincular(p);

  const disponiblesParaPago = (p.solicitudesHacienda||[]).filter(h=>h.disponibleParaPago);

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
        <div class="info-item"><div class="label">Monto total por beneficiario</div><div class="value">${fmtMoney(montoTotalBenef)} <span class="kpi-sub">(${cantidadPagosDe(p)} pago${cantidadPagosDe(p)===1?'':'s'})</span></div></div>
        <div class="info-item"><div class="label">Meta de beneficiarios</div><div class="value">${fmtNum(p.meta_beneficiarios)}</div></div>
        <div class="info-item"><div class="label">Meta - P. Dictaminadas</div><div class="value">${fmtNum(personas)} <span class="kpi-sub">(${p.meta_beneficiarios? Math.round(personas/p.meta_beneficiarios*100):0}% de la meta)</span></div></div>
        <div class="info-item"><div class="label">Meta - Dispersión</div><div class="value">${fmtNum(personasDispersion)} <span class="kpi-sub">(${p.meta_beneficiarios? Math.round(personasDispersion/p.meta_beneficiarios*100):0}% de la meta)</span></div>
          ${dispersionSinVincular.personas>0 ? `<div class="kpi-sub" title="Solicitudes a Hacienda dispersadas sin vincular a un dictamen específico, calculadas de forma proporcional (legado)">(incluye ${fmtNum(dispersionSinVincular.personas)} persona${dispersionSinVincular.personas===1?'':'s'} · ${fmtMoney(dispersionSinVincular.montoDispersado)} sin vincular a un dictamen)</div>` : ''}
        </div>
        <div class="info-item"><div class="label">Recurso disponible</div><div class="value" style="color:${disponible<0?'var(--red)':'var(--text-dark)'}">${fmtMoney(disponible)}</div></div>
      </div>
    </div>

    ${pipelinePresupuestoHTML(p)}

    <div class="section-title"><h2>Monto Autorizado y Modificaciones</h2></div>
    <div class="card accent" style="--accent:var(--gold-500)">
      ${p.monto_autorizado!==null ? `
        <div>
          <div class="kpi-label">Monto Autorizado inicial</div>
          <div class="kpi-value">${fmtMoney(autorizadoBase)}</div>
          <div class="kpi-sub">
            <span>Referencia ${p.monto_autorizado_referencia} · ${fmtDate(p.monto_autorizado_fecha)}</span>
          </div>
        </div>
        ${docLinkRowHTML(p.monto_autorizado_documento_url, `/programs/${p.id}/monto-autorizado/documento`)}
        <hr class="divider">
        <div class="log-list">
          ${(p.modificaciones||[]).length ? p.modificaciones.map(m=>`
            <div class="log-row${m.documento_url ? ' log-row-with-doc' : ''}">
              <div class="log-row-body">
                <div class="log-row-icon ${m.tipo==='Ampliación'?'log-row-icon-pos':'log-row-icon-neg'}">${m.tipo==='Ampliación'?'+':'−'}</div>
                <div class="log-row-main">
                  <div class="log-row-title">${m.tipo}</div>
                  <div class="lmeta">${esc(m.motivo||'')} · ${fmtDate(m.created_at)}</div>
                </div>
                <div class="lamount ${m.tipo==='Ampliación'?'pos':'neg'}">${m.tipo==='Ampliación'?'+':'−'} ${fmtMoney(m.monto)}</div>
              </div>
              ${docLinkRowHTML(m.documento_url, `/programs/${p.id}/modificaciones/${m.id}/documento`)}
            </div>`).join('') : `<div class="empty-state">Sin modificaciones registradas.</div>`}
        </div>
        <div style="text-align:center;margin-top:14px;">
          <button class="btn btn-primary btn-sm" id="btnAddModificacion">+ Registrar Modificación</button>
        </div>
      ` : `
        <div class="empty-state" style="padding:10px 10px 16px;">Este programa aún no tiene Monto Autorizado cargado.</div>
        <div style="text-align:center;"><button class="btn btn-gold" id="btnCargarMonto">Cargar Monto Autorizado</button></div>
      `}
    </div>

    ${collapsibleSection('dictaminacion','Dictaminación', `${(p.dictamenes||[]).length} dictamen(es) · ${fmtNum(personas)} personas`, `
      ${(p.dictamenes||[]).map(d=>dictamenBlockHTML(p,d)).join('') || `<div class="empty-state">Sin dictámenes registrados.</div>`}
    `, true, `<button class="btn btn-primary btn-sm" id="btnAddDictamen">+ Agregar Dictamen</button>`)}

    ${collapsibleSection('hacienda','Solicitudes a Hacienda', `${(p.solicitudesHacienda||[]).length} trámite(s)`, `
      ${(p.solicitudesHacienda||[]).length? p.solicitudesHacienda.map(h=>haciendaItemHTML(h,p)).join('') : `<div class="empty-state">Sin trámites enviados a Hacienda.</div>`}
      <div style="text-align:center;margin-top:10px;">
        <button class="btn btn-outline btn-sm" id="btnAddHacienda">+ Registrar Solicitud a Hacienda</button>
      </div>
    `)}

    ${collapsibleSection('pagos','Recurso Dispersado', `${(p.pagos||[]).length} dispersión(es)`, `
      <div class="log-list">
        ${(p.pagos||[]).length? p.pagos.map(g=>pagoRowHTML(p,g)).join('') : `<div class="empty-state">Sin dispersiones registradas.</div>`}
      </div>
      <div style="text-align:center;margin-top:10px;">
        ${disponiblesParaPago.length
          ? `<button class="btn btn-outline btn-sm" id="btnAddPago">+ Registrar Dispersión</button>`
          : `<div class="field-hint" style="margin-bottom:8px;">No hay solicitudes a Hacienda con Archivo de Asignación correcto, pendientes de dispersión.</div>`}
      </div>
    `)}

    ${collapsibleSection('documentos','Documentos', `${documentosCount(p)} archivo(s)`, documentosSectionBody(p), false)}
  `;

  document.getElementById('backToList').addEventListener('click', ()=>navigate({name:'programas'}));
  const btnToggleTableProg = document.getElementById('toggleTableProg');
  if(btnToggleTableProg) btnToggleTableProg.addEventListener('click', ()=>document.getElementById('tableProg').classList.toggle('show'));
  document.getElementById('btnEditarPrograma').addEventListener('click', ()=>openModalEditarPrograma(p));
  document.getElementById('btnEliminarPrograma').addEventListener('click', ()=>openModalEliminarPrograma(p));
  const btnCargar = document.getElementById('btnCargarMonto');
  if(btnCargar) btnCargar.addEventListener('click', ()=>openModalCargarMonto(p.id));
  const btnMod = document.getElementById('btnAddModificacion');
  if(btnMod) btnMod.addEventListener('click', ()=>openModalModificacion(p.id));
  document.getElementById('btnAddDictamen').addEventListener('click', ()=> openModalNuevoDictamen(p.id));
  document.getElementById('btnAddHacienda').addEventListener('click', ()=>openModalHacienda(p.id));
  const btnPago = document.getElementById('btnAddPago');
  if(btnPago) btnPago.addEventListener('click', ()=>openModalPago(p));

  bindCollapsibleSections(el);
  bindNumberInputs(el);
  bindDocDeleteButtons(el, p.id);

  el.querySelectorAll('[data-autorizar-hacienda]').forEach(btn=>{
    btn.addEventListener('click', ()=> openModalAutorizacion(p.id, btn.dataset.autorizarHacienda));
  });
  el.querySelectorAll('[data-editar-hacienda]').forEach(btn=>{
    btn.addEventListener('click', ()=> openModalEditarHacienda(p.id, btn.dataset.editarHacienda));
  });
  el.querySelectorAll('[data-del-hacienda]').forEach(btn=>{
    btn.addEventListener('click', (e)=> handleDeleteHacienda(p.id, btn.dataset.delHacienda, e.currentTarget));
  });

  // Archivo de Asignación: cargar, marcar correcto / incorrecto.
  el.querySelectorAll('[data-asig-upload]').forEach(btn=>{
    const hid = btn.dataset.asigUpload;
    const fileInput = document.getElementById('asig-input-'+hid);
    btn.addEventListener('click', ()=> fileInput && fileInput.click());
    if(fileInput) fileInput.addEventListener('change', ()=> uploadAsignacion(p.id, hid, fileInput, btn));
  });
  el.querySelectorAll('[data-asig-correcto]').forEach(btn=>{
    btn.addEventListener('click', ()=> openModalAsignacionCorrecto(p.id, btn.dataset.asigCorrecto));
  });
  el.querySelectorAll('[data-asig-incorrecto]').forEach(btn=>{
    btn.addEventListener('click', ()=> openModalAsignacionIncorrecto(p.id, btn.dataset.asigIncorrecto));
  });

  // Cada dictamen y cada solicitud se crean/eliminan directo contra la API
  // (una ventana por acción, igual que el resto del sistema) — ya no hay
  // edición en línea ni un botón "Guardar" que agrupe varios cambios.
  el.querySelectorAll('.dictamen-block').forEach(block=> bindDictamenBlock(block, p));
}

/* ---------- FLUJO DE RECURSOS DEL PROGRAMA ----------
   Diagrama de barras tipo "flujo" (no es una gráfica de Chart.js, es HTML/
   CSS puro): muestra en una sola vista cómo el Recurso Autorizado inicial
   se reparte entre Comprometido y Disponible sin comprometer, y cuánto de
   eso ya se convirtió en Recurso Dispersado — pensado para leerse de un
   vistazo, en vez de tener que comparar varias tarjetas sueltas. */
/* =========================================================================
   PIPELINE DE FLUJO PRESUPUESTAL (histórico + estado real, sin panel de
   "Situación Actual"/"Notificaciones Recientes": ver nota más abajo)
   Componente oscuro tipo "pipeline/funnel": nodos (barras) conectados por
   listones (ribbons) tipo Sankey dibujados en SVG puro (sin librerías
   nuevas). Los listones y las barras comparten la MISMA rejilla de N
   columnas (grid-template-columns:repeat(N,1fr) en CSS y N franjas iguales
   en el viewBox del SVG), así que quedan alineados sin necesidad de
   calcular píxeles fijos ni depender del ancho real del contenedor. El
   número de nodos NO está hardcodeado en ningún lado (N = nodos.length),
   así que agregar/quitar un nodo del arreglo `nodos` no rompe el layout.

   NOTA: el panel inferior "Situación Actual" (Recurso Disponible Libre +
   alerta de inconsistencias) y "Notificaciones Recientes"
   (generateInsightPrograma) se eliminó de esta vista por decisión del
   usuario. generateInsightPrograma() se deja definida más abajo como
   código muerto inofensivo (ya no se invoca desde ningún lado) por si se
   necesita retomar en el futuro; ningún otro lugar del archivo depende de
   su salida. */
function pipelinePresupuestoHTML(p){
  const autorizadoBase = montoAutorizadoBase(p);
  if(!autorizadoBase){
    return `<div class="card"><div class="empty-state">Aún no hay Monto Autorizado cargado; el flujo del presupuesto aparecerá aquí en cuanto se registre.</div></div>`;
  }
  const comprometido = totalComprometido(p);
  const solicitadoHacienda = totalSolicitadoHacienda(p);
  const autorizadoHacienda = totalAutorizadoPorHacienda(p);
  const pagado = totalPagado(p);
  const disponible = Math.max(totalAutorizadoDisponible(p), 0);
  const comprometidoPendiente = totalComprometidoPendiente(p);
  // "Solicitado a Hacienda" (Estado Real): una vez que Hacienda ya autorizó
  // parte (o todo) el monto de una solicitud, ese monto avanzó a la
  // siguiente etapa del flujo y deja de contar como "todavía solicitado,
  // en espera de que Hacienda lo apruebe" — si no, el mismo peso se vería
  // simultáneamente como "Solicitado" y como "Aprobado por Hacienda" en la
  // barra. El histórico completo (solicitadoHacienda) se sigue mostrando
  // en el subtítulo del nodo y en la tabla de datos, sin perder el dato.
  const solicitadoHaciendaPendiente = totalSolicitadoHaciendaPendiente(p);
  const autorizadoHaciendaPendiente = totalAutorizadoHaciendaPendiente(p);
  const pctDisponible = autorizadoBase>0 ? (disponible/autorizadoBase*100) : 0;
  const pctAutorizadoDeSolicitado = solicitadoHacienda>0 ? (autorizadoHacienda/solicitadoHacienda*100) : 0;

  const nodos = [
    { titulo:'Recurso Autorizado', sub:'Inicial', valor:autorizadoBase },
    { titulo:'Recurso Disponible', sub:`${pctDisponible.toFixed(1)}% del autorizado`, valor:disponible },
    { titulo:'Comprometido', sub:`Histórico: ${fmtMoney(comprometido)}`, valor:comprometidoPendiente },
    { titulo:'Solicitado a Hacienda', sub:`Histórico: ${fmtMoney(solicitadoHacienda)}`, valor:solicitadoHaciendaPendiente },
    { titulo:'Aprobado por Hacienda', sub:`${pctAutorizadoDeSolicitado.toFixed(1)}% de lo solicitado`, valor:autorizadoHaciendaPendiente },
    { titulo:'Dispersado', sub:`${(p.pagos||[]).length} dispersión(es)`, valor:pagado },
  ];

  const BAR_H = 170; // debe coincidir con --pipeline-bar-h en CSS
  const N = nodos.length;
  const maxScale = Math.max(autorizadoBase, comprometido, solicitadoHacienda, autorizadoHacienda, pagado, 1);
  const heightFor = (v)=> v>0 ? Math.max((v/maxScale) * BAR_H, 5) : 0;
  const alturas = nodos.map(n=>heightFor(n.valor));

  // Listones SVG: viewBox de N*100 unidades de ancho por BAR_H de alto.
  // Cada nodo ocupa una franja de 100 unidades (igual que las columnas del
  // grid en CSS); la barra se centra en esa franja con 56% de ancho.
  const slotW = 100;
  const barHalfW = slotW*0.28;
  const gradId = `pipeGrad-${p.id}`;
  let ribbons = '';
  for(let i=0;i<N-1;i++){
    const x1 = i*slotW + slotW/2 + barHalfW;
    const x2 = (i+1)*slotW + slotW/2 - barHalfW;
    const y1top = BAR_H - alturas[i];
    const y2top = BAR_H - alturas[i+1];
    const xm = (x1+x2)/2;
    ribbons += `<path d="M ${x1} ${y1top} C ${xm} ${y1top}, ${xm} ${y2top}, ${x2} ${y2top} L ${x2} ${BAR_H} C ${xm} ${BAR_H}, ${xm} ${BAR_H}, ${x1} ${BAR_H} Z" fill="url(#${gradId})" opacity="0.55"/>`;
  }

  return `
  <div class="pipeline-card pipeline-card-chart">
    <div class="pipeline-eyebrow">Flujo y Estado del Presupuesto<span class="pipeline-scroll-hint">Desliza para ver todo →</span></div>
    <div class="pipeline-scroll">
      <div class="pipeline-bar-row" style="height:${BAR_H}px;">
        <svg class="pipeline-svg" viewBox="0 0 ${N*slotW} ${BAR_H}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="var(--pipeline-guinda)"/>
              <stop offset="100%" stop-color="var(--pipeline-gold)"/>
            </linearGradient>
          </defs>
          ${ribbons}
        </svg>
        <div class="pipeline-bar-grid" style="grid-template-columns:repeat(${N},1fr);">
          ${nodos.map((n,i)=>`
            <div class="pipeline-bar-col">
              <div class="pipeline-bar has-tooltip" data-tooltip="${n.titulo}: ${fmtMoney(n.valor)} · ${n.sub}" style="height:${alturas[i]}px;">${fmtMoney(n.valor)}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="pipeline-label-grid" style="grid-template-columns:repeat(${N},1fr);">
        ${nodos.map(n=>`
          <div class="pipeline-node-label">
            <div class="pipeline-node-title">${n.titulo}</div>
            <div class="pipeline-node-sub">${n.sub}</div>
          </div>`).join('')}
      </div>
    </div>
    <div style="text-align:right;margin-top:14px;">
      <button class="table-toggle" id="toggleTableProg">Ver tabla de datos</button>
    </div>
    <table class="data-table" id="tableProg">
      <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
      <tbody>
        <tr><td>Recurso Autorizado</td><td>${fmtMoney(autorizadoBase)}</td></tr>
        <tr><td>Recurso Disponible</td><td>${fmtMoney(disponible)}</td></tr>
        <tr><td>Recurso Comprometido (histórico)</td><td>${fmtMoney(comprometido)}</td></tr>
        <tr><td>Solicitado a Hacienda (histórico)</td><td>${fmtMoney(solicitadoHacienda)}</td></tr>
        <tr><td>Aprobado por Hacienda (histórico)</td><td>${fmtMoney(autorizadoHacienda)}</td></tr>
        <tr><td>Recurso Dispersado</td><td>${fmtMoney(pagado)}</td></tr>
      </tbody>
    </table>
  </div>`;
}

/* ---------- Recurso Dispersado: fila con referencia a la solicitud de Hacienda ---------- */
function pagoRowHTML(p, g){
  const hac = (p.solicitudesHacienda||[]).find(h=>h.id===g.hacienda_id);
  return `
          <div class="log-row log-row-pago${g.documento_url ? ' log-row-with-doc' : ''}">
            <div class="log-row-body">
              <div class="log-row-icon log-row-icon-pos">$</div>
              <div class="log-row-main">
                <div class="log-row-title">Folio ${esc(g.folio)}</div>
                <div class="lmeta">${fmtDate(g.fecha)}${hac? ` · Solicitud a Hacienda folio ${esc(hac.folio)}` : ''}</div>
              </div>
              <div class="lamount pos">${fmtMoney(g.monto)}</div>
            </div>
            ${docLinkRowHTML(g.documento_url, `/programs/${p.id}/pagos/${g.id}/documento`)}
          </div>`;
}

/* ---------- Solicitudes a Hacienda: estado (pendiente / autorizada / en revisión / incorrecta / lista / dispersada) ----------
   La tarjeta se organiza en tres franjas claramente separadas —
   Solicitud → Autorizado por Hacienda → Archivo de Asignación— cada una
   con su propia etiqueta (.hacienda-stage-label), en vez de un solo bloque
   de texto corrido. Así, con varias solicitudes en pantalla, cada etapa se
   distingue de un vistazo aunque tengan documento adjunto, monto y fecha. */
function haciendaItemHTML(h, p){
  let badge;
  if(h.pagada){
    badge = { cls:'badge-pagada', mod:'is-pagada', label:'Dispersado' };
  } else if(h.asignacion && h.asignacion.estatus==='correcto'){
    badge = { cls:'badge-autorizada', mod:'is-autorizada', label:'Listo para Dispersión' };
  } else if(h.asignacion && h.asignacion.estatus==='incorrecto'){
    badge = { cls:'badge-incorrecta', mod:'is-incorrecta', label:'Archivo de Asignación Incorrecto' };
  } else if(h.asignacion && h.asignacion.estatus==='revision'){
    badge = { cls:'badge-revision', mod:'is-revision', label:'Archivo de Asignación en Revisión' };
  } else if(h.autorizacion){
    badge = { cls:'badge-autorizada', mod:'is-autorizada', label:'Autorizado por Hacienda' };
  } else {
    badge = { cls:'badge-pendiente', mod:'is-pendiente', label:'Pendiente de autorización' };
  }
  // Etiqueta del dictamen vinculado (si lo hay), para que se vea a simple
  // vista a qué dictamen corresponde el compromiso que se está tramitando.
  const dictamenVinculado = h.dictamen_id!=null && p ? (p.dictamenes||[]).find(d=>Number(d.id)===Number(h.dictamen_id)) : null;
  const dictamenLabel = dictamenVinculado
    ? `Dictamen ${dictamenVinculado.numero!=null ? dictamenVinculado.numero : ''}`.trim()
    : (h.dictamen_id!=null ? `Dictamen #${h.dictamen_id}` : null);
  return `
  <div class="hacienda-item ${badge.mod}" data-hacienda-item="${h.id}">
    <div class="hacienda-item-head">
      <div class="hacienda-item-main">
        <div class="hacienda-item-eyebrow">Folio</div>
        <div class="hacienda-item-title">${esc(h.folio)}</div>
        <div class="lmeta">Solicitado: ${fmtDateOnly(h.fecha)}${dictamenLabel ? ` · Vinculado a ${esc(dictamenLabel)}` : ' · Sin vincular a un dictamen específico'}</div>
      </div>
      <div class="hacienda-item-amount">
        <div class="hacienda-item-monto">${fmtMoney(h.monto)}</div>
        <span class="badge-pill ${badge.cls}">${badge.label}</span>
      </div>
      <div class="hacienda-item-actions">
        <button class="btn btn-outline btn-sm" data-editar-hacienda="${h.id}">Editar</button>
        <button class="btn btn-danger btn-sm" data-del-hacienda="${h.id}">Eliminar</button>
      </div>
    </div>
    ${docLinkRowHTML(h.documento_url, `/programs/${p.id}/hacienda/${h.id}/documento`)}

    ${h.autorizacion ? `
      <div class="hacienda-stage">
        <div class="hacienda-stage-label">Autorizado por Hacienda</div>
        <div class="hacienda-stage-body">
          <div class="hacienda-stage-amount">${fmtMoney(h.autorizacion.monto_autorizado)}</div>
          <div class="lmeta">${fmtDateOnly(h.autorizacion.fecha_autorizacion)}</div>
        </div>
        ${docLinkRowHTML(h.autorizacion.documento_url, `/programs/${p.id}/hacienda/${h.id}/autorizacion/documento`)}
      </div>
    ` : `
      <div class="hacienda-stage hacienda-stage-empty">
        <div class="hacienda-stage-label">Autorizado por Hacienda</div>
        <button class="btn btn-gold btn-sm" data-autorizar-hacienda="${h.id}">+ Registrar Autorización</button>
      </div>
    `}
    ${h.autorizacion ? asignacionBlockHTML(h) : ''}
  </div>`;
}

/* ---------- Archivo de Asignación: bloque de carga / revisión por solicitud a Hacienda ----------
   Solo se dibuja cuando la solicitud ya tiene su Autorización de Hacienda
   registrada (ver haciendaItemHTML). Estados:
     sin registro   -> botón para cargar el archivo.
     'revision'     -> botones Marcar Correcto / Marcar Incorrecto.
     'incorrecto'   -> motivo + fecha de revisión, botón para cargar un
                       nuevo documento (regresa a 'revision').
     'correcto'     -> folio + fecha de revisión (listo para dispersión). */
function asignacionBlockHTML(h){
  const a = h.asignacion;
  const hid = h.id;
  if(!a){
    return `
    <div class="hacienda-stage hacienda-stage-empty">
      <div class="hacienda-stage-label">Archivo de Asignación</div>
      <input type="file" id="asig-input-${hid}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" hidden>
      <button class="btn btn-outline btn-sm" data-asig-upload="${hid}">Cargar Archivo de Asignación</button>
    </div>`;
  }
  const cargaInfo = `<div class="lmeta-doc-row">
    <span class="lmeta">Cargado: ${fmtDateOnly(a.fecha_carga)}</span>
    ${a.documento_url ? `<span class="doc-link-inline">
      <a class="btn-ver-documento" href="${a.documento_url}" target="_blank" rel="noopener">Ver Documento</a>
      <button type="button" class="icon-btn" data-del-doc="/programs/${h.programa_id}/hacienda/${hid}/asignacion/documento" title="Eliminar documento">✕</button>
    </span>` : ''}
  </div>`;

  if(a.estatus==='revision'){
    return `
    <div class="hacienda-stage">
      <div class="hacienda-stage-label">Archivo de Asignación <span class="badge-pill badge-revision">En Revisión</span></div>
      ${cargaInfo}
      <div class="asignacion-actions">
        <button class="btn btn-outline btn-sm" data-asig-correcto="${hid}">Marcar Correcto</button>
        <button class="btn btn-danger btn-sm" data-asig-incorrecto="${hid}">Marcar Incorrecto</button>
      </div>
    </div>`;
  }
  if(a.estatus==='incorrecto'){
    return `
    <div class="hacienda-stage">
      <div class="hacienda-stage-label">Archivo de Asignación <span class="badge-pill badge-incorrecta">Incorrecto</span></div>
      ${cargaInfo}
      <div class="lmeta">Motivo: ${esc(a.motivo_rechazo||'')} · ${fmtDateOnly(a.fecha_revision)}</div>
      <input type="file" id="asig-input-${hid}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" hidden>
      <div class="asignacion-actions">
        <button class="btn btn-outline btn-sm" data-asig-upload="${hid}">Cargar Nuevo Documento</button>
      </div>
    </div>`;
  }
  // correcto
  return `
    <div class="hacienda-stage">
      <div class="hacienda-stage-label">Archivo de Asignación <span class="badge-pill badge-autorizada">Correcto</span></div>
      ${cargaInfo}
      <div class="lmeta">Folio proporcionado: <b>${esc(a.folio||'')}</b> · ${fmtDateOnly(a.fecha_revision)}</div>
    </div>`;
}

/* ---------- Documentos: resumen de todos los archivos cargados en el programa ---------- */
function documentosCount(p){
  let n = 0;
  if(p.monto_autorizado_documento_url) n++;
  n += (p.modificaciones||[]).filter(m=>m.documento_url).length;
  (p.dictamenes||[]).forEach(d=>{ if(d.acta_documento_url) n++; });
  (p.solicitudesHacienda||[]).forEach(h=>{
    if(h.documento_url) n++;
    if(h.autorizacion && h.autorizacion.documento_url) n++;
    if(h.asignacion && h.asignacion.documento_url) n++;
  });
  n += (p.pagos||[]).filter(g=>g.documento_url).length;
  return n;
}
function documentosSectionBody(p){
  const rows = [];
  if(p.monto_autorizado_documento_url){
    rows.push({ tipo:'Monto Autorizado', ref:'Referencia '+(p.monto_autorizado_referencia||'S/R'), fecha:p.monto_autorizado_fecha, url:p.monto_autorizado_documento_url });
  }
  (p.modificaciones||[]).forEach(m=>{
    if(m.documento_url) rows.push({ tipo:`Modificación (${m.tipo})`, ref:m.motivo||'', fecha:m.created_at, url:m.documento_url });
  });
  (p.dictamenes||[]).forEach(d=>{
    if(d.acta_documento_url) rows.push({ tipo:'Acta Firmada de Dictamen', ref:d.numero!=null? ('Dictamen '+d.numero) : '', fecha:d.acta_fecha_carga, url:d.acta_documento_url });
  });
  (p.solicitudesHacienda||[]).forEach(h=>{
    if(h.documento_url) rows.push({ tipo:'Solicitud a Hacienda', ref:'Folio '+h.folio, fecha:h.fecha, url:h.documento_url });
    if(h.autorizacion && h.autorizacion.documento_url) rows.push({ tipo:'Autorizado por Hacienda', ref:'Folio '+h.folio, fecha:h.autorizacion.fecha_autorizacion, url:h.autorizacion.documento_url });
    if(h.asignacion && h.asignacion.documento_url) rows.push({ tipo:'Archivo de Asignación', ref:'Folio '+h.folio, fecha:h.asignacion.fecha_carga, url:h.asignacion.documento_url });
  });
  (p.pagos||[]).forEach(g=>{
    if(g.documento_url) rows.push({ tipo:'Dispersión', ref:'Folio '+g.folio, fecha:g.fecha, url:g.documento_url });
  });

  if(!rows.length) return `<div class="empty-state">Sin documentos cargados todavía.</div>`;
  rows.sort((a,b)=> new Date(b.fecha||0) - new Date(a.fecha||0));
  return `<div class="log-list">${rows.map(r=>`
    <div class="log-row log-row-doc">
      <div class="log-row-icon log-row-icon-doc">📄</div>
      <div class="log-row-main"><div class="log-row-title">${esc(r.tipo)}</div><div class="lmeta">${esc(r.ref)} · ${fmtDate(r.fecha)}</div></div>
      <a class="btn-ver-documento" href="${r.url}" target="_blank" rel="noopener">Ver Documento</a>
    </div>`).join('')}</div>`;
}

/* ---------- Dictaminación: cada Dictamen y cada Solicitud se crean y
   eliminan directo contra la API, uno por uno y con su propia ventana —
   igual que "Cargar Monto Autorizado" o "Registrar Modificación". Ya no
   hay edición en línea ni un botón que agrupe varios cambios en un solo
   guardado (ver openModalNuevoDictamen / openModalNuevaSolicitud). Los
   ids "tmp-..." de una capa de borrador anterior ya no existen: todo lo
   que aparece en pantalla ya está guardado en el servidor. ---------- */
let __tmpSeq = 0;
function tmpId(){ return 'tmp-' + (++__tmpSeq) + '-' + Date.now(); }
function esTemporal(id){ return String(id).startsWith('tmp-'); }

function dictamenBlockHTML(p,d){
  const personas = (d.solicitudes||[]).reduce((s,so)=>s+Number(so.personas||0),0);
  const montoBeneficiario = Number(p.monto_beneficiario||0);
  // Recurso comprometido: Personas × (Pagos × Monto por Beneficiario),
  // sumado por cada solicitud del dictamen — no solo Personas × Monto, para
  // que una solicitud con varios pagos por persona cuente lo que realmente
  // compromete.
  const comprometido = (d.solicitudes||[]).reduce((s,so)=> s + Number(so.personas||0)*Number(so.cantidad_pagos||1)*montoBeneficiario, 0);
  const titulo = 'Dictamen ' + d.numero;
  // Dispersión real de ESTE dictamen (seguimiento inteligente): cuántas de
  // sus propias personas ya quedaron cubiertas por Solicitudes a Hacienda
  // vinculadas a él y ya dispersadas — ver dispersionPorDictamen().
  const disp = dispersionPorDictamen(p, d.id);
  return `
  <div class="dictamen-block" data-dictamen-block="${d.id}">
    <div class="dictamen-head">
      <h4>${titulo}</h4>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div class="chip">${fmtMoney(d.monto_autorizado)} autorizados</div>
        <input type="file" id="acta-input-${d.id}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" hidden>
        <button class="btn btn-outline btn-sm" data-upload-acta="${d.id}">${d.acta_documento_url? 'Reemplazar Acta Firmada':'Cargar Acta Firmada de Dictamen'}</button>
        ${d.acta_documento_url ? `<a class="btn-ver-documento" href="${d.acta_documento_url}" target="_blank" rel="noopener">Ver Acta</a>
        <button type="button" class="icon-btn" data-del-doc="/programs/${p.id}/dictamenes/${d.id}/acta" title="Eliminar Acta Firmada">✕</button>` : ''}
        <button class="btn btn-danger btn-sm" data-del-dictamen="${d.id}">Eliminar Dictamen</button>
      </div>
    </div>
    <div class="dictamen-meta">
      <div>Registro del dictamen: <b>${fmtDateOnly(d.fecha_dictamen)}</b></div>
    </div>
    <div class="solicitudes-list">
      ${(d.solicitudes||[]).map(s=>solicitudRowHTML(p,d.id,s)).join('') || `<div class="field-hint" style="margin:0 0 10px;color:var(--text-on-brand);opacity:0.75;">Este dictamen todavía no tiene solicitudes.</div>`}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
      <button class="btn btn-ghost btn-sm" data-add-solicitud>+ Agregar Solicitud</button>
    </div>
    <div class="dictamen-total">
      <div>Personas: <b>${fmtNum(personas)}</b></div>
      <div>Recurso comprometido: <b>${fmtMoney(comprometido)}</b></div>
    </div>
    ${disp ? `
    <div style="margin-top:10px;">
      <span class="badge-pill ${disp.personasDispersadas>0 ? 'badge-autorizada' : 'badge-pendiente'}" title="Seguimiento interno: cuánto de este dictamen ya fue dispersado entre sus propias personas, usando las Solicitudes a Hacienda vinculadas a él">
        Dispersión del dictamen: ${fmtNum(disp.personasDispersadas)} de ${fmtNum(personas)} persona${personas===1?'':'s'} (${fmtMoney(disp.montoDispersado)} de ${fmtMoney(comprometido)})
      </span>
    </div>` : ''}
  </div>`;
}

/* Fila de solo lectura: la Solicitud se crea/elimina vía modal
   (openModalNuevaSolicitud), ya no se edita en línea. */
function solicitudRowHTML(p, dicId, s){
  const montoSolicitud = Number(s.personas||0) * Number(s.cantidad_pagos||1) * Number(p.monto_beneficiario||0);
  return `
      <div class="solicitud-item" data-solicitud-item="${s.id}">
        <div class="sol-info">
          <span>Solicitud <b>${s.numero}</b></span>
          <span>Personas: <b>${fmtNum(s.personas||0)}</b></span>
          <span>Pagos: <b>${fmtNum(s.cantidad_pagos||1)}</b></span>
          <span>Monto: <b>${fmtMoney(montoSolicitud)}</b></span>
        </div>
        <button class="icon-btn" title="Eliminar solicitud" data-del-solicitud="${s.id}">✕</button>
      </div>`;
}

function bindDictamenBlock(block, p){
  const pid = p.id;
  const dicId = block.dataset.dictamenBlock;

  block.querySelector('[data-del-dictamen]').addEventListener('click', (e)=> handleDeleteDictamen(pid, dicId, e.currentTarget));
  block.querySelector('[data-add-solicitud]').addEventListener('click', ()=> openModalNuevaSolicitud(p, dicId));
  block.querySelectorAll('[data-del-solicitud]').forEach(btn=>{
    btn.addEventListener('click', (e)=> handleDeleteSolicitud(pid, dicId, btn.dataset.delSolicitud, e.currentTarget));
  });

  const actaBtn = block.querySelector('[data-upload-acta]');
  if(actaBtn){
    const fileInput = document.getElementById('acta-input-'+dicId);
    actaBtn.addEventListener('click', ()=> fileInput && fileInput.click());
    if(fileInput) fileInput.addEventListener('change', ()=> uploadActaDictamen(pid, dicId, fileInput, actaBtn));
  }
}

/* ---- Agregar Dictamen (ventana): monto autorizado + fecha de registro +
   Acta Firmada opcional en un solo paso, igual que Cargar Monto Autorizado
   / Registrar Modificación. Si no se adjunta el acta, el dictamen se crea
   igual y se puede cargar después desde su propia tarjeta. ---- */
function openModalNuevoDictamen(pid){
  openModal(`
    <div class="modal-header"><h3>Agregar Dictamen</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Monto Autorizado del Dictamen</label><input type="text" data-money id="dn-monto" placeholder="$0.00"></div>
        <div class="field"><label>Registro del dictamen</label><input type="date" id="dn-fecha"></div>
        ${fileDropZoneHTML('dn-doc','Acta Firmada de Dictamen (opcional)','.pdf,.jpg,.jpeg,.png,.doc,.docx',null,'Acta Firmada de Dictamen')}
        <div class="field-hint">Si no tienes el acta a la mano, puedes cargarla después desde la tarjeta del dictamen.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" id="submitDictamen">Crear Dictamen</button>
    </div>
  `);
  bindDropZone('dn-doc');
  document.getElementById('submitDictamen').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const monto = numValue(document.getElementById('dn-monto'));
    const fecha = document.getElementById('dn-fecha').value;
    const archivo = document.getElementById('dn-doc').files[0];
    if(!monto) return;
    const fd = new FormData();
    fd.append('monto_autorizado', monto);
    if(fecha) fd.append('fecha_dictamen', fecha);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/dictamenes`, fd), 'Dictamen creado correctamente.'), archivo ? 'Subiendo documento…' : 'Creando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---- Agregar Solicitud (ventana): Cantidad de Personas + Cantidad de
   Pagos. Ya no captura Compromiso ni Hora — ver petición del usuario.
   Antes de enviar, valida que el dictamen no quede comprometido por
   encima de su propio Monto Autorizado: Personas × (Pagos × Monto por
   Beneficiario), igual que la validación de Recurso Autorizado a nivel
   programa (advierte y pide confirmar, no bloquea de forma dura). ---- */
function openModalNuevaSolicitud(p, dicId){
  const dictamen = (p.dictamenes||[]).find(d=>String(d.id)===String(dicId));
  const maxPagos = Math.max(1, Number(p.cantidad_pagos||1));
  const opciones = Array.from({length:maxPagos}, (_,i)=>i+1)
    .map(n=> `<option value="${n}">${n===1?'1 pago':n+' pagos'}</option>`).join('');
  openModal(`
    <div class="modal-header"><h3>Agregar Solicitud</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Cantidad de Personas</label><input type="text" data-int id="sn-personas" placeholder="0"></div>
        <div class="field"><label>Cantidad de Pagos</label><select id="sn-pagos">${opciones}</select></div>
      </div>
      <div id="sn-error" style="color:var(--red);font-size:12.5px;font-weight:700;display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" id="submitSolicitud">Agregar Solicitud</button>
    </div>
  `);
  document.getElementById('submitSolicitud').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const personas = numValue(document.getElementById('sn-personas'));
    const cantidadPagos = Number(document.getElementById('sn-pagos').value) || 1;
    const err = document.getElementById('sn-error');
    if(!personas || personas < 1){
      err.textContent = 'La Cantidad de Personas debe ser al menos 1.';
      err.style.display = 'block';
      return;
    }

    const montoBeneficiario = Number(p.monto_beneficiario||0);
    const comprometidoActual = (dictamen?.solicitudes||[]).reduce((s,so)=> s + Number(so.personas||0)*Number(so.cantidad_pagos||1)*montoBeneficiario, 0);
    const comprometidoNuevo = comprometidoActual + (personas * cantidadPagos * montoBeneficiario);
    const autorizado = Number(dictamen?.monto_autorizado||0);
    if(comprometidoNuevo > autorizado + 0.01){
      const excedente = comprometidoNuevo - autorizado;
      const continuar = await confirmAction({
        title: 'El dictamen no alcanza',
        message: `Con esta solicitud el dictamen comprometería ${fmtMoney(comprometidoNuevo)}, pero solo tiene ${fmtMoney(autorizado)} autorizados (excede por ${fmtMoney(excedente)}). Puedes cancelar y corregir el Monto Autorizado del dictamen, o agregar la solicitud de todas formas.`,
        confirmText: 'Agregar de todas formas',
        danger: false,
      });
      if(!continuar) return;
    }

    try{
      await withLoading(btn, ()=>safeCall(()=>Api.post(`/programs/${p.id}/dictamenes/${dicId}/solicitudes`, {personas, cantidad_pagos: cantidadPagos}), 'Solicitud agregada correctamente.'), 'Guardando…');
      closeModal();
      await refreshOneProgram(p.id); renderDetalle(p.id);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

async function handleDeleteSolicitud(pid, dicId, solId, btn){
  const ok = await confirmAction({
    title: 'Eliminar Solicitud',
    message: '¿Eliminar esta solicitud? Esta acción no se puede deshacer.',
    confirmText: 'Sí, Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(`/programs/${pid}/dictamenes/${dicId}/solicitudes/${solId}`), 'Solicitud eliminada.'), 'Eliminando…');
  await refreshOneProgram(pid); renderDetalle(pid);
}

async function handleDeleteDictamen(pid, dicId, btn){
  const ok = await confirmAction({
    title: 'Eliminar Dictamen',
    message: '¿Eliminar este dictamen y todas sus solicitudes? Esta acción no se puede deshacer.',
    confirmText: 'Sí, Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(`/programs/${pid}/dictamenes/${dicId}`), 'Dictamen eliminado.'), 'Eliminando…');
  await refreshOneProgram(pid); renderDetalle(pid);
}

/* ---- Acta Firmada de Dictamen: subida directa al seleccionar el archivo ---- */
async function uploadActaDictamen(pid, dicId, fileInput, btn){
  const archivo = fileInput.files[0];
  if(!archivo) return;
  const fd = new FormData();
  fd.append('documento', archivo);
  try{
    await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/dictamenes/${dicId}/acta`, fd), 'Acta Firmada de Dictamen cargada.'), 'Subiendo…');
    await refreshOneProgram(pid); renderDetalle(pid);
  }catch(e){ /* el error ya se mostró vía safeCall */ }
  finally{ fileInput.value = ''; }
}

/* =========================================================================
   ANÁLISIS DINÁMICO — texto que describe la situación actual de la gráfica.
   Se recalcula cada vez que se renderiza, a partir de los datos vigentes,
   siguiendo el flujo real del recurso: Autorizado → Comprometido →
   Solicitado a Hacienda → Dispersado.
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
      html += `<p>De ese recurso comprometido, ningún programa ha enviado todavía una solicitud a Hacienda; ese es el siguiente paso pendiente antes de poder dispersar los pagos.</p>`;
    } else {
      html += `<p>De lo comprometido se ha solicitado a Hacienda <b>${fmtMoney(totHac)}</b> (<b>${pctSolicitado.toFixed(1)}%</b>), y de lo solicitado se ha dispersado <b>${fmtMoney(totPag)}</b> (<b>${pctPagadoDeSolicitado.toFixed(1)}%</b>). Quedan <b>${fmtMoney(pendienteComprometido)}</b> pendientes por dispersar del total comprometido.</p>`;
    }
  }

  if(totComp>0 && mayor){
    html += `<p>El programa con mayor recurso comprometido es <b>${mayor.nombre}</b>, con <b>${fmtMoney(totalComprometido(mayor))}</b>.</p>`;
  }

  if(totHac > totComp + 0.01){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: el total solicitado a Hacienda (${fmtMoney(totHac)}) supera el total comprometido (${fmtMoney(totComp)}). Conviene revisar los trámites registrados.</p>`;
  }
  if(totPag > totHac + 0.01 && totHac>0){
    html += `<p style="color:#FF9FB0;font-weight:700;">Atención: el total dispersado (${fmtMoney(totPag)}) supera lo solicitado a Hacienda (${fmtMoney(totHac)}). Conviene revisar las dispersiones registradas.</p>`;
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
    return `<ul class="insight-bullets"><li>Este programa todavía no tiene Monto Autorizado cargado, por lo que aún no hay cifras que comparar en la gráfica. Carga el monto autorizado para comenzar el seguimiento presupuestal.</li></ul>`;
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
    html += `<li>Con un recurso autorizado de <b>${fmtMoney(autorizado)}</b>, este programa aún no tiene dictámenes registrados: dictaminar es el primer paso pendiente antes de poder comprometer recurso.</li>`;
    if(disponible<0){
      html += `<li style="color:#FF9FB0;font-weight:700;">El programa excede su recurso autorizado por <b>${fmtMoney(Math.abs(disponible))}</b>.</li>`;
    }
    return `<ul class="insight-bullets">${html}</ul>`;
  }

  html += `<li>De los <b>${fmtMoney(autorizado)}</b> autorizados, se han comprometido <b>${fmtMoney(comprometido)}</b> a través de <b>${numDictamenes}</b> dictamen${numDictamenes===1?'':'es'} y <b>${fmtNum(personas)}</b> persona${personas===1?'':'s'} dictaminada${personas===1?'':'s'} (<b>${pctComprometido.toFixed(1)}%</b> del autorizado).</li>`;

  if(numTramitesHacienda===0){
    html += `<li>Aún no se ha enviado ninguna solicitud a Hacienda; el siguiente paso es tramitar la ministración del recurso comprometido.</li>`;
  } else {
    html += `<li>Se ha solicitado a Hacienda <b>${fmtMoney(solicitado)}</b> en <b>${numTramitesHacienda}</b> trámite${numTramitesHacienda===1?'':'s'} (<b>${pctSolicitado.toFixed(1)}%</b> de lo comprometido).</li>`;
  }

  if(numPagos===0){
    html += solicitado>0
      ? `<li>Todavía no se registra ninguna dispersión; el recurso solicitado a Hacienda sigue pendiente de dispersión.</li>`
      : `<li>Todavía no se registra ninguna dispersión a beneficiarios.</li>`;
  } else {
    html += `<li>Se han dispersado <b>${fmtMoney(pagado)}</b> en <b>${numPagos}</b> dispersión${numPagos===1?'':'es'} (<b>${pctPagado.toFixed(1)}%</b> de lo solicitado a Hacienda), quedando <b>${fmtMoney(Math.max(comprometido-pagado,0))}</b> pendientes por dispersar del total comprometido.</li>`;
  }

  if(solicitado > comprometido + 0.01){
    html += `<li style="color:#FF9FB0;font-weight:700;">Atención: lo solicitado a Hacienda (${fmtMoney(solicitado)}) supera el recurso comprometido (${fmtMoney(comprometido)}). Conviene revisar los trámites registrados.</li>`;
  }
  if(pagado > solicitado + 0.01 && solicitado>0){
    html += `<li style="color:#FF9FB0;font-weight:700;">Atención: el recurso dispersado (${fmtMoney(pagado)}) supera lo solicitado a Hacienda (${fmtMoney(solicitado)}). Conviene revisar las dispersiones registradas.</li>`;
  }

  if(disponible<0){
    html += `<li style="color:#FF9FB0;font-weight:700;">El programa excede su recurso autorizado por <b>${fmtMoney(Math.abs(disponible))}</b>. Se recomienda registrar una ampliación o revisar los dictámenes.</li>`;
  } else {
    html += `<li style="color:#7FE3B4;font-weight:700;">Recurso disponible sin comprometer: ${fmtMoney(disponible)}.</li>`;
  }

  return `<ul class="insight-bullets">${html}</ul>`;
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
      {label:'Dispersado', data:dataPag, backgroundColor:COLOR_PAGADO, borderRadius:6, maxBarThickness:40},
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
function openModal(html, opts){
  modalBox.innerHTML = html;
  modalBox.classList.toggle('modal-wide', !!(opts && opts.wide));
  bindNumberInputs(modalBox);
  overlay.classList.add('show');
}
function closeModal(){ overlay.classList.remove('show'); modalBox.innerHTML=''; modalBox.classList.remove('modal-wide'); }
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
      <div class="form-grid cols-3">
        <div class="field"><label>Cantidad por Beneficiario</label><input type="text" data-money id="f-montoBenef" placeholder="$0.00"></div>
        <div class="field"><label>Meta de Beneficiarios</label><input type="text" data-int id="f-meta" placeholder="0"></div>
        <div class="field"><label>Cantidad de Pagos por Beneficiario</label><input type="text" data-int id="f-cantidadPagos" placeholder="1" value="1"></div>
      </div>
      <div id="f-error" style="color:var(--red);font-size:12.5px;font-weight:700;display:none;"></div>
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
  const montoBenef = numValue(document.getElementById('f-montoBenef'));
  const meta = numValue(document.getElementById('f-meta'));
  const cantidadPagosInput = document.getElementById('f-cantidadPagos');
  const cantidadPagos = numValue(cantidadPagosInput) || 1;
  const err = document.getElementById('f-error');

  if(!codigo || !nombre || !montoBenef || !meta){
    err.textContent = 'Completa todos los campos para continuar.';
    err.style.display = 'block';
    return;
  }
  if(cantidadPagos < 1){
    err.textContent = 'La cantidad de pagos por beneficiario debe ser al menos 1.';
    err.style.display = 'block';
    return;
  }
  try{
    const programa = await withLoading(btn, ()=>Api.post('/programs', { unidad_codigo:codigo, nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta, cantidad_pagos:cantidadPagos }), 'Creando…');
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
        <div class="field"><label>Nombre del Proyecto</label><input type="text" id="e-nombre" value="${esc(p.nombre)}"></div>
      </div>
      <div class="form-grid cols-3">
        <div class="field"><label>Cantidad por Beneficiario</label><input type="text" data-money id="e-montoBenef" value="${fmtInputMoney(p.monto_beneficiario)}"></div>
        <div class="field"><label>Meta de Beneficiarios</label><input type="text" data-int id="e-meta" value="${fmtInputInt(p.meta_beneficiarios)}"></div>
        <div class="field"><label>Cantidad de Pagos por Beneficiario</label><input type="text" data-int id="e-cantidadPagos" value="${fmtInputInt(cantidadPagosDe(p))}"></div>
      </div>
      <div class="field-hint">La Unidad Presupuestal y la clave (${esc(p.clave)}) no se pueden cambiar una vez creado el programa.</div>
      <div id="e-error" style="color:var(--red);font-size:12.5px;font-weight:700;display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitEditarPrograma">Guardar Cambios</button>
    </div>
  `);
  document.getElementById('submitEditarPrograma').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const nombre = document.getElementById('e-nombre').value.trim();
    const montoBenef = numValue(document.getElementById('e-montoBenef'));
    const meta = numValue(document.getElementById('e-meta'));
    const cantidadPagos = numValue(document.getElementById('e-cantidadPagos')) || 1;
    const err = document.getElementById('e-error');

    if(!nombre || !montoBenef || !meta){
      err.textContent = 'Completa todos los campos para continuar.';
      err.style.display = 'block';
      return;
    }
    if(cantidadPagos < 1){
      err.textContent = 'La cantidad de pagos por beneficiario debe ser al menos 1.';
      err.style.display = 'block';
      return;
    }
    try{
      await withLoading(btn, ()=>Api.patch(`/programs/${p.id}`, { nombre, monto_beneficiario:montoBenef, meta_beneficiarios:meta, cantidad_pagos:cantidadPagos }), 'Guardando…');
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

/* ---- Eliminar Programa ----
   Usa el mismo modal de confirmación simple (confirmAction) que el resto
   de las eliminaciones del sistema — icono + título + mensaje breve — en
   vez de un modal a medida, para que "Eliminar" se vea y se sienta igual
   en cualquier parte de la app. */
async function openModalEliminarPrograma(p){
  const btn = document.getElementById('btnEliminarPrograma');
  const ok = await confirmAction({
    title: 'Eliminar Programa',
    message: `Se eliminará permanentemente “${esc(p.nombre)}” (${esc(p.clave)}) y todos sus movimientos: monto autorizado, modificaciones, dictámenes, solicitudes, trámites a Hacienda, autorizaciones, archivos de asignación y dispersiones. Esta acción no se puede deshacer.`,
    confirmText: 'Eliminar',
  });
  if(!ok) return;
  try{
    await withLoading(btn, ()=>Api.del(`/programs/${p.id}`), 'Eliminando…');
    toast('Programa eliminado.');
    state.programs = state.programs.filter(x=>x.id!==p.id);
    navigate({name:'programas'});
  }catch(e){
    toast(e.message || 'No se pudo eliminar el programa.', true);
  }
}

/* ---- Cargar Monto Autorizado ---- */
function openModalCargarMonto(pid){
  openModal(`
    <div class="modal-header"><h3>Cargar Monto Autorizado</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Monto Autorizado</label><input type="text" data-money id="m-monto" placeholder="$0.00"></div>
        <div class="field"><label>Referencia / Oficio</label><input type="text" id="m-ref" placeholder="Ej. OF-DGPPE-0001-2026"></div>
        ${fileDropZoneHTML('m-doc','Oficio (documento)','.pdf,.jpg,.jpeg,.png,.doc,.docx')}
        <div class="field-hint">Este monto será la base de referencia para las gráficas y cálculos del programa.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-gold" id="submitMonto">Guardar Monto</button>
    </div>
  `);
  bindDropZone('m-doc');
  document.getElementById('submitMonto').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const monto = numValue(document.getElementById('m-monto'));
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
        <div class="field"><label>Monto</label><input type="text" data-money id="mo-monto" placeholder="$0.00"></div>
        <div class="field"><label>Motivo</label><textarea id="mo-motivo" rows="2" placeholder="Describe el motivo de la modificación…"></textarea></div>
        ${fileDropZoneHTML('mo-doc','Oficio (documento)','.pdf,.jpg,.jpeg,.png,.doc,.docx')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitMod">Registrar</button>
    </div>
  `);
  bindDropZone('mo-doc');
  document.getElementById('submitMod').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const tipo = document.getElementById('mo-tipo').value;
    const monto = numValue(document.getElementById('mo-monto'));
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
  const p = state.programs.find(x=>x.id===pid);
  const dictamenes = (p && p.dictamenes) || [];
  openModal(`
    <div class="modal-header"><h3>Registrar Solicitud a Hacienda</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Folio</label><input type="text" id="h-folio" placeholder="Ej. SH-2026-0001"></div>
        <div class="field"><label>Monto Solicitado</label><input type="text" data-money id="h-monto" placeholder="$0.00"></div>
        <div class="field">
          <label>Dictamen relacionado (opcional)</label>
          <select id="h-dictamen">
            <option value="">— Sin vincular a un dictamen específico —</option>
            ${dictamenes.filter(d=>!esTemporal(d.id)).map(d=>{
              const personasD = (d.solicitudes||[]).reduce((s,so)=>s+Number(so.personas||0),0);
              const comprometidoD = personasD * Number(p.monto_beneficiario||0);
              const label = `Dictamen ${d.numero!=null?d.numero:d.id} del ${d.fecha_dictamen ? fmtDateOnly(d.fecha_dictamen) : 'S/F'} — Comprometido: ${fmtMoney(comprometidoD)}`;
              return `<option value="${d.id}">${esc(label)}</option>`;
            }).join('')}
          </select>
          <div class="field-hint">Vincular esta solicitud a un dictamen permite dar seguimiento a cuánto de ESE dictamen ya fue dispersado entre sus propias personas.</div>
        </div>
        <div class="field"><label>Solicitud de recurso a Hacienda</label><input type="date" id="h-fecha"></div>
        ${fileDropZoneHTML('h-doc','Documento que avala la solicitud','.pdf,.jpg,.jpeg,.png,.doc,.docx')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitHac">Registrar</button>
    </div>
  `);
  bindDropZone('h-doc');
  document.getElementById('submitHac').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const folio = document.getElementById('h-folio').value.trim();
    const monto = numValue(document.getElementById('h-monto'));
    const dictamenId = document.getElementById('h-dictamen').value;
    const fecha = document.getElementById('h-fecha').value || null;
    const archivo = document.getElementById('h-doc').files[0];
    if(!monto) return;

    /* Validación: no solicitar a Hacienda más de lo que sigue comprometido
       y aún no se ha solicitado. No se usa un modal de confirmación aquí
       porque este formulario YA está dentro de un modal (Registrar
       Solicitud a Hacienda) y solo hay un modal a la vez en el sistema; en
       vez de tapar el formulario con otro, se avisa con un toast y se deja
       el formulario abierto para corregir el monto. */
    if(p){
      const disponibleParaSolicitar = Math.max(totalComprometido(p) - totalSolicitadoHacienda(p), 0);
      if(monto > disponibleParaSolicitar + 0.01){
        toast(`El monto (${fmtMoney(monto)}) supera el recurso comprometido pendiente de solicitar (${fmtMoney(disponibleParaSolicitar)}). Ajusta el monto o registra primero un dictamen/ampliación adicional.`, true);
        return;
      }
    }

    const fd = new FormData();
    fd.append('folio', folio);
    fd.append('monto', monto);
    if(dictamenId) fd.append('dictamen_id', dictamenId);
    if(fecha) fd.append('fecha', fecha);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/hacienda`, fd), 'Solicitud a Hacienda registrada.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---- Editar Solicitud a Hacienda ----
   Folio, monto, fecha y el dictamen vinculado — no toca el documento, que
   se reemplaza/elimina aparte con el botón "Ver Documento"/✕ ya existente. */
function openModalEditarHacienda(pid, hacId){
  const p = state.programs.find(x=>x.id===pid);
  const hac = p && (p.solicitudesHacienda||[]).find(h=>String(h.id)===String(hacId));
  if(!hac) return;
  const dictamenes = (p && p.dictamenes) || [];
  openModal(`
    <div class="modal-header"><h3>Editar Solicitud a Hacienda</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Folio</label><input type="text" id="eh-folio" value="${esc(hac.folio||'')}"></div>
        <div class="field"><label>Monto Solicitado</label><input type="text" data-money id="eh-monto" value="${fmtInputMoney(hac.monto)}"></div>
        <div class="field">
          <label>Dictamen relacionado (opcional)</label>
          <select id="eh-dictamen">
            <option value="">— Sin vincular a un dictamen específico —</option>
            ${dictamenes.filter(d=>!esTemporal(d.id)).map(d=>{
              const personasD = (d.solicitudes||[]).reduce((s,so)=>s+Number(so.personas||0),0);
              const comprometidoD = personasD * Number(p.monto_beneficiario||0);
              const label = `Dictamen ${d.numero!=null?d.numero:d.id} del ${d.fecha_dictamen ? fmtDateOnly(d.fecha_dictamen) : 'S/F'} — Comprometido: ${fmtMoney(comprometidoD)}`;
              const selected = hac.dictamen_id!=null && Number(hac.dictamen_id)===Number(d.id) ? 'selected' : '';
              return `<option value="${d.id}" ${selected}>${esc(label)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="field"><label>Solicitud de recurso a Hacienda</label><input type="date" id="eh-fecha" value="${hac.fecha ? String(hac.fecha).slice(0,10) : ''}"></div>
      </div>
      <div id="eh-error" style="color:var(--red);font-size:12.5px;font-weight:700;display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitEditarHacienda">Guardar Cambios</button>
    </div>
  `);
  document.getElementById('submitEditarHacienda').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const folio = document.getElementById('eh-folio').value.trim();
    const monto = numValue(document.getElementById('eh-monto'));
    const dictamenId = document.getElementById('eh-dictamen').value;
    const fecha = document.getElementById('eh-fecha').value || null;
    const err = document.getElementById('eh-error');
    if(!monto){
      err.textContent = 'El monto es obligatorio.';
      err.style.display = 'block';
      return;
    }
    try{
      await withLoading(btn, ()=>Api.patch(`/programs/${pid}/hacienda/${hacId}`, { folio, monto, dictamen_id: dictamenId || null, fecha }), 'Guardando…');
      closeModal();
      toast('Solicitud a Hacienda actualizada.');
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){
      err.textContent = e.message || 'No se pudo actualizar la solicitud a Hacienda.';
      err.style.display = 'block';
    }
  });
}

async function handleDeleteHacienda(pid, hacId, btn){
  const ok = await confirmAction({
    title: 'Eliminar Solicitud a Hacienda',
    message: 'Se eliminará esta solicitud junto con su Autorización y su Archivo de Asignación, si los tiene. Si ya tenía una Dispersión registrada, el pago no se borra, solo se desvincula. Esta acción no se puede deshacer.',
    confirmText: 'Eliminar',
  });
  if(!ok) return;
  await withLoading(btn, ()=>safeCall(()=>Api.del(`/programs/${pid}/hacienda/${hacId}`), 'Solicitud a Hacienda eliminada.'), 'Eliminando…');
  await refreshOneProgram(pid); renderDetalle(pid);
}

/* ---- Autorizado por Hacienda ----
   Registra que una solicitud ya enviada a Hacienda fue autorizada: monto
   autorizado, fecha/hora propia y su documento. A partir de ahí la
   solicitud queda habilitada para cargarle su Archivo de Asignación. */
function openModalAutorizacion(pid, hacId){
  const p = state.programs.find(x=>x.id===pid);
  const hac = p && (p.solicitudesHacienda||[]).find(h=>String(h.id)===String(hacId));
  openModal(`
    <div class="modal-header"><h3>Registrar Autorizado por Hacienda</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      ${hac ? `<div class="hacienda-preview">Solicitud <b>Folio ${esc(hac.folio)}</b> · Monto solicitado <b>${fmtMoney(hac.monto)}</b> · ${fmtDateOnly(hac.fecha)}</div>` : ''}
      <div class="form-grid single">
        <div class="field"><label>Monto Autorizado por Hacienda</label><input type="text" data-money id="au-monto" placeholder="$0.00" value="${hac? fmtInputMoney(hac.monto) : ''}"></div>
        <div class="field"><label>Autorización de Hacienda</label><input type="date" id="au-fecha"></div>
        ${fileDropZoneHTML('au-doc','Documento de autorización','.pdf,.jpg,.jpeg,.png,.doc,.docx')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitAutorizacion">Registrar</button>
    </div>
  `);
  bindDropZone('au-doc');
  document.getElementById('submitAutorizacion').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const monto = numValue(document.getElementById('au-monto'));
    const fecha = document.getElementById('au-fecha').value || null;
    const archivo = document.getElementById('au-doc').files[0];
    if(!monto) return;

    /* Validación: la autorización de Hacienda no debería exceder lo que
       esa solicitud pidió originalmente (hac.monto). Toast, no modal de
       confirmación, por la misma razón que en Solicitud a Hacienda: este
       formulario ya está dentro del único modal del sistema. */
    if(hac && monto > Number(hac.monto) + 0.01){
      toast(`El monto autorizado (${fmtMoney(monto)}) supera lo que se solicitó en el folio ${hac.folio} (${fmtMoney(hac.monto)}). Verifica el monto antes de registrar.`, true);
      return;
    }

    const fd = new FormData();
    fd.append('monto_autorizado', monto);
    if(fecha) fd.append('fecha_autorizacion', fecha);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/hacienda/${hacId}/autorizacion`, fd), 'Autorizado por Hacienda registrado.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---- Archivo de Asignación: carga directa al seleccionar el archivo ---- */
async function uploadAsignacion(pid, hacId, fileInput, btn){
  const archivo = fileInput.files[0];
  if(!archivo) return;
  const fd = new FormData();
  fd.append('documento', archivo);
  try{
    await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${pid}/hacienda/${hacId}/asignacion`, fd), 'Archivo de Asignación cargado.'), 'Subiendo…');
    await refreshOneProgram(pid); renderDetalle(pid);
  }catch(e){ /* el error ya se mostró vía safeCall */ }
  finally{ fileInput.value = ''; }
}

/* ---- Archivo de Asignación: Marcar Correcto (folio proporcionado) ---- */
function openModalAsignacionCorrecto(pid, hacId){
  openModal(`
    <div class="modal-header"><h3>Marcar Archivo de Asignación Correcto</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Folio proporcionado</label><input type="text" id="asigc-folio" placeholder="Ej. AS-2026-0001"></div>
        <div class="field-hint">Este folio avala que la asignación ya fue aceptada.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitAsigCorrecto">Guardar</button>
    </div>
  `);
  document.getElementById('submitAsigCorrecto').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const folio = document.getElementById('asigc-folio').value.trim();
    if(!folio){ toast('El folio es obligatorio.', true); return; }
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.patch(`/programs/${pid}/hacienda/${hacId}/asignacion/correcto`, {folio}), 'Archivo de Asignación marcado como correcto.'), 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---- Archivo de Asignación: Marcar Incorrecto (motivo) ---- */
function openModalAsignacionIncorrecto(pid, hacId){
  openModal(`
    <div class="modal-header"><h3>Marcar Archivo de Asignación Incorrecto</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field"><label>Motivo</label><textarea id="asigi-motivo" rows="2" placeholder="Describe el motivo del rechazo…"></textarea></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="submitAsigIncorrecto">Marcar Incorrecto</button>
    </div>
  `);
  document.getElementById('submitAsigIncorrecto').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const motivo = document.getElementById('asigi-motivo').value.trim();
    if(!motivo){ toast('El motivo es obligatorio.', true); return; }
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.patch(`/programs/${pid}/hacienda/${hacId}/asignacion/incorrecto`, {motivo}), 'Archivo de Asignación marcado como incorrecto.'), 'Guardando…');
      closeModal();
      await refreshOneProgram(pid); renderDetalle(pid);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---- Registrar Dispersión (antes "Pago") ----
   En vez de capturar un monto suelto, el usuario elige de un desplegable
   cuál de las solicitudes a Hacienda YA AUTORIZADAS, con Archivo de
   Asignación correcto y sin dispersión todavía es la que se está
   dispersando. Al seleccionarla se muestra su información y la dispersión
   queda ligada a esa solicitud (Solicitud a Hacienda → Archivo de
   Asignación correcto → Dispersión → Documento comprobatorio). */
function openModalPago(p){
  const disponibles = (p.solicitudesHacienda||[]).filter(h=>h.disponibleParaPago);
  if(!disponibles.length){
    toast('No hay solicitudes a Hacienda con Archivo de Asignación correcto, disponibles para dispersión.', true);
    return;
  }
  openModal(`
    <div class="modal-header"><h3>Registrar Dispersión</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-grid single">
        <div class="field">
          <label>Solicitud a Hacienda dispersada</label>
          <select id="g-hacienda">
            <option value="">Selecciona la solicitud que se dispersó…</option>
            ${disponibles.map(h=>`<option value="${h.id}">Solicitud folio ${esc(h.folio)} — ${fmtMoney(h.autorizacion.monto_autorizado)}</option>`).join('')}
          </select>
        </div>
        <div id="g-preview"></div>
        <div class="field"><label>Folio de la Dispersión</label><input type="text" id="g-folio" placeholder="Ej. PG-2026-0001"></div>
        <div class="field"><label>Monto Dispersado</label><input type="text" data-money id="g-monto" placeholder="$0.00"></div>
        ${dateTimeFieldGroupHTML('g-fecha','Registro de la Dispersión')}
        ${fileDropZoneHTML('g-doc','Documento que avala la dispersión','.pdf,.jpg,.jpeg,.png,.doc,.docx')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="submitPago">Registrar</button>
    </div>
  `);
  bindDropZone('g-doc');

  const selHacienda = document.getElementById('g-hacienda');
  const preview = document.getElementById('g-preview');
  const montoInput = document.getElementById('g-monto');
  selHacienda.addEventListener('change', ()=>{
    const hac = disponibles.find(h=>String(h.id)===selHacienda.value);
    if(!hac){ preview.innerHTML=''; return; }
    preview.innerHTML = `<div class="hacienda-preview">
      Solicitado: <b>${fmtMoney(hac.monto)}</b> · ${fmtDateOnly(hac.fecha)}<br>
      Autorizado por Hacienda: <b>${fmtMoney(hac.autorizacion.monto_autorizado)}</b> · ${fmtDate(hac.autorizacion.fecha_autorizacion)}<br>
      Archivo de Asignación: <b>Correcto</b>${hac.asignacion && hac.asignacion.folio ? ` · Folio ${esc(hac.asignacion.folio)}` : ''}
    </div>`;
    if(!montoInput.value) montoInput.value = fmtInputMoney(hac.autorizacion.monto_autorizado);
  });

  document.getElementById('submitPago').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const haciendaId = selHacienda.value;
    const folio = document.getElementById('g-folio').value.trim();
    const monto = numValue(montoInput);
    const fecha = readDateTimeGroup('g-fecha');
    const archivo = document.getElementById('g-doc').files[0];
    if(!haciendaId){ toast('Selecciona la solicitud a Hacienda que se dispersó.', true); return; }
    if(!monto) return;

    /* Validación: la dispersión no debería exceder lo que Hacienda autorizó
       para esa solicitud (ya se precarga con ese monto, pero es editable). */
    const hacSeleccionada = disponibles.find(h=>String(h.id)===haciendaId);
    if(hacSeleccionada && monto > Number(hacSeleccionada.autorizacion.monto_autorizado) + 0.01){
      toast(`El monto de la dispersión (${fmtMoney(monto)}) supera lo que Hacienda autorizó para el folio ${hacSeleccionada.folio} (${fmtMoney(hacSeleccionada.autorizacion.monto_autorizado)}). Verifica el monto antes de registrar.`, true);
      return;
    }

    const fd = new FormData();
    fd.append('hacienda_id', haciendaId);
    fd.append('folio', folio);
    fd.append('monto', monto);
    if(fecha) fd.append('fecha', fecha);
    if(archivo) fd.append('documento', archivo);
    try{
      await withLoading(btn, ()=>safeCall(()=>Api.postForm(`/programs/${p.id}/pagos`, fd), 'Dispersión registrada.'), archivo ? 'Subiendo documento…' : 'Guardando…');
      closeModal();
      await refreshOneProgram(p.id); renderDetalle(p.id);
    }catch(e){ /* el error ya se mostró vía safeCall */ }
  });
}

/* ---------- START ---------- */
init();