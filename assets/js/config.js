/**
 * Punto único de configuración del frontend.
 *
 * En producción (Netlify) las llamadas van a "/api/..." y Netlify las
 * reenvía al backend de Render mediante el proxy definido en netlify.toml
 * (evita problemas de CORS y oculta la URL real del backend).
 *
 * En desarrollo local (abriendo los archivos con "netlify dev" o un server
 * estático simple en localhost) apuntamos directo al backend en localhost:4000.
 */
const API_BASE = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:4000/api';
  }
  return '/api';
})();
