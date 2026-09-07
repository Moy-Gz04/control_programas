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
      const data = await Api.post('/auth/login', { email, password });
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