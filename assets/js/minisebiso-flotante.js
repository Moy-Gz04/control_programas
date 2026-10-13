// =========================================================
// minisebiso-flotante.js
// Coloca a MiniSEBISO dormido en la esquina inferior derecha.
// Al tocarlo despierta y habla (MiniSEBISO.decir); lo que dice al
// tocarlo lo decide el asistente (minisebiso-asistente.js).
// =========================================================

// Velocidad de las animaciones de MiniSEBISO (1 = original; menor = más rápido)
var VEL = 0.5;

// Dónde ponerse junto a algo (rect c) sin taparlo, con su globo (230 px) debajo:
// a la derecha si cabe; si no, a la izquierda con el globo hacia la izquierda; si no, debajo.
function msJunto(c, W, H) {
  const B = 230;
  let x, y = c.top + c.height / 2 - H / 2, izq = false;
  if (c.right + 14 + Math.max(W, B) <= innerWidth - 8) x = c.right + 14;
  else if (c.left - 14 - W >= 8 && c.left - 14 - B >= 8) { x = c.left - 14 - W; izq = true; }
  else { x = Math.max(8, Math.min(c.left, innerWidth - B - 8)); y = c.bottom + 8; }
  y = Math.max(8, Math.min(y, innerHeight - H - 100));
  return { x, y, izq };
}

(function () {
  if (document.querySelector('.ms-flotante')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'assets/css/minisebiso-flotante.css?v=13';
  document.head.appendChild(css);

  const ms = document.createElement('div');
  ms.className = 'minisebiso ms-flotante dormido';
  ms.setAttribute('role', 'button');
  ms.setAttribute('tabindex', '0');
  ms.setAttribute('aria-label', 'Asistente del sistema. Toca para pedirle ayuda');
  ms.innerHTML = `
    <div class="ms-burbuja" aria-live="polite">¿En qué puedo ayudarte?</div>
    <div class="ms-zzz" aria-hidden="true"><span>z</span><span>z</span><span>Z</span></div>
    <div class="ms-cuerpo">
      <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
      <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
    </div>
    <div class="ms-estrella"></div>`;
  // Páginas sin espacio para la mascota de la esquina (data-ms-sin-esquina en <body>)
  if (document.body.hasAttribute('data-ms-sin-esquina')) ms.classList.add('ms-oculto');
  document.body.appendChild(ms);
  const burbuja = ms.querySelector('.ms-burbuja');

  const ojos = ms.querySelectorAll('.ms-ojo-mov');
  const centrar = () => ojos.forEach(o => { o.style.setProperty('--dx', '0px'); o.style.setProperty('--dy', '0px'); });
  window.addEventListener('pointermove', (e) => {
    if (ms.classList.contains('dormido')) return;
    ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1, f = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (dx / dist * r.width * .55 * f).toFixed(1) + 'px');
      o.style.setProperty('--dy', (dy / dist * r.height * .32 * f).toFixed(1) + 'px');
    });
  });

  // Otras apariciones de MiniSEBISO (diálogo, ayudante, presentador) lo
  // "toman" de la esquina mientras están en pantalla; con un contador para
  // que nunca haya dos mascotas a la vez ni se quede escondido de más.
  let tomas = 0;
  function tomarEsquina() {
    tomas++;
    clearTimeout(dormir); alTocarBurbuja = null;
    ms.classList.remove('dormido', 'hablando', 'ms-con-accion');
    ms.style.visibility = 'hidden';
  }
  function soltarEsquina() {
    tomas = Math.max(0, tomas - 1);
    if (tomas) return;
    ms.style.visibility = '';
    if (!atendiendo) ms.classList.add('dormido');
  }

  // MiniSEBISO.decir(texto, { duracion, alTocar }): despierta en su esquina,
  // brinca y dice el texto. Si trae alTocar, tocarlo mientras habla lo ejecuta.
  let dormir = null, alTocarBurbuja = null;
  function decir(texto, { duracion = 6000, alTocar = null, accion = '' } = {}) {
    if (tomas || ms.classList.contains('ms-oculto')) return false;
    clearTimeout(dormir);
    burbuja.textContent = texto;
    if (alTocar && accion) {
      const btn = document.createElement('span');
      btn.className = 'ms-burbuja-accion';
      btn.textContent = accion;
      burbuja.appendChild(btn);
    }
    alTocarBurbuja = alTocar;
    ms.classList.toggle('ms-con-accion', !!alTocar);
    ms.classList.remove('dormido', 'saltando'); void ms.offsetWidth;
    ms.classList.add('saltando', 'hablando');
    ms.setAttribute('aria-label', 'Asistente: ' + texto);
    dormir = setTimeout(callar, duracion);
    return true;
  }
  function callar() {
    clearTimeout(dormir); alTocarBurbuja = null;
    ms.classList.remove('hablando', 'ms-con-accion');
    centrar();
    if (!tomas && !atendiendo) ms.classList.add('dormido');
    ms.setAttribute('aria-label', 'Asistente del sistema. Toca para pedirle ayuda');
  }
  function tocar() {
    if (alTocarBurbuja) { const f = alTocarBurbuja; callar(); f(); return; }
    const M = window.MiniSEBISO || {};
    if (M.alTocarEsquina) M.alTocarEsquina();
    else decir('¿En qué puedo ayudarte?');
  }
  let atendiendo = false;
  function despierto(si) {
    atendiendo = !!si;
    if (tomas) return;
    if (si) { clearTimeout(dormir); ms.classList.remove('dormido', 'hablando', 'saltando'); void ms.offsetWidth; ms.classList.add('saltando'); }
    else { centrar(); ms.classList.add('dormido'); }
  }
  ms.addEventListener('click', tocar);
  ms.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocar(); } });
  ms.addEventListener('animationend', (e) => { if (e.animationName === 'msSalto') ms.classList.remove('saltando'); });

  window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { decir, callar, tomarEsquina, soltarEsquina, despierto, esquina: () => ms });
})();

