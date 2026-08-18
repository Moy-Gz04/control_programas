/**
 * Wrapper de fetch: agrega el token JWT, maneja errores y expira la sesión
 * automáticamente si el backend responde 401.
 */
const Api = (() => {
  function token() { return localStorage.getItem('pb_token'); }

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
      throw new Error('No se pudo conectar con el servidor. Verifica tu conexión a internet.');
    }

    if (res.status === 401) {
      localStorage.removeItem('pb_token');
      localStorage.removeItem('pb_user');
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
        location.href = 'index.html?expired=1';
      }
      throw new Error('Sesión expirada.');
    }

    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch (_) { /* respuesta vacía */ }

    if (!res.ok) {
      throw new Error((data && data.error) || `Error ${res.status}`);
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    postForm: (path, formData) => request('POST', path, formData, true),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };
})();