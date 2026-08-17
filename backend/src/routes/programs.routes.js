const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ---------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ---------------------------------------------------------------------- */

async function getPrograma(id) {
  const { rows } = await db.query(
    `SELECT p.*, un.nombre AS unidad_nombre
     FROM programas p JOIN unidades un ON un.codigo = p.unidad_codigo
     WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getProgramaCompleto(id) {
  const programa = await getPrograma(id);
  if (!programa) return null;

  const [modificaciones, dictamenes, solicitudesHacienda, pagos] = await Promise.all([
    db.query('SELECT * FROM modificaciones WHERE programa_id = $1 ORDER BY created_at', [id]),
    db.query('SELECT * FROM dictamenes WHERE programa_id = $1 ORDER BY numero', [id]),
    db.query('SELECT * FROM solicitudes_hacienda WHERE programa_id = $1 ORDER BY fecha', [id]),
    db.query('SELECT * FROM pagos WHERE programa_id = $1 ORDER BY fecha', [id])
  ]);

  const dictamenIds = dictamenes.rows.map(d => d.id);
  let solicitudes = [];
  if (dictamenIds.length) {
    const { rows } = await db.query(
      `SELECT * FROM solicitudes WHERE dictamen_id = ANY($1::int[]) ORDER BY numero`,
      [dictamenIds]
    );
    solicitudes = rows;
  }

  const dictamenesConSolicitudes = dictamenes.rows.map(d => ({
    ...d,
    solicitudes: solicitudes.filter(s => s.dictamen_id === d.id)
  }));

  return {
    ...programa,
    modificaciones: modificaciones.rows,
    dictamenes: dictamenesConSolicitudes,
    solicitudesHacienda: solicitudesHacienda.rows,
    pagos: pagos.rows
  };
}

/* ---------------------------------------------------------------------- */
/* Listado y creación — el único usuario (Administrador) ve y crea en      */
/* cualquier Unidad Presupuestal, sin restricción.                         */
/* ---------------------------------------------------------------------- */

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, un.nombre AS unidad_nombre
       FROM programas p JOIN unidades un ON un.codigo = p.unidad_codigo
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[programs/list]', err);
    res.status(500).json({ error: 'Error al obtener los programas.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const programa = await getProgramaCompleto(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });
    res.json(programa);
  } catch (err) {
    console.error('[programs/get]', err);
    res.status(500).json({ error: 'Error al obtener el programa.' });
  }
});

router.post('/', async (req, res) => {
  const { unidad_codigo, nombre, monto_beneficiario, meta_beneficiarios } = req.body || {};
  if (!unidad_codigo || !nombre || !monto_beneficiario || !meta_beneficiarios) {
    return res.status(400).json({ error: 'Unidad Presupuestal, nombre, monto por beneficiario y meta son obligatorios.' });
  }

  try {
    const { rows: countRows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM programas WHERE unidad_codigo = $1',
      [unidad_codigo]
    );
    const seq = countRows[0].n + 1;
    const clave = `UP${unidad_codigo}-${String(seq).padStart(4, '0')}`;

    const { rows } = await db.query(
      `INSERT INTO programas (clave, unidad_codigo, nombre, monto_beneficiario, meta_beneficiarios, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [clave, unidad_codigo, nombre, monto_beneficiario, meta_beneficiarios, req.user.id]
    );
    res.status(201).json(await getProgramaCompleto(rows[0].id));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un programa con esa clave, intenta de nuevo.' });
    }
    console.error('[programs/create]', err);
    res.status(500).json({ error: 'Error al crear el programa.' });
  }
});

/* ---------------------------------------------------------------------- */
/* Editar y eliminar programa                                              */
/* ---------------------------------------------------------------------- */

router.patch('/:id', async (req, res) => {
  const { nombre, monto_beneficiario, meta_beneficiarios } = req.body || {};
  if (!nombre || !monto_beneficiario || !meta_beneficiarios) {
    return res.status(400).json({ error: 'Nombre, monto por beneficiario y meta son obligatorios.' });
  }
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    await db.query(
      `UPDATE programas SET nombre = $1, monto_beneficiario = $2, meta_beneficiarios = $3 WHERE id = $4`,
      [nombre, monto_beneficiario, meta_beneficiarios, req.params.id]
    );
    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/update]', err);
    res.status(500).json({ error: 'Error al actualizar el programa.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    // Las tablas hijas (modificaciones, dictamenes, solicitudes, solicitudes_hacienda,
    // pagos) tienen ON DELETE CASCADE, así que se eliminan solas junto con el programa.
    await db.query('DELETE FROM programas WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error('[programs/delete]', err);
    res.status(500).json({ error: 'Error al eliminar el programa.' });
  }
});

/* ---------------------------------------------------------------------- */
/* Monto autorizado y modificaciones                                       */
/* ---------------------------------------------------------------------- */

router.post('/:id/monto-autorizado', async (req, res) => {
  const { monto, referencia } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto autorizado debe ser mayor a cero.' });

  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });
    if (programa.monto_autorizado !== null) {
      return res.status(409).json({ error: 'Este programa ya tiene un Monto Autorizado cargado.' });
    }

    await db.query(
      `UPDATE programas SET monto_autorizado = $1, monto_autorizado_referencia = $2, monto_autorizado_fecha = now()
       WHERE id = $3`,
      [monto, referencia || 'S/R', req.params.id]
    );
    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/monto-autorizado]', err);
    res.status(500).json({ error: 'Error al cargar el monto autorizado.' });
  }
});

