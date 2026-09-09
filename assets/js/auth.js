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

    try {
      // postRetrying: si el backend está "despertando" (Render, plan
      // gratuito) el primer intento puede fallar por un error transitorio
      // (red, 502/503/504). En ese caso NO se muestra ningún error: se
      // reintenta en silencio, con el botón siempre en "Entrando…", hasta
      // que el servidor responda de verdad o pasen hasta 90 segundos. Un
      // error real (correo/contraseña incorrectos, etc.) sí se muestra de
      // inmediato, sin reintentar.
      const data = await Api.postRetrying('/auth/login', { email, password });
      // sessionStorage (no localStorage): la sesión vive solo mientras esta
      // pestaña/ventana del navegador está abierta. Al cerrar el navegador
      // se pierde por completo y hay que volver a iniciar sesión — no debe
      // quedar "recordada" entre una visita y otra.
      sessionStorage.setItem('pb_token', data.token);
      sessionStorage.setItem('pb_user', JSON.stringify(data.user));
      window.location.href = 'app.html';
    } catch (err) {
      showError(err.message || 'No se pudo iniciar sesión.');
      btn.disabled = false;
      btn.textContent = 'Iniciar Sesión';
    }
  });

  function showError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideError() {
    document.getElementById('loginError').classList.remove('show');
  }
})();