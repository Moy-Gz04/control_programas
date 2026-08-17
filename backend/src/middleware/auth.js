const jwt = require('jsonwebtoken');

/**
 * Verifica el JWT del header Authorization: Bearer <token>.
 * Por el momento solo existe un usuario Administrador con acceso total,
 * así que cualquier sesión válida puede ver y crear en cualquier área.
 * (El campo "rol" queda listo en la base de datos para activar accesos
 * restringidos por Unidad Presupuestal más adelante, sin volver a migrar.)
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión nuevamente.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, nombre, email, rol }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' });
  }
}

module.exports = { requireAuth };