router.post('/:id/modificaciones', async (req, res) => {
  const { tipo, monto, motivo } = req.body || {};
  if (!['Ampliación', 'Reducción'].includes(tipo) || !monto || Number(monto) <= 0) {
    return res.status(400).json({ error: 'Tipo de movimiento y monto son obligatorios.' });
  }
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    await db.query(
      `INSERT INTO modificaciones (programa_id, tipo, monto, motivo, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, tipo, monto, motivo || null, req.user.id]
    );
    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/modificaciones]', err);
    res.status(500).json({ error: 'Error al registrar la modificación.' });
  }
});

/* ---------------------------------------------------------------------- */
/* Dictaminación                                                           */
/* ---------------------------------------------------------------------- */

router.post('/:id/dictamenes', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS n FROM dictamenes WHERE programa_id = $1', [req.params.id]);
    const numero = countRows[0].n + 1;
    const montoAutorizado = Number(req.body?.monto_autorizado || 0);

    const { rows } = await db.query(
      `INSERT INTO dictamenes (programa_id, numero, monto_autorizado) VALUES ($1,$2,$3) RETURNING id`,
      [req.params.id, numero, montoAutorizado]
    );
    await db.query(`INSERT INTO solicitudes (dictamen_id, numero, personas) VALUES ($1, 1, 0)`, [rows[0].id]);

    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/dictamenes]', err);
    res.status(500).json({ error: 'Error al crear el dictamen.' });
  }
});

router.patch('/:id/dictamenes/:dicId', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    const monto = Number(req.body?.monto_autorizado || 0);
    await db.query('UPDATE dictamenes SET monto_autorizado = $1 WHERE id = $2 AND programa_id = $3', [monto, req.params.dicId, req.params.id]);
    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/dictamenes/update]', err);
    res.status(500).json({ error: 'Error al actualizar el dictamen.' });
  }
});

router.delete('/:id/dictamenes/:dicId', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    // Las solicitudes del dictamen tienen ON DELETE CASCADE, se eliminan solas.
    await db.query('DELETE FROM dictamenes WHERE id = $1 AND programa_id = $2', [req.params.dicId, req.params.id]);

    // Renumerar los dictámenes restantes del programa para que sigan siendo consecutivos.
    const { rows } = await db.query('SELECT id FROM dictamenes WHERE programa_id = $1 ORDER BY numero, id', [req.params.id]);
    await Promise.all(rows.map((d, i) => db.query('UPDATE dictamenes SET numero = $1 WHERE id = $2', [i + 1, d.id])));

    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/dictamenes/delete]', err);
    res.status(500).json({ error: 'Error al eliminar el dictamen.' });
  }
});

router.post('/:id/dictamenes/:dicId/solicitudes', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS n FROM solicitudes WHERE dictamen_id = $1', [req.params.dicId]);
    const numero = countRows[0].n + 1;
    await db.query('INSERT INTO solicitudes (dictamen_id, numero, personas) VALUES ($1,$2,$3)', [req.params.dicId, numero, Number(req.body?.personas || 0)]);

    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/solicitudes/create]', err);
    res.status(500).json({ error: 'Error al agregar la solicitud.' });
  }
});

router.patch('/:id/dictamenes/:dicId/solicitudes/:solId', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    const personas = Number(req.body?.personas || 0);
    await db.query('UPDATE solicitudes SET personas = $1 WHERE id = $2 AND dictamen_id = $3', [personas, req.params.solId, req.params.dicId]);
    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/solicitudes/update]', err);
    res.status(500).json({ error: 'Error al actualizar la solicitud.' });
  }
});

router.delete('/:id/dictamenes/:dicId/solicitudes/:solId', async (req, res) => {
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    await db.query('DELETE FROM solicitudes WHERE id = $1 AND dictamen_id = $2', [req.params.solId, req.params.dicId]);

    // Renumerar las solicitudes restantes del dictamen
    const { rows } = await db.query('SELECT id FROM solicitudes WHERE dictamen_id = $1 ORDER BY numero, id', [req.params.dicId]);
    await Promise.all(rows.map((s, i) => db.query('UPDATE solicitudes SET numero = $1 WHERE id = $2', [i + 1, s.id])));

    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/solicitudes/delete]', err);
    res.status(500).json({ error: 'Error al eliminar la solicitud.' });
  }
});

/* ---------------------------------------------------------------------- */
/* Solicitado a Hacienda / Pagos                                           */
/* ---------------------------------------------------------------------- */

router.post('/:id/hacienda', async (req, res) => {
  const { folio, monto } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto es obligatorio.' });
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    await db.query('INSERT INTO solicitudes_hacienda (programa_id, folio, monto, created_by) VALUES ($1,$2,$3,$4)', [req.params.id, folio || 'S/F', monto, req.user.id]);
    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/hacienda]', err);
    res.status(500).json({ error: 'Error al registrar la solicitud a Hacienda.' });
  }
});

router.post('/:id/pagos', async (req, res) => {
  const { folio, monto } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto es obligatorio.' });
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    await db.query('INSERT INTO pagos (programa_id, folio, monto, created_by) VALUES ($1,$2,$3,$4)', [req.params.id, folio || 'S/F', monto, req.user.id]);
    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/pagos]', err);
    res.status(500).json({ error: 'Error al registrar el pago.' });
  }
});

module.exports = router;