// =========================================================
// MiniSEBISO.preguntar(): diálogo de confirmación "hablado" por la mascota.
// Salta desde su esquina hasta un lado de la ventana, la ventana es su globo
// de diálogo y responde con una animación distinta al cancelar o confirmar.
// Devuelve una promesa con true (confirmó) o false (canceló).
// =========================================================
(function () {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esperar = (ms) => new Promise(r => setTimeout(r, ms));
  const anim = (el, frames, opts) => quieto ? Promise.resolve() : el.animate(frames, Object.assign({}, opts, { duration: Math.round(opts.duration * VEL) })).finished.catch(() => {});

  function mascotaHTML() {
    return `
      <div class="ms-cuerpo">
        <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
        <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
      </div>
      <div class="ms-estrella"></div>`;
  }

  // Los diálogos van en fila: si llega otro mientras uno está abierto, espera su turno
  let fila = Promise.resolve();
  function preguntar(opciones) {
    const turno = fila.then(() => preguntarAhora(opciones));
    fila = turno.catch(() => {});
    return turno;
  }

  async function preguntarAhora({ titulo = '¡Hola!', pregunta = '', detalle = '', btnOk = 'Sí, eliminar', btnCancel = 'Cancelar', iconoOk = 'ti-trash', soloOk = false, saludoOk = '¡Entendido!', textoOk = 'Lo elimino ahora mismo…', saludoCancel = '¡Va!', textoCancel = 'Lo dejamos como está.', tono = '', estiloOk = '' } = {}) {
    const esquina = document.querySelector('.ms-flotante:not(.ms-oculto)');
    const overlay = document.createElement('div');
    overlay.className = 'ms-dlg-overlay';
    overlay.innerHTML = `
      <div class="ms-dlg-escena" role="alertdialog" aria-modal="true" aria-labelledby="ms-dlg-pregunta">
        <div class="minisebiso ms-dlg-mascota" aria-hidden="true">${mascotaHTML()}</div>
        <div class="ms-dlg-globo">
          <div class="ms-dlg-saludo">${titulo}</div>
          <div class="ms-dlg-pregunta" id="ms-dlg-pregunta">${pregunta}</div>
          ${detalle ? `<div class="ms-dlg-detalle">${detalle}</div>` : ''}
          <div class="ms-dlg-botones">
            ${soloOk ? '' : `<button type="button" class="ms-dlg-btn ms-dlg-cancelar"><i class="ti ti-x"></i> ${btnCancel}</button>`}
            <button type="button" class="ms-dlg-btn ms-dlg-ok${estiloOk ? ' ms-dlg-ok-' + estiloOk : (soloOk ? ' ms-dlg-ok-dorado' : '')}"><i class="ti ${iconoOk}"></i> ${btnOk}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const mascota = overlay.querySelector('.ms-dlg-mascota');
    const globo = overlay.querySelector('.ms-dlg-globo');
    const ojos = mascota.querySelectorAll('.ms-ojo-mov');
    const mirar = (dx, dy) => ojos.forEach(o => { o.style.setProperty('--dx', dx + 'px'); o.style.setProperty('--dy', dy + 'px'); });
    // Durante el vuelo los ojos giran en círculo, como mareado; devuelve una función para detenerlos
    const ojosEnVuelo = (ms) => { ms *= VEL;
      if (quieto) return () => {};
      const t0 = performance.now(); let id = 0;
      const paso = (t) => {
        const a = (t - t0) / 110;                 // ~una vuelta de ojos cada 0.7 s
        mirar(Math.cos(a) * 5, Math.sin(a) * 4);
        if (t - t0 < ms) id = requestAnimationFrame(paso);
      };
      id = requestAnimationFrame(paso);
      return () => cancelAnimationFrame(id);
    };

    // Desde dónde salta: la mascota de la esquina (o la esquina inferior derecha)
    const destino = mascota.getBoundingClientRect();
    const origen = esquina ? esquina.getBoundingClientRect() : { left: innerWidth - 110, top: innerHeight - 100, width: 92, height: 83 };
    const dx = (origen.left + origen.width / 2) - (destino.left + destino.width / 2);
    const dy = (origen.top + origen.height / 2) - (destino.top + destino.height / 2);
    const s0 = origen.width / destino.width;
    const M = window.MiniSEBISO;
    M.tomarEsquina && M.tomarEsquina();
    if (tono) overlay.classList.add('ms-tono-' + tono);

    requestAnimationFrame(() => overlay.classList.add('visible'));
    globo.style.opacity = '0';
    // Salto en arco con marometa (una vuelta completa); los ojos van dando vueltas
    const pararOjos = ojosEnVuelo(1000);
    await anim(mascota, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(0deg)` },
      { transform: `translate(${dx * .7}px, ${dy * .7 - 120}px) scale(${(s0 * 2 + 1) / 3}) rotate(-60deg)`, offset: .25 },
      { transform: `translate(${dx * .4}px, ${dy * .4 - 210}px) scale(${(s0 + 1) / 2}) rotate(-200deg)`, offset: .55 },
      { transform: 'translate(0, -40px) scale(1.04) rotate(-330deg)', offset: .85 },
      { transform: 'translate(0, 0) scale(1) rotate(-360deg)' }
    ], { duration: 1000, easing: 'cubic-bezier(.4, .05, .4, 1)' });
    pararOjos();
    await anim(mascota, [
      { transform: 'scale(1.12, .86)' }, { transform: 'scale(.95, 1.06)' }, { transform: 'scale(1)' }
    ], { duration: 320, easing: 'ease-out' });
    // Su primera reacción depende de la noticia: festeja, se preocupa o avisa
    if (tono === 'exito') {
      await anim(mascota, [
        { transform: 'none' }, { transform: 'translateY(-26px) rotate(-8deg) scale(1.05)', offset: .4 },
        { transform: 'translateY(0) rotate(0) scale(1.08, .92)', offset: .75 }, { transform: 'none' }
      ], { duration: 520, easing: 'ease-out' });
    } else if (tono === 'error' || tono === 'aviso') {
      await anim(mascota, [
        { transform: 'rotate(0)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(7deg)' },
        { transform: 'rotate(-4deg)' }, { transform: 'rotate(0)' }
      ], { duration: 460, easing: 'ease-in-out' });
    }
    // El globo "sale" de la mascota
    globo.style.opacity = '';
    mirar(4, 0);
    await anim(globo, [
      { opacity: 0, transform: 'translateX(-24px) scale(.6)' },
      { opacity: 1, transform: 'translateX(4px) scale(1.03)', offset: .7 },
      { opacity: 1, transform: 'none' }
    ], { duration: 380, easing: 'cubic-bezier(.34, 1.56, .64, 1)' });
    overlay.querySelector(soloOk ? '.ms-dlg-ok' : '.ms-dlg-cancelar').focus();

    const respuesta = await new Promise((resolve) => {
      overlay.querySelector('.ms-dlg-ok').onclick = () => resolve(true);
      if (soloOk) return;
      overlay.querySelector('.ms-dlg-cancelar').onclick = () => resolve(false);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) resolve(false); });
      overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') resolve(false); });
    });
    overlay.querySelectorAll('.ms-dlg-btn').forEach(b => { b.disabled = true; });

    if (respuesta) {
      // Confirmó: la mascota se decide (aprieta y brinca), el globo se arruga y sale volando
      globo.querySelector('.ms-dlg-saludo').textContent = saludoOk;
      globo.querySelector('.ms-dlg-pregunta').textContent = textoOk;
      const det = globo.querySelector('.ms-dlg-detalle'); if (det) det.remove();
      mirar(4, 3);
      await anim(mascota, [
        { transform: 'scale(1)' }, { transform: 'scale(1.15, .8)', offset: .35 },
        { transform: 'translateY(-34px) scale(.92, 1.1) rotate(6deg)', offset: .7 }, { transform: 'scale(1)' }
      ], { duration: 520, easing: 'ease-in-out' });
      await anim(globo, [
        { transform: 'none', opacity: 1 },
        { transform: 'scale(.82) rotate(-6deg)', opacity: 1, offset: .35 },
        { transform: 'translate(220px, 260px) scale(.08) rotate(220deg)', opacity: 0 }
      ], { duration: 560, easing: 'cubic-bezier(.55, 0, .75, .4)' });
      globo.style.visibility = 'hidden';
    } else {
      // Canceló: la mascota niega con la cabeza y el globo regresa a ella
      globo.querySelector('.ms-dlg-saludo').textContent = saludoCancel;
      globo.querySelector('.ms-dlg-pregunta').textContent = textoCancel;
      const det = globo.querySelector('.ms-dlg-detalle'); if (det) det.remove();
      await anim(mascota, [
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)' }, { transform: 'rotate(9deg)' },
        { transform: 'rotate(-6deg)' }, { transform: 'rotate(0deg)' }
      ], { duration: 520, easing: 'ease-in-out' });
      await esperar(quieto ? 0 : 150);
      await anim(globo, [
        { opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-30px) scale(.5)' }
      ], { duration: 260, easing: 'ease-in' });
      globo.style.visibility = 'hidden';
    }

    // Regresa saltando a su esquina y se vuelve a dormir
    const ahora = mascota.getBoundingClientRect();
    const rx = (origen.left + origen.width / 2) - (ahora.left + ahora.width / 2);
    const ry = (origen.top + origen.height / 2) - (ahora.top + ahora.height / 2);
    overlay.classList.remove('visible');
    // Regreso con marometa hacia el otro lado y los ojos dando vueltas
    const pararOjos2 = ojosEnVuelo(950);
    await anim(mascota, [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: 'translate(0, -50px) scale(1.04) rotate(40deg)', offset: .18 },
      { transform: `translate(${rx * .55}px, ${ry * .55 - 200}px) scale(${(s0 + 1) / 2}) rotate(190deg)`, offset: .5 },
      { transform: `translate(${rx * .85}px, ${ry * .85 - 70}px) scale(${(s0 * 2 + 1) / 3}) rotate(320deg)`, offset: .8 },
      { transform: `translate(${rx}px, ${ry}px) scale(${s0}) rotate(360deg)` }
    ], { duration: 950, easing: 'cubic-bezier(.4, .05, .4, 1)', fill: 'forwards' });
    pararOjos2();
    overlay.remove();
    M.soltarEsquina && M.soltarEsquina();
    return respuesta;
  }

  window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { preguntar });
})();

