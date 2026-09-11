/**
 * Lógica de la página de login (index.html).
 * Si ya hay una sesión activa, redirige directo a la app.
 */
(function(){
  if (sessionStorage.getItem('pb_token')) {
    window.location.href = 'app.html';
    return;
  }

  const params = new URLSearchParams(location.search);
  if (params.get('expired') === '1') {
    showError('Tu sesión expiró. Inicia sesión nuevamente.');
  }

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('btnLogin');

    hideError();
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    // El backend (Render, plan gratuito) tarda ~40s en "despertar" si
    // estaba inactivo. Se muestra el overlay desde el primer intento: si
    // el servidor ya estaba despierto, la respuesta llega antes de que el
    // usuario alcance a leerlo y se oculta de inmediato.
    startWakeOverlay();

    try {
      // postRetrying: si el backend está "despertando" (Render, plan
      // gratuito) el primer intento puede fallar por un error transitorio
      // (red, 502/503/504). En ese caso NO se muestra ningún error: se
      // reintenta en silencio, con el botón siempre en "Entrando…" y el
      // overlay de despertando en pantalla, hasta que el servidor responda
      // de verdad o pasen hasta 90 segundos. Un error real (correo/
      // contraseña incorrectos, etc.) sí se muestra de inmediato, sin
      // reintentar.
      const data = await Api.postRetrying('/auth/login', { email, password });
      // sessionStorage (no localStorage): la sesión vive solo mientras esta
      // pestaña/ventana del navegador está abierta. Al cerrar el navegador
      // se pierde por completo y hay que volver a iniciar sesión — no debe
      // quedar "recordada" entre una visita y otra.
      sessionStorage.setItem('pb_token', data.token);
      sessionStorage.setItem('pb_user', JSON.stringify(data.user));
      window.location.href = 'app.html';
    } catch (err) {
      stopWakeOverlay();
      showError(err.message || 'No se pudo iniciar sesión.');
      btn.disabled = false;
      btn.textContent = 'Iniciar Sesión';
    }
  });

  // ── Overlay "Despertando servidor…" ──
  // Cuenta regresiva de 40s (duración típica del cold-start de Render) con
  // barra de progreso. Si el login termina antes, se oculta al instante
  // (ver stopWakeOverlay en el catch de arriba y justo antes del redirect).
  // Si se pasa de los 40s (arranque más lento de lo normal), la barra se
  // queda llena y el contador en "0 s" mientras postRetrying sigue
  // reintentando por detrás, sin mostrar ningún error.
  const WAKE_SECONDS = 40;
  let wakeTimer = null;

  function startWakeOverlay() {
    const overlay = document.getElementById('wakeOverlay');
    const fill = document.getElementById('wakeBarFill');
    const countdown = document.getElementById('wakeCountdown');
    let restante = WAKE_SECONDS;

    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    fill.style.width = '0%';
    countdown.textContent = restante + ' s';

    clearInterval(wakeTimer);
    wakeTimer = setInterval(() => {
      restante -= 1;
      if (restante <= 0) {
        restante = 0;
        countdown.textContent = 'Esto está tardando más de lo usual, seguimos intentando…';
      } else {
        countdown.textContent = restante + ' s';
      }
      fill.style.width = Math.min(100, ((WAKE_SECONDS - restante) / WAKE_SECONDS) * 100) + '%';
    }, 1000);
  }

  function stopWakeOverlay() {
    clearInterval(wakeTimer);
    wakeTimer = null;
    const overlay = document.getElementById('wakeOverlay');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideError() {
    document.getElementById('loginError').classList.remove('show');
  }
})();