const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.unidad_codigo, u.activo,
              un.nombre AS unidad_nombre
       FROM usuarios u
       LEFT JOIN unidades un ON un.codigo = u.unidad_codigo
       WHERE u.email = $1`,
      [email.trim().toLowerCase()]
    );
    const user = rows[0];

    if (!user || !user.activo) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    const payload = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      unidad_codigo: user.unidad_codigo
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

    res.json({
      token,
      user: { ...payload, unidad_nombre: user.unidad_nombre || null }
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error del servidor al iniciar sesión.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
