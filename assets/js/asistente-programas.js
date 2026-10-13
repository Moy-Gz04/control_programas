/* =========================================================================
   Asistente de Programas (igual que en Correspondencia y Contratos)
   - Saluda al entrar (una vez por sesión) desde la esquina.
   - Al tocarlo abre un menú de ayuda con las dudas frecuentes del sistema.
   - Cada vez que se guarda algo (POST/PATCH/PUT/DELETE a la API) muestra la
     ventana de trabajo con la mascota y una barra que avanza sin segundos.
   ========================================================================= */
(function () {
  const M = () => window.MiniSEBISO || {};
  const usuario = (() => { try { return JSON.parse(sessionStorage.getItem('pb_user') || 'null'); } catch (e) { return null; } })();
  const nombre = String(usuario?.nombre || '').trim().split(/\s+/)[0] || '';
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ---------- Saludo ---------- */
  function saludar() {
    if (sessionStorage.getItem('pb_saludo')) return;
    sessionStorage.setItem('pb_saludo', '1');
    const h = new Date().getHours();
    const parte = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
    setTimeout(() => M().decir?.(`${parte}${nombre ? ', ' + esc(nombre) : ''}! Si necesitas algo, tócame.`, { duracion: 6500 }), 900);
  }

  /* ---------- Menú de ayuda ---------- */
  const AYUDA = [
    { p: '¿Cómo registro un programa nuevo?', r: 'Usa el botón dorado <b>Nuevo Programa</b> del menú. Llena la clave, el nombre y el monto autorizado; después podrás subir el oficio de autorización.' },
    { p: '¿Qué orden siguen los documentos?', r: 'Cada programa avanza así: <b>Solicitud → Autorización → Asignación → Pago</b>. Algunos programas, como Verificentros, pasan directo de la autorización al pago.' },
    { p: '¿Qué muestra la gráfica?', r: 'Compara lo <b>autorizado</b> contra lo <b>comprometido</b> y lo <b>dispersado</b>. El recurso disponible baja conforme se dispersan los pagos.' },
    { p: '¿Dónde veo las transferencias pendientes?', r: 'Dentro de cada programa, en el apartado <b>Transferencias pendientes</b>: ahí aparecen los contrarrecibos que todavía no tienen transferencia.' },
    { p: '¿Cómo abro un PDF?', r: 'En las tablas de solicitudes, autorizaciones y pagos, el botón del documento abre el PDF en una pestaña nueva.' },
  ];
  let panel = null;
  function cerrarAyuda() { panel?.remove(); panel = null; M().despierto?.(false); }
  function abrirAyuda() {
    if (panel) { cerrarAyuda(); return; }
    M().callar?.(); M().despierto?.(true);
    panel = document.createElement('div');
    panel.className = 'pa-ayuda';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ayuda del sistema');
    panel.innerHTML = `
      <div class="pa-ayuda-cab"><b>${nombre ? '¿En qué te ayudo, ' + esc(nombre) + '?' : '¿En qué te ayudo?'}</b>
        <button type="button" class="pa-x" aria-label="Cerrar ayuda"><i class="ti ti-x"></i></button></div>
      <div class="pa-ayuda-lista">${AYUDA.map((a, i) => `<button type="button" class="pa-preg" data-i="${i}"><i class="ti ti-help-circle"></i><span>${a.p}</span></button>`).join('')}</div>
      <div class="pa-resp" hidden></div>`;
    document.body.appendChild(panel);
    const resp = panel.querySelector('.pa-resp');
    panel.querySelector('.pa-x').onclick = cerrarAyuda;
    panel.querySelectorAll('.pa-preg').forEach(b => b.onclick = () => {
      panel.querySelectorAll('.pa-preg').forEach(x => x.classList.toggle('activa', x === b));
      resp.hidden = false; resp.innerHTML = AYUDA[b.dataset.i].r;
    });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel) cerrarAyuda(); });
  document.addEventListener('pointerdown', e => {
    if (panel && !panel.contains(e.target) && !e.target.closest('.ms-flotante')) cerrarAyuda();
  });

  /* ---------- Ventana de trabajo al guardar ---------- */
  const MENSAJES = { POST: 'Guardando…', PATCH: 'Actualizando…', PUT: 'Actualizando…', DELETE: 'Eliminando…' };
  let trabajo = null, activos = 0, cerrarT = null;
  function abrirTrabajo(texto) {
    clearTimeout(cerrarT);
    if (!trabajo) {
      trabajo = document.createElement('div');
      trabajo.className = 'pa-trabajo';
      trabajo.innerHTML = `<div class="pa-trabajo-card">${window.Carga ? window.Carga.MASCOTA : ''}
        <div class="pa-trabajo-txt"></div><div class="carga-barra"><span></span></div></div>`;
      document.body.appendChild(trabajo);
    }
    trabajo.querySelector('.pa-trabajo-txt').textContent = texto;
    trabajo.classList.remove('listo');
  }
  function cerrarTrabajo(ok) {
    if (!trabajo) return;
    trabajo.classList.add('listo');
    trabajo.querySelector('.pa-trabajo-txt').textContent = ok ? '¡Listo!' : 'No se pudo completar';
    cerrarT = setTimeout(() => { trabajo?.remove(); trabajo = null; }, ok ? 650 : 1400);
  }
  const API = (window.CONFIG && (CONFIG.API_URL || CONFIG.API)) || 'onrender.com/api';
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (url, opts = {}) {
    const metodo = String(opts.method || 'GET').toUpperCase();
    const esApi = String(url).includes('/api') || String(url).includes(API);
    if (!esApi || !MENSAJES[metodo] || /\/auth\//.test(String(url))) return fetchOriginal(url, opts);
    activos++; abrirTrabajo(MENSAJES[metodo]);
    try {
      const r = await fetchOriginal(url, opts);
      if (--activos === 0) cerrarTrabajo(r.ok);
      return r;
    } catch (e) { if (--activos === 0) cerrarTrabajo(false); throw e; }
  };

  /* ---------- Encender/apagar y personalizar (como en Correspondencia) ----------
     Se guarda en este equipo, por usuario. */
  const COLORES = [
    { nombre: 'Dorado', color: null, muestra: '#E6CB93' }, { nombre: 'Perla', color: '#DCE2EC' },
    { nombre: 'Rosa', color: '#F2B8C6' }, { nombre: 'Guinda', color: '#B0475F' },
    { nombre: 'Durazno', color: '#F5B98E' }, { nombre: 'Menta', color: '#A8DCC2' },
    { nombre: 'Cielo', color: '#A9CBEF' }, { nombre: 'Lavanda', color: '#C7B6EA' }, { nombre: 'Carbón', color: '#6E6A72' },
  ];
  const CLAVE = 'pb_asistente_' + (usuario?.id || usuario?.email || '');
  let pref = { activo: true, color: null, estrella: 'guinda' };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') }; } catch (e) { /* sin storage */ }
  const encendido = () => pref.activo !== false;

  // Mientras está apagado no habla ni presenta nada
  ['decir', 'ayudarEditar', 'presentar', 'senalar', 'comentar'].forEach(f => {
    const orig = M()[f];
    if (typeof orig === 'function') window.MiniSEBISO[f] = function () { return encendido() ? orig.apply(this, arguments) : false; };
  });

  function aplicar() {
    const r = document.documentElement;
    if (pref.color) { r.style.setProperty('--ms-color', pref.color); r.setAttribute('data-ms-color', ''); }
    else { r.style.removeProperty('--ms-color'); r.removeAttribute('data-ms-color'); }
    r.toggleAttribute('data-ms-estrella-dorada', pref.estrella === 'dorada');
    M().esquina?.()?.classList.toggle('ms-oculto', !encendido());
    const t = document.querySelector('.nav-asistente');
    if (t) {
      t.setAttribute('aria-pressed', encendido() ? 'true' : 'false');
      t.title = encendido() ? 'Asistente encendido: toca para apagarlo' : 'Asistente apagado: toca para encenderlo';
    }
    if (!encendido()) { cerrarAyuda(); M().callar?.(); }
  }
  function guardar(cambios) {
    pref = { ...pref, ...cambios };
    try { localStorage.setItem(CLAVE, JSON.stringify(pref)); } catch (e) { /* sin storage */ }
    aplicar();
  }

  function prepararEncabezado() {
    const salir = document.getElementById('btnLogout');
    if (!salir || document.querySelector('.nav-asis-grupo')) return;
    const grupo = document.createElement('div');
    grupo.className = 'nav-asis-grupo';
    grupo.innerHTML = `
      <button type="button" class="nav-asistente" aria-pressed="true">
        <span class="nav-asis-switch" aria-hidden="true"><span></span></span>
        <span class="nav-asis-texto">Asistente</span>
      </button>
      <button type="button" class="nav-asis-color" aria-label="Personalizar el asistente" title="Personalizar el asistente"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
    salir.parentNode.insertBefore(grupo, salir);
    grupo.querySelector('.nav-asistente').addEventListener('click', () => {
      const prender = !encendido();
      guardar({ activo: prender });
      if (prender) setTimeout(() => M().decir?.('¡Aquí estoy de nuevo! Tócame cuando necesites ayuda.', { duracion: 4500 }), 150);
    });
    grupo.querySelector('.nav-asis-color').addEventListener('click', abrirPersonalizar);
    // El usuario va fijo en la esquina inferior izquierda (la derecha es de la mascota)
    const yo = document.querySelector('.navbar-wrap .nav-user');
    if (yo) { yo.classList.add('nav-user-esquina'); document.body.appendChild(yo); }
    aplicar();
  }

  let perso = null;
  function abrirPersonalizar() {
    if (perso) return;
    cerrarAyuda();
    perso = document.createElement('div');
    perso.className = 'pa-perso';
    perso.setAttribute('role', 'dialog');
    perso.setAttribute('aria-label', 'Personalizar el asistente');
    const vista = `<div class="minisebiso" aria-hidden="true"><div class="ms-cuerpo"><span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span><span class="ms-ojo-mov der"><span class="ms-ojo"></span></span></div><div class="ms-estrella"></div></div>`;
    perso.innerHTML = `<div class="pa-perso-caja">
      <div class="pa-ayuda-cab"><b>Personaliza a tu asistente</b><button type="button" class="pa-x" aria-label="Cerrar"><i class="ti ti-x"></i></button></div>
      <div class="pa-perso-cuerpo">
        <div class="pa-perso-vista">${vista}</div>
        <div class="pa-perso-opciones">
          <div class="pa-perso-tit">Color</div>
          <div class="pa-perso-colores">${COLORES.map((c, i) => `<button type="button" class="pa-color" data-i="${i}" title="${c.nombre}" aria-label="${c.nombre}" style="background:${c.muestra || c.color}"></button>`).join('')}</div>
          <div class="pa-perso-tit">Estrella</div>
          <div class="pa-perso-estrellas">
            <button type="button" class="pa-estrella" data-e="guinda"><span style="background:#9C2647"></span>Guinda</button>
            <button type="button" class="pa-estrella" data-e="dorada"><span style="background:#D8B866"></span>Dorada</button>
          </div>
        </div>
      </div></div>`;
    document.body.appendChild(perso);
    const marcar = () => {
      perso.querySelectorAll('.pa-color').forEach(b => b.classList.toggle('activo', (COLORES[b.dataset.i].color || null) === (pref.color || null)));
      perso.querySelectorAll('.pa-estrella').forEach(b => b.classList.toggle('activo', b.dataset.e === pref.estrella));
    };
    perso.querySelectorAll('.pa-color').forEach(b => b.onclick = () => { guardar({ color: COLORES[b.dataset.i].color }); marcar(); });
    perso.querySelectorAll('.pa-estrella').forEach(b => b.onclick = () => { guardar({ estrella: b.dataset.e }); marcar(); });
    const cerrarP = () => { perso?.remove(); perso = null; document.removeEventListener('keydown', escP); };
    const escP = (e) => { if (e.key === 'Escape') cerrarP(); };
    document.addEventListener('keydown', escP);
    perso.querySelector('.pa-x').onclick = cerrarP;
    perso.addEventListener('pointerdown', e => { if (e.target === perso) cerrarP(); });
    marcar();
  }

  function iniciar() {
    window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { alTocarEsquina: abrirAyuda });
    prepararEncabezado();
    if (encendido()) saludar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
