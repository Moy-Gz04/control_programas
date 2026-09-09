/**
 * Wrapper de fetch: agrega el token JWT, maneja errores y expira la sesión
 * automáticamente si el backend responde 401.
 */
const Api = (() => {
  function token() { return sessionStorage.getItem('pb_token'); }

  async function request(method, path, body, isFormData) {
    const headers = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: isFormData ? body : (body !== undefined ? JSON.stringify(body) : undefined)
      });
    } catch (networkErr) {
      // Fallo de red (no llegó respuesta del servidor). En Render (plan
      // gratuito) esto pasa típicamente cuando la instancia está "dormida"
      // y todavía no despierta: se marca como reintentable para que
      // requestSilentRetry() lo vuelva a intentar en silencio, en vez de
      // mostrarle este error al usuario de inmediato.
      const err = new Error('No se pudo conectar con el servidor. Verifica tu conexión a internet.');
      err.retriable = true;
      throw err;
    }

    if (res.status === 401) {
      sessionStorage.removeItem('pb_token');
      sessionStorage.removeItem('pb_user');
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = 'index.html?expired=1';
      }
      throw new Error('Sesión expirada.');
    }

    if (res.status === 204) return null;

    let data = null;
    let parseOk = true;
    try { data = await res.json(); } catch (_) { parseOk = false; /* respuesta vacía o no-JSON */ }

    if (!res.ok) {
      // Mientras una instancia de Render "despierta" tras estar inactiva,
      // su proxy de borde suele devolver 502/503/504 (o una página de error
      // en HTML que no es JSON válido) en vez de dejar pasar la petición
      // hasta la app real. Esos casos se marcan como reintentables; un 500
      // con un JSON de error real (como los que manda auth.routes.js) NO se
      // reintenta, porque ya es una respuesta válida de la aplicación.
      const gatewayStatus = [502, 503, 504, 520, 521, 522, 523, 524].includes(res.status);
      const err = new Error((data && data.error) || `Error ${res.status}`);
      if (gatewayStatus || (!parseOk && res.status >= 500)) err.retriable = true;
      throw err;
    }
    return data;
  }

  /* Igual que request(), pero si el intento falla por una causa marcada
     como "retriable" (servidor despertando: fallo de red, 502/503/504, o
     una respuesta de error no-JSON) lo reintenta en silencio —sin lanzar
     ni mostrar ningún error intermedio— hasta que responda bien o se agote
     maxWaitMs. Pensado para el login: el usuario solo ve el botón en su
     estado de carga ("Entrando…") el tiempo que haga falta, sin ver nunca
     el error transitorio del cold start. Un error real (credenciales
     incorrectas, sesión, validación, etc.) nunca llega marcado como
     retriable, así que se lanza de inmediato y sí se muestra. */
  async function requestSilentRetry(method, path, body, isFormData, maxWaitMs, intervalMs) {
    const start = Date.now();
    const wait = maxWaitMs || 90000;
    const interval = intervalMs || 3000;
    for (;;) {
      try {
        return await request(method, path, body, isFormData);
      } catch (err) {
        if (!err.retriable || (Date.now() - start) >= wait) throw err;
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    postForm: (path, formData) => request('POST', path, formData, true),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    // Variante con reintento silencioso (ver requestSilentRetry arriba).
    // opts: { maxWaitMs, intervalMs } — ambos opcionales.
    postRetrying: (path, body, opts) => requestSilentRetry('POST', path, body, false, opts && opts.maxWaitMs, opts && opts.intervalMs),
  };
})();