// =========================================================
// MiniSEBISO.ayudarEditar(): al abrir una ventana de edición, MiniSEBISO se
// pone sus lentes, salta con marometa hasta un lado de la ventana y la "abre"
// (la ventana se despliega desde él). Se queda acompañando mientras está
// abierta y, al cerrarse, regresa con marometa a su esquina a dormir.
// =========================================================
(function () {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = (el, frames, opts) => quieto ? Promise.resolve() : el.animate(frames, Object.assign({}, opts, { duration: Math.round(opts.duration * VEL) })).finished.catch(() => {});
  let activo = null;

  const lentesHTML = '<span class="ms-lentes" aria-hidden="true"><span class="ms-lente izq"></span><span class="ms-puente"></span><span class="ms-lente der"></span></span>';

  async function ayudarEditar(overlay, { texto = '¡Te ayudo a editar!', persistente = false } = {}) {
    if (!overlay || activo) return;
    const caja = overlay.querySelector('.modal-box') || overlay.firstElementChild;
    const esquina = document.querySelector('.ms-flotante:not(.ms-oculto)');
    if (!caja) return;
    // Solo acompaña si cabe a un lado de la ventana (él y su globo) sin taparla
    const ANCHO = 240;                       // el globo mide 220 px y va alineado a su izquierda
    const rc = caja.getBoundingClientRect();
    const lado = rc.left >= ANCHO + 14 ? 'izq' : innerWidth - rc.right >= ANCHO + 14 ? 'der' : null;
    if (!lado) return;

    // MiniSEBISO con lentes, en una capa encima de la ventana
    const ms = document.createElement('div');
    ms.className = 'minisebiso ms-ayudante con-lentes';
    ms.setAttribute('aria-hidden', 'true');
    ms.innerHTML = `
      <div class="ms-burbuja">${texto}</div>
      <div class="ms-cuerpo">
        <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
        <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
        ${lentesHTML}
      </div>
      <div class="ms-estrella"></div>`;
    document.body.appendChild(ms);
    const ojos = ms.querySelectorAll('.ms-ojo-mov');
    const mirar = (x, y) => ojos.forEach(o => { o.style.setProperty('--dx', x + 'px'); o.style.setProperty('--dy', y + 'px'); });
    let girando = 0;
    const ojosEnVuelo = (ms_) => { ms_ *= VEL;
      if (quieto) return () => {};
      const t0 = performance.now();
      const paso = (t) => { const a = (t - t0) / 110; mirar(Math.cos(a) * 5, Math.sin(a) * 4); if (t - t0 < ms_) girando = requestAnimationFrame(paso); };
      girando = requestAnimationFrame(paso);
      return () => cancelAnimationFrame(girando);
    };

    // Dónde se acomoda: a un lado de la ventana, con espacio para su globo debajo
    const W = ms.offsetWidth, H = ms.offsetHeight;
    const r = caja.getBoundingClientRect();
    const x = lado === 'izq' ? r.left - ANCHO - 6 : r.right + 18;
    const y = Math.max(8, Math.min(r.top + 40, innerHeight - H - 150));
    ms.style.left = x + 'px'; ms.style.top = y + 'px';

    const o = esquina ? esquina.getBoundingClientRect() : { left: innerWidth - 110, top: innerHeight - 100, width: 92, height: 83 };
    const dx = (o.left + o.width / 2) - (x + W / 2), dy = (o.top + o.height / 2) - (y + H / 2), s0 = o.width / W;
    window.MiniSEBISO.tomarEsquina();
    activo = { ms, esquina, overlay, o, W, H, s0, x, y, texto };

    // La ventana espera escondida hasta que MiniSEBISO llega
    caja.style.animation = 'none';      // su animación de entrada propia la mostraría antes de tiempo
    caja.style.visibility = 'hidden';
    const pararOjos = ojosEnVuelo(950);
    await anim(ms, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(0deg)` },
      { transform: `translate(${dx * .4}px, ${dy * .4 - 200}px) scale(${(s0 + 1) / 2}) rotate(-200deg)`, offset: .55 },
      { transform: 'translate(0, -36px) scale(1.04) rotate(-330deg)', offset: .85 },
      { transform: 'translate(0, 0) scale(1) rotate(-360deg)' }
    ], { duration: 950, easing: 'cubic-bezier(.4, .05, .4, 1)' });
    pararOjos();
    mirar(lado === 'izq' ? 5 : -5, 0);
    // "Abre" la ventana: se estira hacia ella y la ventana se despliega desde su lado
    caja.style.visibility = '';
    caja.style.transformOrigin = lado === 'izq' ? 'left center' : 'right center';
    await Promise.all([
      anim(ms, [{ transform: 'none' }, { transform: `translateX(${lado === 'izq' ? 10 : -10}px) scale(1.12, .9)`, offset: .35 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' }),
      anim(caja, [
        { opacity: 0, transform: 'scale(.15, .3)' },
        { opacity: 1, transform: 'scale(1.03, 1.01)', offset: .7 },
        { opacity: 1, transform: 'none' }
      ], { duration: 460, easing: 'cubic-bezier(.34, 1.4, .64, 1)' })
    ]);
    // Su mensaje: fijo mientras la ventana esté abierta (persistente) o solo un momento
    ms.classList.add('hablando');
    if (!persistente) setTimeout(() => ms.classList.remove('hablando'), 3800);
    // Sus ojos siguen el cursor mientras acompaña
    const seguir = (e) => ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      const ex = e.clientX - (r.left + r.width / 2), ey = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(ex, ey) || 1, f = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (ex / dist * r.width * .55 * f).toFixed(1) + 'px');
      o.style.setProperty('--dy', (ey / dist * r.height * .32 * f).toFixed(1) + 'px');
    });
    window.addEventListener('pointermove', seguir);
    activo.seguir = seguir;

    // Cuando la ventana se cierre (display:none), regresa a su esquina
    const obs = new MutationObserver(() => {
      if (getComputedStyle(overlay).display === 'none') { obs.disconnect(); regresar(); }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  async function regresar() {
    if (!activo) return;
    const { ms, esquina, o, W, H, s0, seguir } = activo;
    activo = null;
    document.querySelectorAll('.ms-campo-senalado').forEach(c => c.classList.remove('ms-campo-senalado'));
    if (seguir) window.removeEventListener('pointermove', seguir);
    ms.classList.remove('hablando');
    const r = ms.getBoundingClientRect();
    const rx = (o.left + o.width / 2) - (r.left + W / 2), ry = (o.top + o.height / 2) - (r.top + H / 2);
    const ojos = ms.querySelectorAll('.ms-ojo-mov');
    let id = 0; const t0 = performance.now();
    const paso = (t) => { const a = (t - t0) / 110; ojos.forEach(e => { e.style.setProperty('--dx', Math.cos(a) * 5 + 'px'); e.style.setProperty('--dy', Math.sin(a) * 4 + 'px'); }); if (t - t0 < 900 * VEL) id = requestAnimationFrame(paso); };
    if (!quieto) id = requestAnimationFrame(paso);
    await anim(ms, [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: 'translate(0, -50px) scale(1.04) rotate(40deg)', offset: .18 },
      { transform: `translate(${rx * .55}px, ${ry * .55 - 200}px) scale(${(s0 + 1) / 2}) rotate(190deg)`, offset: .5 },
      { transform: `translate(${rx}px, ${ry}px) scale(${s0}) rotate(360deg)` }
    ], { duration: 900, easing: 'cubic-bezier(.4, .05, .4, 1)', fill: 'forwards' });
    cancelAnimationFrame(id);
    ms.remove();
    window.MiniSEBISO.soltarEsquina();
  }

  // Brinca (con marometa) del lugar donde está a (nx, ny) en pantalla
  async function brincarA(ms, nx, ny) {
    const r = ms.getBoundingClientRect();
    const dx = r.left - nx, dy = r.top - ny;
    ms.style.left = nx + 'px'; ms.style.top = ny + 'px';
    await anim(ms, [
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
      { transform: `translate(${dx * .5}px, ${dy * .5 - 120}px) rotate(-180deg)`, offset: .5 },
      { transform: 'translate(0, 0) rotate(-360deg)' }
    ], { duration: 700, easing: 'cubic-bezier(.4, .05, .4, 1)' });
    await anim(ms, [{ transform: 'scale(1.1, .88)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }

  // MiniSEBISO.senalar(campo, texto): mientras ayuda a editar, salta junto a un
  // campo y lo pide con su globo; cuando el campo recibe un valor, regresa a su lugar.
  // Devuelve false si no hay ayudante en pantalla (para usar el aviso normal).
  function senalar(campo, texto, { textoListo = '¡Perfecto! Ya puedes actualizar los cambios.' } = {}) {
    if (!activo || !campo) return false;
    const a = activo, ms = a.ms, globo = ms.querySelector('.ms-burbuja');
    // Si estaba señalando otro campo, lo suelta (se señala uno a la vez)
    if (a.campo && a.campo !== campo) {
      a.campo.removeEventListener('input', a.alCambiar);
      a.campo.removeEventListener('change', a.alCambiar); if (a.alSalir) a.campo.removeEventListener('change', a.alSalir); if (a.alSalir) campo.removeEventListener('change', a.alSalir);
      a.campo.classList.remove('ms-campo-senalado');
      a.alCambiar = null;
    }
    const mismoCampo = a.campo === campo;
    a.campo = campo;
    const c = campo.getBoundingClientRect();
    const { x: nx, y: ny, izq } = msJunto(c, a.W, a.H);
    campo.classList.add('ms-campo-senalado');
    ms.classList.remove('hablando');
    (async () => {
      if (!mismoCampo || !a.senalando) { a.senalando = true; ms.classList.toggle('ms-burbuja-izq', izq); await brincarA(ms, nx, ny); }
      globo.textContent = texto;
      ms.classList.add('hablando', 'ms-alerta');
      setTimeout(() => ms.classList.remove('ms-alerta'), 600);
    })();
    if (!a.alCambiar) {
      a.alCambiar = async () => {
        if (!String(campo.value || '').trim()) return;
        campo.removeEventListener('input', a.alCambiar);
        campo.removeEventListener('change', a.alCambiar); if (a.alSalir) campo.removeEventListener('change', a.alSalir);
        a.alCambiar = null; a.campo = null;
        campo.classList.remove('ms-campo-senalado');
        ms.classList.remove('hablando');
        if (activo !== a) return;
        ms.classList.remove('ms-burbuja-izq');
        await brincarA(ms, a.x, a.y);
        a.senalando = false;
        globo.textContent = textoListo;
        ms.classList.add('hablando');
      };
      // Lista y hora: al elegir. Texto: cuando deja de escribir un momento (o sale del campo)
      const listo = a.alCambiar;
      if (campo.tagName === 'SELECT' || campo.type === 'time') {
        campo.addEventListener('change', listo); campo.addEventListener('input', listo);
      } else {
        let espera = 0;
        a.alCambiar = () => { clearTimeout(espera); espera = setTimeout(listo, 1300); };
        campo.addEventListener('input', a.alCambiar);
        campo.addEventListener('change', listo);
        a.alSalir = listo;
      }
    }
    return true;
  }

  // MiniSEBISO.comentar(texto, { alerta }): el ayudante que acompaña una ventana
  // cambia lo que dice (con un brinquito, o sacudiéndose si es un aviso).
  // Devuelve false si no hay ayudante en pantalla.
  function comentar(texto, { alerta = false } = {}) {
    if (!activo) return false;
    const ms = activo.ms;
    ms.querySelector('.ms-burbuja').textContent = texto;
    ms.classList.add('hablando');
    ms.classList.remove('ms-alerta'); void ms.offsetWidth;
    if (alerta) { ms.classList.add('ms-alerta'); setTimeout(() => ms.classList.remove('ms-alerta'), 600); }
    else anim(ms, [{ transform: 'none' }, { transform: 'translateY(-14px) scale(1.05, .95)', offset: .4 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
    return true;
  }
  const ayudando = () => !!activo;

  window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { ayudarEditar, senalar, comentar, ayudando });
})();

// =========================================================
// MiniSEBISO.presentar(campo, texto): despierta, salta con marometa junto a
// un campo de la página (no en ventana) y lo comenta con su globo. Se queda
// ahí hasta que se le toca o se llama a MiniSEBISO.retirar(); entonces
// regresa a su esquina a dormir.
// =========================================================
(function () {
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = (el, frames, opts) => quieto ? Promise.resolve() : el.animate(frames, Object.assign({}, opts, { duration: Math.round(opts.duration * VEL) })).finished.catch(() => {});
  let actual = null, turnoPresentar = 0;

  async function presentar(campo, texto) {
    if (!campo) return;
    // Solo un presentador a la vez: si se vuelve a llamar, el anterior se cancela
    const turno = ++turnoPresentar;
    if (actual) await retirar();
    // Espera a que la página termine de moverse antes de medir dónde está el campo
    await new Promise(r => setTimeout(r, 450));
    if (turno !== turnoPresentar) return;
    const esquina = document.querySelector('.ms-flotante:not(.ms-oculto)');
    const ms = document.createElement('div');
    ms.className = 'minisebiso ms-ayudante ms-presentador';
    ms.setAttribute('role', 'button');
    ms.setAttribute('tabindex', '0');
    ms.setAttribute('aria-label', 'Asistente: ' + texto + ' Toca para cerrar');
    ms.innerHTML = `
      <div class="ms-burbuja">${texto}</div>
      <div class="ms-cuerpo">
        <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
        <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
      </div>
      <div class="ms-estrella"></div>`;
    document.body.appendChild(ms);
    const W = ms.offsetWidth, H = ms.offsetHeight;
    // Lleva el campo al centro al instante (la página tiene desplazamiento suave por estilo)
    const rc = campo.getBoundingClientRect();
    if (rc.top < 80 || rc.bottom > innerHeight - 80) window.scrollTo({ top: scrollY + rc.top - innerHeight / 2 + rc.height / 2, behavior: 'instant' });
    const c = campo.getBoundingClientRect();
    const { x, y, izq } = msJunto(c, W, H);
    // Anclado a la página (no a la pantalla) para que siga al campo si la página se mueve
    ms.style.position = 'absolute';
    ms.style.left = (x + scrollX) + 'px'; ms.style.top = (y + scrollY) + 'px';
    // A la izquierda del campo, el globo se abre hacia la izquierda
    if (izq) ms.classList.add('ms-burbuja-izq');
    const o = esquina ? esquina.getBoundingClientRect() : { left: innerWidth - 110, top: innerHeight - 100, width: 92, height: 83 };
    const dx = (o.left + o.width / 2) - (x + W / 2), dy = (o.top + o.height / 2) - (y + H / 2), s0 = o.width / W;
    window.MiniSEBISO.tomarEsquina();
    campo.classList.add('ms-campo-senalado');
    actual = { ms, esquina, o, W, H, s0, campo };
    // Ojos siguen el cursor
    const ojos = ms.querySelectorAll('.ms-ojo-mov');
    actual.seguir = (e) => ojos.forEach(el => {
      const r = el.getBoundingClientRect();
      const ex = e.clientX - (r.left + r.width / 2), ey = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(ex, ey) || 1, f = Math.min(1, d / 220);
      el.style.setProperty('--dx', (ex / d * r.width * .55 * f).toFixed(1) + 'px');
      el.style.setProperty('--dy', (ey / d * r.height * .32 * f).toFixed(1) + 'px');
    });
    window.addEventListener('pointermove', actual.seguir);
    ms.addEventListener('click', () => retirar());
    await anim(ms, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(0deg)` },
      { transform: `translate(${dx * .4}px, ${dy * .4 - 200}px) scale(${(s0 + 1) / 2}) rotate(-200deg)`, offset: .55 },
      { transform: 'translate(0, -36px) scale(1.04) rotate(-330deg)', offset: .85 },
      { transform: 'translate(0, 0) scale(1) rotate(-360deg)' }
    ], { duration: 950, easing: 'cubic-bezier(.4, .05, .4, 1)' });
    await anim(ms, [{ transform: 'scale(1.12, .86)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    ms.classList.add('hablando');
  }

  async function retirar() {
    if (!actual) return;
    const { ms, esquina, o, W, H, s0, campo, seguir } = actual;
    actual = null;
    window.removeEventListener('pointermove', seguir);
    campo.classList.remove('ms-campo-senalado');
    ms.classList.remove('hablando');
    const r = ms.getBoundingClientRect();
    const rx = (o.left + o.width / 2) - (r.left + W / 2), ry = (o.top + o.height / 2) - (r.top + H / 2);
    await anim(ms, [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: `translate(${rx * .55}px, ${ry * .55 - 200}px) scale(${(s0 + 1) / 2}) rotate(190deg)`, offset: .5 },
      { transform: `translate(${rx}px, ${ry}px) scale(${s0}) rotate(360deg)` }
    ], { duration: 900, easing: 'cubic-bezier(.4, .05, .4, 1)', fill: 'forwards' });
    ms.remove();
    window.MiniSEBISO.soltarEsquina();
  }

  const presentando = () => (actual ? actual.campo : null);
  window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { presentar, retirar, presentando });
})();
