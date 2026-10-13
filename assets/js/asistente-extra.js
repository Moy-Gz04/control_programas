// =========================================================
// asistente-extra.js
// El mismo asistente de Correspondencia y Contratos, para Programas.
// Se carga después de asistente-programas.js:
//   - ventana de trabajo con barra de avance (real al subir archivos) en
//     cada acción que guarda algo en el servidor;
//   - botón «Asistente» junto a «Cerrar sesión» para encenderlo/apagarlo y
//     lápiz para personalizarlo (color, Galaxia con brillitos, estrella,
//     ropa y lentes; los lentes solo en las ventanas), guardado por usuario;
//   - en la esquina, si tapa un botón o un campo, se asoma desde el borde.
// =========================================================
(function () {
  const M = window.MiniSEBISO;
  if (!M || !M.preguntar || window.__asistenteExtra) return;
  window.__asistenteExtra = true;

  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'assets/css/asistente-extra.css?v=2';
  document.head.appendChild(css);

  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const API = (typeof API_BASE !== 'undefined' ? API_BASE : '/api').replace(/^\//, location.origin + '/');
  const origFetch = window.fetch.bind(window);
  const token = () => sessionStorage.getItem('pb_token') || '';
  let usuario = null;
  try { usuario = JSON.parse(sessionStorage.getItem('pb_user') || 'null'); } catch (e) { usuario = null; }
  const enLogin = () => false;
  let pref = { activo: true, color: null, estrella: 'guinda', ropa: 'ninguna', gafas: 'ninguno' };
  const encendido = () => pref.activo !== false;

  // Aviso chiquito propio (no depende de la página ni de la mascota)
  function avisoOriginal(texto, esError = false) {
    let a = document.querySelector('.ms-aviso-mini');
    if (!a) { a = document.createElement('div'); a.className = 'ms-aviso-mini'; a.setAttribute('role', 'status'); document.body.appendChild(a); }
    a.textContent = texto; a.classList.toggle('error', esError); a.classList.add('visible');
    clearTimeout(a._t); a._t = setTimeout(() => a.classList.remove('visible'), esError ? 4500 : 2600);
  }
  // El menú de ayuda es del asistente de la página: se cierra con su propio botón
  const panelAyuda = () => document.querySelector('.pa-ayuda');
  function cerrarAyuda() { const b = panelAyuda()?.querySelector('.pa-x'); if (b) b.click(); else panelAyuda()?.remove(); }
  // Peticiones al servidor para las preferencias (sin ventana de trabajo)
  async function peticionOriginal(ruta, opciones = {}) {
    const r = await origFetch(API + ruta, { ...opciones, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opciones.headers || {}) } });
    let d = {}; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error(d.mensaje || d.error || 'Error del servidor');
    return d;
  }

  /* ─────────────── Apagado: la mascota se calla y los avisos vuelven a ser los normales ─────────────── */
  ['decir', 'ayudarEditar', 'presentar', 'senalar', 'comentar'].forEach(f => {
    const orig = M[f];
    if (typeof orig !== 'function') return;
    M[f] = function () { return M.apagado ? false : orig.apply(this, arguments); };
  });
  Object.defineProperty(M, 'apagado', { get: () => !encendido(), configurable: true });
  /* ─────────────── Ventana de trabajo ─────────────── */
  let op = null;   // la operación en curso: { overlay, pasos[], pendientes, avance, ... }

  function mascotaHTML() {
    return `<div class="ms-cuerpo"><span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span><span class="ms-ojo-mov der"><span class="ms-ojo"></span></span></div><div class="ms-estrella"></div>`;
  }

  function abrirVentana() {
    const overlay = document.createElement('div');
    overlay.className = 'ms-dlg-overlay ms-trabajo';
    overlay.innerHTML = `
      <div class="ms-dlg-escena" role="status" aria-live="polite">
        <div class="minisebiso ms-dlg-mascota ms-trabajando" aria-hidden="true">${mascotaHTML()}</div>
        <div class="ms-dlg-globo">
          <div class="ms-dlg-saludo">Un momento…</div>
          <div class="ms-dlg-pregunta"></div>
          <div class="ms-trab-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
          <div class="ms-trab-pie"><b class="ms-trab-pct">0%</b><span class="ms-trab-det"></span></div>
          <ul class="ms-trab-pasos"></ul>
          <div class="ms-dlg-botones" hidden><button type="button" class="ms-dlg-btn ms-dlg-ok ms-dlg-ok-dorado"><i class="ti ti-check"></i> Entendido</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    M.callar && M.callar();
    M.tomarEsquina && M.tomarEsquina();
    requestAnimationFrame(() => overlay.classList.add('visible'));
    const o = {
      overlay, pasos: [], pendientes: 0, avance: 0, meta: 0, aviso: null, error: null, cerrando: false, t0: performance.now(),
      el: (s) => overlay.querySelector(s)
    };
    // Los ojos siguen la barra mientras trabaja
    o.el('.ms-dlg-mascota').querySelectorAll('.ms-ojo-mov').forEach(oj => { oj.style.setProperty('--dx', '5px'); oj.style.setProperty('--dy', '4px'); });
    // La barra avanza sola hacia la meta (sin llegar al 100 % hasta que termina)
    const tic = () => {
      if (!o.overlay.isConnected || o.cerrando) return;
      const tope = o.subiendo !== undefined ? o.subiendo : 92;
      o.meta = Math.max(o.meta, tope);
      o.avance += (o.meta - o.avance) * (o.subiendo !== undefined ? 0.25 : 0.035);
      pintarAvance(o, o.avance);
      o.raf = requestAnimationFrame(tic);
    };
    o.raf = requestAnimationFrame(tic);
    return o;
  }

  function pintarAvance(o, pct) {
    const p = Math.max(0, Math.min(100, pct));
    o.el('.ms-trab-barra span').style.width = p.toFixed(1) + '%';
    o.el('.ms-trab-barra').setAttribute('aria-valuenow', Math.round(p));
    o.el('.ms-trab-pct').textContent = Math.round(p) + '%';
  }

  function pintarPasos(o) {
    const actual = o.pasos.filter(p => p.estado === 'actual').pop();
    o.el('.ms-dlg-pregunta').textContent = (actual || o.pasos[o.pasos.length - 1]).texto + (actual ? '…' : '');
    o.el('.ms-trab-pasos').innerHTML = o.pasos.length < 2 ? '' : o.pasos.map(p => `
      <li class="${p.estado}"><i class="ti ${p.estado === 'hecho' ? 'ti-circle-check' : p.estado === 'error' ? 'ti-alert-circle' : 'ti-loader-2'}" aria-hidden="true"></i>${esc(p.texto)}</li>`).join('');
  }

  function empezarPaso(info) {
    if (!op || op.cerrando) { if (op) finalizarYa(op); op = abrirVentana(); }
    clearTimeout(op.espera);
    const paso = { texto: info.texto, estado: 'actual' };
    op.pasos.push(paso);
    op.pendientes++;
    if (info.subida) { op.subiendo = op.avance; op.el('.ms-trab-det').textContent = 'Preparando el archivo…'; }
    else if (op.pasos.length > 1) op.meta = Math.min(op.meta, 92);
    pintarPasos(op);
    return paso;
  }

  function terminarPaso(paso, error) {
    if (!op) return;
    paso.estado = error ? 'error' : 'hecho';
    op.pendientes = Math.max(0, op.pendientes - 1);
    if (error) op.error = op.error || error.message;
    if (op.subiendo !== undefined && !op.pendientes) { delete op.subiendo; op.el('.ms-trab-det').textContent = ''; }
    pintarPasos(op);
    esperarCierre();
  }

  // Al terminar la última petición se espera un poco: puede venir otra (subir el documento),
  // la recarga del listado o el aviso con el resultado que la pantalla iba a mostrar
  function esperarCierre(ms = 450) {
    if (!op || op.pendientes) return;
    clearTimeout(op.espera);
    const o = op;
    o.espera = setTimeout(() => { if (op === o && !o.pendientes) finalizar(o); }, ms);
  }

  async function finalizar(o, { texto, esError } = {}) {
    if (o.cerrando) return;
    o.cerrando = true;
    clearTimeout(o.espera);
    cancelAnimationFrame(o.raf);
    if (op === o) op = null;
    const error = esError ? texto : o.error;
    const mascota = o.el('.ms-dlg-mascota');
    mascota.classList.remove('ms-trabajando');
    mascota.querySelectorAll('.ms-ojo-mov').forEach(oj => { oj.style.setProperty('--dx', '0px'); oj.style.setProperty('--dy', '0px'); });
    o.el('.ms-trab-det').textContent = '';
    if (error) {
      o.overlay.classList.add('ms-tono-error');
      o.el('.ms-dlg-saludo').textContent = 'No se pudo completar';
      o.el('.ms-dlg-pregunta').textContent = error;
      o.el('.ms-trab-barra').classList.add('error');
      o.pasos.forEach(p => { if (p.estado === 'actual') p.estado = 'error'; });
      pintarPasosSinTitulo(o);
      if (!quieto) mascota.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 460, easing: 'ease-in-out' });
      const botones = o.el('.ms-dlg-botones'); botones.hidden = false;
      const ok = botones.querySelector('button'); ok.focus();
      await new Promise(r => {
        ok.onclick = r;
        o.overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') r(); });
        o.overlay.addEventListener('click', (e) => { if (e.target === o.overlay) r(); });
      });
    } else {
      o.overlay.classList.add('ms-tono-exito');
      pintarAvance(o, 100);
      o.el('.ms-trab-barra').classList.add('listo');
      o.el('.ms-dlg-saludo').textContent = '¡Listo!';
      o.el('.ms-dlg-pregunta').textContent = (texto || (o.pasos.length ? hecho(o.pasos[0].texto) : 'Cambios guardados')).replace(/\.$/, '') + '.';
      pintarPasosSinTitulo(o);
      if (!quieto) mascota.animate([{ transform: 'none' }, { transform: 'translateY(-24px) rotate(-8deg) scale(1.05)', offset: .4 }, { transform: 'translateY(0) scale(1.08, .92)', offset: .75 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
      await new Promise(r => { const t = setTimeout(r, 1000); o.overlay.onclick = () => { clearTimeout(t); r(); }; });
    }
    o.overlay.classList.remove('visible');
    setTimeout(() => o.overlay.remove(), 220);
    M.soltarEsquina && M.soltarEsquina();
  }
  function pintarPasosSinTitulo(o) {
    const t = o.el('.ms-dlg-pregunta').textContent;
    pintarPasos(o);
    o.el('.ms-dlg-pregunta').textContent = t;
  }
  function finalizarYa(o) { o.cerrando = true; cancelAnimationFrame(o.raf); o.overlay.remove(); M.soltarEsquina && M.soltarEsquina(); }
  // "Registrando la factura" → "Factura registrada" (para cuando la pantalla no dice nada)
  function hecho(t) {
    const m = { 'Subiendo': 'Documento guardado', 'Eliminando el contrato': 'Contrato eliminado', 'Eliminando la factura': 'Factura eliminada',
      'Creando el contrato': 'Contrato creado', 'Turnando la factura a contabilidad': 'Factura turnada a contabilidad', 'Iniciando el proceso de pago': 'Proceso de pago iniciado',
      'Omitiendo el paso': 'Paso omitido',
      'Registrando el oficio': 'Oficio registrado', 'Enviando la atención del oficio': 'Oficio atendido', 'Guardando el oficio': 'Oficio guardado', 'Enviando la foto': 'Foto enviada', 'Descartando la foto': 'Foto descartada',
      'Eliminando el oficio': 'Oficio eliminado', 'Generando el PDF': 'PDF generado', 'Subiendo el documento': 'Documento guardado', 'Volviendo a leer la foto': 'Foto enviada otra vez a leer',
      'Guardando el apartado': 'Apartado guardado', 'Cancelando el apartado': 'Apartado cancelado', 'Guardando la circular': 'Circular guardada', 'Guardando la tarjeta informativa': 'Tarjeta guardada',
      'Guardando el número de oficio': 'Número de oficio guardado', 'Liberando el número de oficio': 'Número liberado', 'Apartando el número del día': 'Número apartado', 'Generando la nota': 'Nota generada',
      'Registrando la autorización': 'Autorización registrada', 'Guardando el archivo de asignación': 'Archivo de asignación guardado', 'Registrando la solicitud a Hacienda': 'Solicitud registrada',
      'Guardando la solicitud': 'Solicitud guardada', 'Guardando el dictamen': 'Dictamen guardado', 'Registrando el pago': 'Pago registrado', 'Creando el programa': 'Programa creado',
      'Guardando el programa': 'Programa guardado', 'Eliminando el documento': 'Documento eliminado', 'Eliminando la solicitud': 'Solicitud eliminada', 'Eliminando el programa': 'Programa eliminado' };
    const k = Object.keys(m).find(k => t.startsWith(k));
    return k ? m[k] : 'Cambios guardados';
  }


  /* ─────────────── Qué hace cada petición ─────────────── */
  function describir(url, metodo, cuerpo) {
    const ruta = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0];
    const conArchivos = cuerpo instanceof Blob || (cuerpo instanceof FormData && [...cuerpo.values()].some(v => v instanceof Blob && v.size));
    const nombreArchivo = cuerpo instanceof FormData ? ([...cuerpo.values()].find(v => v instanceof File && v.size) || {}).name : cuerpo && cuerpo.name;
    let texto = 'Guardando los cambios';
    if (metodo === 'DELETE' || /\/eliminar$/.test(ruta)) {
      texto = /pendientes/.test(ruta) ? 'Descartando la foto' : /oficios/.test(ruta) ? 'Eliminando el oficio' : /no-oficio/.test(ruta) ? 'Liberando el número de oficio'
        : /circular/.test(ruta) ? 'Eliminando la circular' : /tarjeta/.test(ruta) ? 'Eliminando la tarjeta informativa' : /apartados/.test(ruta) ? 'Cancelando el apartado'
        : /salas/.test(ruta) ? 'Eliminando' : /pdfs-generados/.test(ruta) ? 'Eliminando el PDF' : 'Eliminando';
    }
    else if (/doc3-diferido/.test(ruta)) texto = 'Subiendo el documento';
    else if (/generar-pdf/.test(ruta)) texto = 'Generando el PDF';
    else if (/pendientes\/\d+\/reintentar/.test(ruta)) texto = 'Volviendo a leer la foto';
    else if (/pendientes$/.test(ruta)) texto = 'Enviando la foto';
    else if (/^\/oficios$/.test(ruta)) texto = 'Registrando el oficio';
    else if (/^\/oficios\/\d+$/.test(ruta)) texto = (cuerpo instanceof FormData && cuerpo.get('estatus') === 'atendido') ? 'Enviando la atención del oficio' : 'Guardando el oficio';
    else if (/libre-del-dia/.test(ruta)) texto = 'Apartando el número del día';
    else if (/no-oficio/.test(ruta)) texto = 'Guardando el número de oficio';
    else if (/circular/.test(ruta)) texto = 'Guardando la circular';
    else if (/tarjeta-informativa/.test(ruta)) texto = 'Guardando la tarjeta informativa';
    else if (/regenerar-nota/.test(ruta)) texto = 'Generando la nota';
    else if (/apartados/.test(ruta)) texto = 'Guardando el apartado';
    else if (/salas/.test(ruta)) texto = 'Guardando la sala';
    // Programas
    if (/\/hacienda\/\d+\/autorizacion/.test(ruta) && metodo !== 'DELETE') texto = 'Registrando la autorización';
    else if (/\/asignacion/.test(ruta) && metodo !== 'DELETE') texto = 'Guardando el archivo de asignación';
    else if (/\/hacienda$/.test(ruta)) texto = 'Registrando la solicitud a Hacienda';
    else if (/\/hacienda\/\d+$/.test(ruta) && metodo !== 'DELETE') texto = 'Guardando la solicitud';
    else if (/\/dictamenes/.test(ruta) && metodo !== 'DELETE') texto = 'Guardando el dictamen';
    else if (/\/pagos|dispersion/.test(ruta) && metodo !== 'DELETE') texto = 'Registrando el pago';
    else if (/^\/programs$/.test(ruta)) texto = 'Creando el programa';
    else if (/^\/programs\/\d+$/.test(ruta) && metodo !== 'DELETE') texto = 'Guardando el programa';
    else if (metodo === 'DELETE' && /documento$/.test(ruta)) texto = 'Eliminando el documento';
    else if (metodo === 'DELETE' && /hacienda/.test(ruta)) texto = 'Eliminando la solicitud';
    else if (metodo === 'DELETE' && /^\/programs\/\d+$/.test(ruta)) texto = 'Eliminando el programa';
    if (conArchivos) return { texto: texto + (nombreArchivo ? ' con «' + nombreArchivo + '»' : ' con sus documentos'), subida: true };
    return { texto };
  }
  // Sin ventana: consultas, entrar, enlaces de documentos, el minutario (se guarda celda por celda)
  // y lo que ya tiene su propia ventana de carga (salas)
  const esApi = (url) => /\/api\//.test(url);
  const sinVentana = (url, metodo) => metodo === 'GET' || /\/api\/auth\/|\/despertar/.test(url);

  const mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';


  /* ─────────────── Envolver fetch: cada guardado lleva su ventana de trabajo ─────────────── */
  function subirConAvance(url, opciones, alAvanzar) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(opciones.method || 'POST', url);
      x.responseType = 'blob';
      const h = opciones.headers instanceof Headers ? Object.fromEntries(opciones.headers.entries()) : (opciones.headers || {});
      Object.entries(h).forEach(([k, v]) => x.setRequestHeader(k, v));
      x.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(e.loaded, e.total); };
      x.onload = () => {
        const encabezados = new Headers();
        x.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(l => { const i = l.indexOf(':'); if (i > 0) { try { encabezados.append(l.slice(0, i).trim(), l.slice(i + 1).trim()); } catch (e) { /* encabezado raro */ } } });
        resolve(new Response(x.status === 204 ? null : x.response, { status: x.status, statusText: x.statusText, headers: encabezados }));
      };
      x.onerror = () => reject(new TypeError('Failed to fetch'));
      x.send(opciones.body);
    });
  }

  // Nunca dos ventanas de la mascota a la vez: si ella abre un diálogo (aviso, confirmación,
  // «¡Listo!…»), la ventana de trabajo se cierra antes; y mientras haya diálogo no se abre otra.
  const dialogoAbierto = () => !!document.querySelector('.ms-dlg-overlay:not(.ms-trabajo)');
  const preguntarOriginal = M.preguntar;
  M.preguntar = function () {
    if (op) { const o = op; op = null; finalizarYa(o); }
    return preguntarOriginal.apply(this, arguments);
  };

  window.fetch = async function (entrada, opciones = {}) {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
    const metodo = String(opciones.method || (entrada && entrada.method) || 'GET').toUpperCase();
    if (!esApi(url) || !encendido() || sinVentana(url, metodo) || (!op && dialogoAbierto())) {
      // Si ya hay una ventana abierta (se recarga la lista después de guardar), la espera
      if (!op || metodo !== 'GET' || !esApi(url)) return origFetch(entrada, opciones);
      op.pendientes++;
      try { return await origFetch(entrada, opciones); }
      finally { if (op) { op.pendientes = Math.max(0, op.pendientes - 1); esperarCierre(); } }
    }
    const info = describir(url, metodo, opciones.body);
    const paso = empezarPaso(info);
    try {
      let r;
      if (info.subida && typeof entrada === 'string') {
        const o = op;
        r = await subirConAvance(url, opciones, (va, total) => {
          if (o.cerrando) return;
          o.subiendo = Math.max(o.subiendo || 0, va / total * 85);
          o.el('.ms-trab-det').textContent = va < total ? `${mb(va)} de ${mb(total)}` : 'Guardando en el expediente…';
        });
      } else {
        r = await origFetch(entrada, opciones);
      }
      if (!r.ok) {
        // El error lo explica la página (y la mascota) con su propio aviso: aquí solo se cierra
        if (op) { const o = op; op = null; finalizarYa(o); }
        return r;
      }
      terminarPaso(paso);
      return r;
    } catch (err) {
      if (op) { const o = op; op = null; finalizarYa(o); }
      throw err;
    }
  };

  /* ─────────────── Preferencias por usuario: encender/apagar y color ─────────────── */
  let refrescarPantalla = () => {};
  const COLORES = [
    { nombre: 'Dorado', color: null, muestra: '#E6CB93' },
    { nombre: 'Perla', color: '#DCE2EC' },
    { nombre: 'Rosa', color: '#F2B8C6' },
    { nombre: 'Guinda', color: '#B0475F' },
    { nombre: 'Durazno', color: '#F5B98E' },
    { nombre: 'Menta', color: '#A8DCC2' },
    { nombre: 'Cielo', color: '#A9CBEF' },
    { nombre: 'Lavanda', color: '#C7B6EA' },
    { nombre: 'Carbón', color: '#6E6A72' },
    { nombre: 'Galaxia', color: 'galaxia', muestra: 'radial-gradient(circle at 30% 30%, #fff 0 4%, transparent 6%), radial-gradient(circle at 70% 60%, #fff 0 3%, transparent 5%), radial-gradient(ellipse at 30% 30%, #7B5CF0, transparent 60%), radial-gradient(ellipse at 75% 75%, #E0559F, transparent 60%), #1B1347' }
  ];
  const clavePref = () => clavePrefUsuario();
  const PREF_BASE = { activo: true, color: null, estrella: 'guinda', ropa: 'ninguna', gafas: 'ninguno' };
  const ESTRELLAS = [{ clave: 'guinda', nombre: 'Guinda', muestra: '#9C2647' }, { clave: 'dorada', nombre: 'Dorada', muestra: '#D8B866' }];
  // Cada prenda se dibuja con dos capas (a y b) sobre el cuerpo: posición, tamaño, recorte y relleno
  const GUINDA = '#7A1E35', GUINDA_OSC = '#5A0F24', ORO = '#D8B866';
  const ROPAS = {
    ninguna: { nombre: 'Ninguna', icono: 'ti-circle-off' },
    mono: { nombre: 'Moño', icono: 'ti-ribbon-health', a: { x: '33%', y: '71%', w: '34%', h: '15%',
      bg: `radial-gradient(circle at 50% 50%, ${GUINDA_OSC} 0 15%, ${GUINDA} 16% 100%)`, clip: 'polygon(0 0, 50% 36%, 100% 0, 100% 100%, 50% 64%, 0 100%)' } },
    corbata: { nombre: 'Corbata', icono: 'ti-tie', a: { x: '40.5%', y: '66%', w: '19%', h: '40%',
      bg: `repeating-linear-gradient(135deg, transparent 0 5px, rgba(216, 184, 102, .55) 5px 7px), linear-gradient(180deg, ${GUINDA_OSC} 0 16%, ${GUINDA} 16% 100%)`,
      clip: 'polygon(22% 0, 78% 0, 68% 16%, 100% 80%, 50% 100%, 0 80%, 32% 16%)' } },
    bufanda: { nombre: 'Bufanda', icono: 'ti-wind',
      a: { x: '-5%', y: '70%', w: '110%', h: '16%', r: '45% / 50%', bg: `repeating-linear-gradient(90deg, ${GUINDA} 0 12px, ${ORO} 12px 17px)` },
      b: { x: '18%', y: '76%', w: '15%', h: '36%', r: '3px 3px 7px 7px', bg: `repeating-linear-gradient(180deg, ${GUINDA} 0 9px, ${ORO} 9px 13px)` } },
    saco: { nombre: 'Saco', icono: 'ti-shirt',
      b: { x: '0', y: '64%', w: '100%', h: '36%', r: '0 0 30% 30% / 0 0 45% 45%',
        bg: `linear-gradient(180deg, ${GUINDA} 0%, ${GUINDA_OSC} 100%)`, clip: 'polygon(0 0, 36% 0, 50% 55%, 64% 0, 100% 0, 100% 100%, 0 100%)' },
      a: { x: '47%', y: '80%', w: '6%', h: '14%', bg: `radial-gradient(circle at 50% 22%, ${ORO} 0 32%, transparent 34%), radial-gradient(circle at 50% 78%, ${ORO} 0 32%, transparent 34%)` } }
  };
  // Lentes: dos micas sobre los ojos (forma, marco y relleno por variables)
  const GAFAS = {
    ninguno: { nombre: 'Ninguno', icono: 'ti-circle-off' },
    redondos: { nombre: 'Redondos', icono: 'ti-eyeglass', v: { borde: '2px solid #2A2228', radio: '50%', fondo: 'rgba(255,255,255,.12)', marco: '#2A2228' } },
    cuadrados: { nombre: 'Cuadrados', icono: 'ti-eyeglass-2', v: { borde: '3px solid #1C1A1D', radio: '18%', fondo: 'rgba(255,255,255,.1)', marco: '#1C1A1D', w: '23.5%', h: '30%', top: '32%' } },
    sol: { nombre: 'De sol', icono: 'ti-sunglasses', v: { borde: '2px solid #111', radio: '28% 28% 46% 46%', fondo: 'linear-gradient(160deg, #5A5866 0%, #17161C 55%, #000 100%)', marco: '#111', w: '23.5%', h: '31%', top: '31%' } },
    corazon: { nombre: 'Corazón', icono: 'ti-heart', v: { borde: '0', radio: '0', fondo: 'linear-gradient(160deg, rgba(255,130,175,.9), rgba(200,30,90,.85))', marco: '#B0175A', clip: 'polygon(50% 100%, 6% 52%, 0 30%, 8% 8%, 28% 0, 50% 16%, 72% 0, 92% 8%, 100% 30%, 94% 52%)', w: '23.5%', h: '30%', top: '31%' } },
    gato: { nombre: 'Ojo de gato', icono: 'ti-cat', v: { borde: '2px solid #4A0A1D', bordeArriba: '4px solid #4A0A1D', radio: '62% 62% 46% 46% / 72% 72% 42% 42%', fondo: 'rgba(255,255,255,.08)', marco: '#4A0A1D', rotIzq: '-10deg', rotDer: '10deg' } },
    dorados: { nombre: 'Dorados', icono: 'ti-eyeglass', v: { borde: '2px solid #B8922F', radio: '50%', fondo: 'rgba(255,240,200,.15)', marco: '#B8922F' } }
  };
  const GALAXIA = {
    fondo: 'radial-gradient(circle at 22% 30%, #fff 0 1.2%, transparent 1.8%), radial-gradient(circle at 70% 22%, #fff 0 1%, transparent 1.6%), radial-gradient(circle at 82% 62%, #fff 0 1.3%, transparent 2%), radial-gradient(circle at 35% 78%, #fff 0 .9%, transparent 1.5%), radial-gradient(circle at 55% 48%, rgba(255,255,255,.8) 0 .7%, transparent 1.2%), radial-gradient(circle at 12% 62%, rgba(255,255,255,.85) 0 .8%, transparent 1.4%), radial-gradient(ellipse 60% 45% at 28% 25%, rgba(123, 92, 240, .95), transparent 70%), radial-gradient(ellipse 55% 50% at 78% 78%, rgba(224, 85, 159, .85), transparent 70%), radial-gradient(ellipse 40% 35% at 70% 30%, rgba(80, 180, 255, .55), transparent 70%), linear-gradient(160deg, #241A5C 0%, #1B1347 45%, #0C0A24 100%)',
    sombra: 'inset 0 -7px 12px rgba(10, 5, 40, .6), inset 0 4px 8px rgba(200, 180, 255, .45), 0 0 0 1px rgba(150, 120, 255, .6), 0 0 18px rgba(140, 100, 255, .55), 0 8px 18px rgba(20, 5, 50, .45)',
    ojo: 'radial-gradient(ellipse 60% 55% at 45% 40%, #FFFFFF 0%, #E4E8FF 70%, #B9C2FF 100%)'
  };
  function aplicarApariencia(el, { color, estrella, ropa, gafas } = {}) {
    if (color) { el.style.setProperty('--ms-color', color === 'galaxia' ? '#5B47C8' : color); el.setAttribute('data-ms-color', ''); }
    else { el.style.removeProperty('--ms-color'); el.removeAttribute('data-ms-color'); }
    // 'initial' deja la variable vacía: así la vista previa no hereda la galaxia de la página
    const gal = color === 'galaxia';
    el.style.setProperty('--ms-fondo', gal ? GALAXIA.fondo : 'initial');
    el.style.setProperty('--ms-sombra', gal ? GALAXIA.sombra : 'initial');
    el.style.setProperty('--ms-ojo-fondo', gal ? GALAXIA.ojo : 'initial');
    el.style.setProperty('--ms-brillos', gal ? 'block' : 'none');
    el.style.setProperty('--ms-ojo-dormido', gal ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 18'%3E%3Cpath d='M2.5 5 Q12 16 21.5 5' fill='none' stroke='%23F2EEFF' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")` : 'initial');
    const g = (GAFAS[gafas] || GAFAS.ninguno).v;
    el.style.setProperty('--gafas', g ? 'block' : 'none');
    // Con lentes elegidos, el ayudante de las ventanas de edición deja sus lentes de lectura
    el.style.setProperty('--lentes-lectura', g ? 'none' : 'initial');
    el.style.setProperty('--ojo-izq-lectura', g ? '32.5%' : 'initial');
    el.style.setProperty('--ojo-der-lectura', g ? '57.3%' : 'initial');
    [['borde', 'g-borde'], ['bordeArriba', 'g-borde-arriba'], ['radio', 'g-radio'], ['fondo', 'g-fondo'], ['marco', 'g-marco'], ['clip', 'g-clip'],
     ['w', 'g-w'], ['h', 'g-h'], ['top', 'g-top'], ['rotIzq', 'g-rot-izq'], ['rotDer', 'g-rot-der']].forEach(([k, v]) => {
      el.style.setProperty('--' + v, g && g[k] ? g[k] : 'initial');
    });
    el.style.setProperty('--ms-oro', estrella === 'dorada' ? '1' : '0');
    const r = ROPAS[ropa] || ROPAS.ninguna;
    ['a', 'b'].forEach(k => {
      const c = r[k];
      el.style.setProperty(`--ropa-${k}`, c ? 'block' : 'none');
      [['x', 'x'], ['y', 'y'], ['w', 'w'], ['h', 'h'], ['bg', 'bg'], ['clip', 'clip'], ['r', 'r'], ['sombra', 'sombra']].forEach(([p, v]) => {
        if (c && c[v]) el.style.setProperty(`--ropa-${k}-${p}`, c[v]); else el.style.removeProperty(`--ropa-${k}-${p}`);
      });
    });
  }
  function pintarColor(color) { aplicarApariencia(document.documentElement, color === null ? {} : { color: pref.color, estrella: pref.estrella, ropa: pref.ropa, gafas: pref.gafas }); }

  // Cada mascota (esquina, diálogos, ventanas, vista previa) lleva sus lentes y sus brillitos, ocultos hasta que se eligen
  function equipar(raiz) {
    (raiz.matches && raiz.matches('.minisebiso') ? [raiz] : []).concat([...(raiz.querySelectorAll ? raiz.querySelectorAll('.minisebiso') : [])]).forEach(m => {
      const cuerpo = m.querySelector('.ms-cuerpo');
      if (cuerpo && !cuerpo.querySelector('.ms-gafas')) cuerpo.insertAdjacentHTML('beforeend', '<span class="ms-gafas" aria-hidden="true"><i></i><i></i></span>');
      if (!m.querySelector('.ms-brillos')) m.insertAdjacentHTML('beforeend', '<span class="ms-brillos" aria-hidden="true">' + '<i></i>'.repeat(7) + '</span>');
    });
  }
  equipar(document.body);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) equipar(n); }))).observe(document.body, { childList: true, subtree: true });

  function aplicarPref() {
    pintarColor(enLogin() ? null : true);
    const t = document.querySelector('.nav-asistente');
    if (t) {
      t.setAttribute('aria-pressed', encendido() ? 'true' : 'false');
      t.title = encendido() ? 'Asistente encendido: toca para apagarlo' : 'Asistente apagado: toca para encenderlo';
    }
    if (!encendido()) { cerrarAyuda(); M.callar && M.callar(); }
    refrescarPantalla();
  }
  async function cargarPref() {
    try { const c = JSON.parse(localStorage.getItem(clavePref()) || 'null'); if (c) { pref = { ...PREF_BASE, ...c }; aplicarPref(); } } catch (e) { /* sin storage */ }
    try {
      const d = await peticionOriginal('/auth/preferencias');
      pref = { ...PREF_BASE, ...(d.asistente || {}) };
      try { localStorage.setItem(clavePref(), JSON.stringify(pref)); } catch (e) { /* sin storage */ }
      aplicarPref();
    } catch (e) { /* sin conexión: se queda con lo guardado en este equipo */ }
  }
  async function guardarPref(cambios) {
    pref = { ...pref, ...cambios };
    try { localStorage.setItem(clavePref(), JSON.stringify(pref)); } catch (e) { /* sin storage */ }
    aplicarPref();
    try { await peticionOriginal('/auth/preferencias', { method: 'PUT', body: JSON.stringify({ asistente: cambios }) }); }
    catch (e) { avisoOriginal('Se aplicó en este equipo, pero no se pudo guardar en tu usuario: ' + e.message, true); }
  }

  function prepararBotonesEncabezado() {
    const salir = document.getElementById('btnLogout');
    if (!salir || document.querySelector('.nav-asistente')) return;
    const grupo = document.createElement('div');
    grupo.className = 'nav-asis-grupo';
    grupo.innerHTML = `
      <button type="button" class="nav-asistente" aria-pressed="true">
        <span class="nav-asis-switch" aria-hidden="true"><span></span></span>
        <span class="nav-asis-texto">Asistente</span>
      </button>
      <button type="button" class="nav-asis-color" aria-label="Personalizar el color del asistente" title="Personalizar el asistente"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
    salir.parentNode.insertBefore(grupo, salir);
    grupo.querySelector('.nav-asistente').addEventListener('click', async () => {
      const prender = !encendido();
      await guardarPref({ activo: prender });
      if (prender) setTimeout(() => M.decir('¡Aquí estoy de nuevo! Tócame cuando necesites ayuda.', { duracion: 4500 }), 150);
      else avisoOriginal('Asistente apagado. Puedes encenderlo cuando quieras.');
    });
    grupo.querySelector('.nav-asis-color').addEventListener('click', abrirPersonalizar);
    aplicarPref();
  }

  // Ventana para personalizar: vista previa en vivo con color, estrella y ropa
  function abrirPersonalizar() {
    if (document.querySelector('.ms-perso')) return;
    const elegido = { color: pref.color, estrella: pref.estrella || 'guinda', ropa: pref.ropa || 'ninguna', gafas: pref.gafas || 'ninguno' };
    const inicial = { ...elegido, color: elegido.color || null };
    const opcion = (grupo, valor, texto, extra = '') => `<button type="button" class="ms-perso-op" role="radio" data-grupo="${grupo}" data-valor="${valor}" ${extra}><span>${texto}</span></button>`;
    const fondo = document.createElement('div');
    fondo.className = 'ms-dlg-overlay ms-perso';
    fondo.innerHTML = `
      <div class="ms-perso-caja" role="dialog" aria-modal="true" aria-labelledby="ms-perso-titulo">
        <button type="button" class="ms-perso-cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>
        <div class="ms-perso-vista">
          <div class="minisebiso ms-perso-mascota" aria-hidden="true">${mascotaHTML()}</div>
        </div>
        <div class="ms-perso-cuerpo">
          <span class="ms-dlg-saludo">Personaliza a tu asistente</span>
          <h2 id="ms-perso-titulo" class="ms-perso-titulo">¿Cómo me quieres?</h2>
          <p class="ms-perso-ayuda">Se guarda en tu usuario: me verás así en cualquier equipo donde entres.</p>
          <div class="ms-perso-seccion">Color</div>
          <div class="ms-perso-colores" role="radiogroup" aria-label="Color">
            ${COLORES.map((c, i) => `<button type="button" class="ms-perso-color" role="radio" data-i="${i}" style="--c:${c.muestra || c.color}" aria-label="${c.nombre}"><span>${c.nombre}</span></button>`).join('')}
            <label class="ms-perso-color ms-perso-libre" title="Elige cualquier color">
              <input type="color" value="${/^#/.test(elegido.color || '') ? elegido.color : '#E6CB93'}" aria-label="Otro color"><span>Otro</span>
            </label>
          </div>
          <div class="ms-perso-seccion">Estrella</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Estrella">
            ${ESTRELLAS.map(e => opcion('estrella', e.clave, e.nombre, `style="--c:${e.muestra}"`)).join('')}
          </div>
          <div class="ms-perso-seccion">Lentes</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Lentes">
            ${Object.entries(GAFAS).map(([k, g]) => opcion('gafas', k, `<i class="ti ${g.icono}" aria-hidden="true"></i> ${g.nombre}`)).join('')}
          </div>
          <div class="ms-perso-seccion">Ropa</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Ropa">
            ${Object.entries(ROPAS).map(([k, r]) => opcion('ropa', k, `<i class="ti ${r.icono}" aria-hidden="true"></i> ${r.nombre}`)).join('')}
          </div>
          <div class="ms-dlg-botones">
            <button type="button" class="ms-dlg-btn ms-dlg-cancelar" data-perso="cancelar">Cancelar</button>
            <button type="button" class="ms-dlg-btn ms-dlg-ok ms-dlg-ok-dorado" data-perso="guardar"><i class="ti ti-device-floppy"></i> Guardar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(fondo);
    requestAnimationFrame(() => fondo.classList.add('visible'));
    const vista = fondo.querySelector('.ms-perso-vista');
    const mascota = fondo.querySelector('.ms-perso-mascota');
    const libre = fondo.querySelector('input[type="color"]');
    const marcar = () => {
      aplicarApariencia(vista, { color: elegido.color || '#E6CB93', estrella: elegido.estrella, ropa: elegido.ropa, gafas: elegido.gafas });
      if (!elegido.color) vista.removeAttribute('data-ms-color');
      fondo.querySelectorAll('.ms-perso-color[data-i]').forEach(b => {
        const c = COLORES[Number(b.dataset.i)].color;
        b.setAttribute('aria-checked', String((c || null) === (elegido.color || null)));
      });
      const esLibre = !!elegido.color && !COLORES.some(c => c.color && c.color.toLowerCase() === elegido.color.toLowerCase());
      const lb = fondo.querySelector('.ms-perso-libre');
      lb.classList.toggle('activo', esLibre);
      if (esLibre) lb.style.setProperty('--c', elegido.color);
      fondo.querySelectorAll('.ms-perso-op').forEach(b => b.setAttribute('aria-checked', String(elegido[b.dataset.grupo] === b.dataset.valor)));
    };
    const brincar = () => { if (!quieto) mascota.animate([{ transform: 'none' }, { transform: 'translateY(-14px) scale(1.04, .96)', offset: .4 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' }); };
    fondo.querySelectorAll('.ms-perso-color[data-i]').forEach(b => b.addEventListener('click', () => { elegido.color = COLORES[Number(b.dataset.i)].color; marcar(); brincar(); }));
    fondo.querySelectorAll('.ms-perso-op').forEach(b => b.addEventListener('click', () => { elegido[b.dataset.grupo] = b.dataset.valor; marcar(); brincar(); }));
    libre.addEventListener('input', () => { elegido.color = libre.value; marcar(); });
    libre.addEventListener('change', brincar);
    const cerrar = () => { fondo.classList.remove('visible'); setTimeout(() => fondo.remove(), 220); document.removeEventListener('keydown', tecla); };
    const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.ms-perso-cerrar').onclick = cerrar;
    fondo.querySelector('[data-perso="cancelar"]').onclick = cerrar;
    fondo.querySelector('[data-perso="guardar"]').onclick = async () => {
      cerrar();
      // Solo lo que cambió en esta ventana (así no se pisa con algo viejo guardado en el equipo)
      const nuevo = { color: elegido.color || null, estrella: elegido.estrella, ropa: elegido.ropa, gafas: elegido.gafas };
      const cambios = Object.fromEntries(Object.entries(nuevo).filter(([k, v]) => v !== inicial[k]));
      if (Object.keys(cambios).length) await guardarPref(cambios);
      if (encendido()) setTimeout(() => M.decir('¡Me encanta cómo me veo!', { duracion: 3500 }), 250);
      else avisoOriginal('Apariencia guardada.');
    };
    marcar();
    fondo.querySelector('.ms-perso-color[aria-checked="true"], .ms-perso-libre').focus();
  }

  /* ─────────────── Que no tape nada: si hay un botón o campo debajo, se asoma desde el borde ─────────────── */
  function vigilarDebajo() {
    const esq = M.esquina && M.esquina();
    if (!esq) return;
    const INTERACTIVO = 'button, a, input, select, textarea, label, [role="button"], [onclick]';
    let pendiente = false;
    const revisar = () => {
      pendiente = false;
      if (esq.classList.contains('ms-oculto') || esq.style.visibility === 'hidden') return;
      if (esq.classList.contains('hablando') || panelAyuda() || esq.matches(':hover, :focus-visible')) { esq.classList.remove('ms-asomado'); return; }
      // Su lugar normal (sin el desplazamiento de "asomado"), para no parpadear
      const cs = getComputedStyle(esq), w = esq.offsetWidth, h = esq.offsetHeight;
      // (clientWidth/Height: sin la barra de desplazamiento)
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const r = { left: vw - parseFloat(cs.right) - w + 4, top: vh - parseFloat(cs.bottom) - h + 4, right: vw - parseFloat(cs.right) - 4, bottom: vh - parseFloat(cs.bottom) - 4 };
      if (![r.left, r.top, r.right, r.bottom].every(Number.isFinite) || r.right <= r.left) return;   // aún sin medidas (p. ej. mientras está en un diálogo)
      const tapa = [...document.querySelectorAll(INTERACTIVO)].some(el => {
        if (esq.contains(el) || el.closest('.pa-ayuda, .ms-dlg-overlay')) return false;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || b.bottom < r.top || b.top > r.bottom || b.right < r.left || b.left > r.right) return false;
        // Solo si de verdad se ve ahí (no tapado por una ventana ni recortado)
        const x = Math.max(b.left, r.left) + 1, y = Math.max(b.top, r.top) + 1;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        return document.elementsFromPoint(x, y).some(e => e === el || el.contains(e));
      });
      esq.classList.toggle('ms-asomado', tapa);
    };
    const programar = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); } };
    addEventListener('scroll', programar, { passive: true, capture: true });
    addEventListener('resize', programar);
    new MutationObserver(programar).observe(document.querySelector('main') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    esq.addEventListener('mouseenter', () => esq.classList.remove('ms-asomado'));
    esq.addEventListener('mouseleave', programar);
    new MutationObserver(programar).observe(esq, { attributes: true, attributeFilter: ['class'] });
    setInterval(programar, 1500);
    programar();
  }


  /* ─────────────── Arranque ─────────────── */
  const clavePrefUsuario = () => 'pb_pref_' + (usuario && (usuario.id || usuario.email) || '');
  // Encabezado: los usuarios conectados van a la derecha de «Cerrar sesión»
  // (la página los vuelve a poner al principio cada vez que los actualiza)
  function acomodarEncabezado() {
    // El usuario va fijo en la esquina inferior izquierda: fuera del encabezado
    const yo = document.querySelector('.navbar-wrap .nav-user');
    if (yo) { yo.classList.add('nav-user-esquina'); document.body.appendChild(yo); }
  }
  function iniciar() {
    acomodarEncabezado();
    const esq = M.esquina && M.esquina();
    refrescarPantalla = () => { if (esq) esq.classList.toggle('ms-oculto', !encendido() || document.body.hasAttribute('data-ms-sin-esquina')); };
    prepararBotonesEncabezado();
    if (usuario) cargarPref();
    vigilarDebajo();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(iniciar, 0));
  else iniciar();
})();
