const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT codigo, nombre FROM unidades ORDER BY codigo');
    res.json(rows);
  } catch (err) {
    console.error('[unidades]', err);
    res.status(500).json({ error: 'Error al obtener unidades presupuestales.' });
  }
});

module.exports = router;
