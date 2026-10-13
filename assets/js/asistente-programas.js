/* =========================================================================
   Asistente de Programas (igual que en Correspondencia y Contratos)
   - Saluda al entrar (una vez por sesión) desde la esquina.
   - Al tocarlo abre un menú de ayuda con las dudas frecuentes del sistema.
   La ventana de trabajo al guardar, el interruptor, la personalización y el
   usuario en la esquina vienen de asistente-extra.js (igual que en
   Correspondencia y Contratos).
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
    if (M().apagado) return;
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

  function iniciar() {
    window.MiniSEBISO = Object.assign(window.MiniSEBISO || {}, { alTocarEsquina: abrirAyuda });
    saludar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
