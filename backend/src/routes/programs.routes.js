const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uploadDocumento } = require('../utils/googleDrive');

const router = express.Router();
router.use(requireAuth);

// Archivos en memoria (no se guardan en disco); tope de 15 MB por documento.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/* ---------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ---------------------------------------------------------------------- */

// Convierte un valor de fecha/hora capturado manualmente en el frontend
// (formato "YYYY-MM-DDTHH:mm", del par <input type="date"> + <input type="time">)
// a un Date válido para Postgres. Si no llega nada o es inválido, regresa
// null para que el caller decida el default (normalmente now() en SQL).
function parseFechaManual(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

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

  // Autorizaciones de Hacienda: una por solicitud_hacienda (relación 1 a 1).
  // Se anexan al objeto de cada solicitud como `autorizacion` (o null si aún
  // no se ha registrado), y se usan también para saber qué pagos ya tienen
  // una solicitud asociada, y así calcular cuáles solicitudes siguen
  // disponibles para pagar (autorizada y sin pago todavía).
  const haciendaIds = solicitudesHacienda.rows.map(h => h.id);
  let autorizaciones = [];
  if (haciendaIds.length) {
    const { rows } = await db.query(
      `SELECT * FROM autorizaciones_hacienda WHERE hacienda_id = ANY($1::int[])`,
      [haciendaIds]
    );
    autorizaciones = rows;
  }
  const pagosPorHacienda = new Set(pagos.rows.filter(g => g.hacienda_id).map(g => g.hacienda_id));

  const solicitudesHaciendaConEstado = solicitudesHacienda.rows.map(h => {
    const autorizacion = autorizaciones.find(a => a.hacienda_id === h.id) || null;
    return {
      ...h,
      autorizacion,
      pagada: pagosPorHacienda.has(h.id),
      disponibleParaPago: !!autorizacion && !pagosPorHacienda.has(h.id)
    };
  });

  return {
    ...programa,
    modificaciones: modificaciones.rows,
    dictamenes: dictamenesConSolicitudes,
    solicitudesHacienda: solicitudesHaciendaConEstado,
    pagos: pagos.rows
  };
}

/* ---------------------------------------------------------------------- */
/* Listado y creación — el único usuario (Administrador) ve y crea en      */
/* cualquier Unidad Presupuestal, sin restricción.                         */
/* ---------------------------------------------------------------------- */

router.get('/', async (req, res) => {
  try {
    // El listado trae los totales YA CALCULADOS en SQL (modificado, comprometido,
    // solicitado a Hacienda, pagado) para que las tarjetas y el dashboard muestren
    // cifras correctas de inmediato, sin tener que abrir cada programa primero.
    const { rows } = await db.query(
      `SELECT p.*, un.nombre AS unidad_nombre,
              COALESCE(mod_agg.modificado, 0) AS modificado_total,
              COALESCE(pers_agg.personas, 0) AS personas_total,
              (COALESCE(pers_agg.personas, 0) * p.monto_beneficiario) AS comprometido_total,
              COALESCE(hac_agg.hacienda, 0) AS hacienda_total,
              COALESCE(pag_agg.pagado, 0) AS pagado_total
       FROM programas p
       JOIN unidades un ON un.codigo = p.unidad_codigo
       LEFT JOIN (
         SELECT programa_id, SUM(CASE WHEN tipo='Ampliación' THEN monto ELSE -monto END) AS modificado
         FROM modificaciones GROUP BY programa_id
       ) mod_agg ON mod_agg.programa_id = p.id
       LEFT JOIN (
         SELECT d.programa_id, SUM(s.personas) AS personas
         FROM dictamenes d JOIN solicitudes s ON s.dictamen_id = d.id
         GROUP BY d.programa_id
       ) pers_agg ON pers_agg.programa_id = p.id
       LEFT JOIN (
         SELECT programa_id, SUM(monto) AS hacienda FROM solicitudes_hacienda GROUP BY programa_id
       ) hac_agg ON hac_agg.programa_id = p.id
       LEFT JOIN (
         SELECT programa_id, SUM(monto) AS pagado FROM pagos GROUP BY programa_id
       ) pag_agg ON pag_agg.programa_id = p.id
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
    // autorizaciones_hacienda, pagos) tienen ON DELETE CASCADE, así que se eliminan
    // solas junto con el programa.
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

router.post('/:id/monto-autorizado', upload.single('documento'), async (req, res) => {
  const { monto, referencia } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto autorizado debe ser mayor a cero.' });

  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });
    if (programa.monto_autorizado !== null) {
      return res.status(409).json({ error: 'Este programa ya tiene un Monto Autorizado cargado.' });
    }

    let documentoUrl = null;
    let documentoNombre = null;
    if (req.file) {
      try {
        const subido = await uploadDocumento(req.file.buffer, req.file.originalname, req.file.mimetype);
        documentoUrl = subido.url;
        documentoNombre = subido.nombre;
      } catch (uploadErr) {
        console.error('[programs/monto-autorizado] Google Drive', uploadErr);
        return res.status(502).json({ error: uploadErr.message || 'No se pudo subir el documento a Google Drive.' });
      }
    }

    await db.query(
      `UPDATE programas SET monto_autorizado = $1, monto_autorizado_referencia = $2, monto_autorizado_fecha = now(),
              monto_autorizado_documento_url = COALESCE($4, monto_autorizado_documento_url),
              monto_autorizado_documento_nombre = COALESCE($5, monto_autorizado_documento_nombre)
       WHERE id = $3`,
      [monto, referencia || 'S/R', req.params.id, documentoUrl, documentoNombre]
    );
    res.json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/monto-autorizado]', err);
    res.status(500).json({ error: 'Error al cargar el monto autorizado.' });
  }
});

router.post('/:id/modificaciones', upload.single('documento'), async (req, res) => {
  const { tipo, monto, motivo } = req.body || {};
  if (!['Ampliación', 'Reducción'].includes(tipo) || !monto || Number(monto) <= 0) {
    return res.status(400).json({ error: 'Tipo de movimiento y monto son obligatorios.' });
  }
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    let documentoUrl = null;
    let documentoNombre = null;
    if (req.file) {
      try {
        const subido = await uploadDocumento(req.file.buffer, req.file.originalname, req.file.mimetype);
        documentoUrl = subido.url;
        documentoNombre = subido.nombre;
      } catch (uploadErr) {
        console.error('[programs/modificaciones] Google Drive', uploadErr);
        return res.status(502).json({ error: uploadErr.message || 'No se pudo subir el documento a Google Drive.' });
      }
    }

    await db.query(
      `INSERT INTO modificaciones (programa_id, tipo, monto, motivo, created_by, documento_url, documento_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, tipo, monto, motivo || null, req.user.id, documentoUrl, documentoNombre]
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
    const fechaDictamen = parseFechaManual(req.body?.fecha_dictamen);

    const { rows } = await db.query(
      `INSERT INTO dictamenes (programa_id, numero, monto_autorizado, fecha_dictamen)
       VALUES ($1,$2,$3,COALESCE($4, now())) RETURNING id`,
      [req.params.id, numero, montoAutorizado, fechaDictamen]
    );
    const fechaCompromiso = parseFechaManual(req.body?.fecha_compromiso);
    await db.query(
      `INSERT INTO solicitudes (dictamen_id, numero, personas, fecha_compromiso) VALUES ($1, 1, 0, COALESCE($2, now()))`,
      [rows[0].id, fechaCompromiso]
    );

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
    const fechaDictamen = parseFechaManual(req.body?.fecha_dictamen);
    await db.query(
      `UPDATE dictamenes SET monto_autorizado = $1, fecha_dictamen = COALESCE($2, fecha_dictamen)
       WHERE id = $3 AND programa_id = $4`,
      [monto, fechaDictamen, req.params.dicId, req.params.id]
    );
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
    const fechaCompromiso = parseFechaManual(req.body?.fecha_compromiso);
    await db.query(
      'INSERT INTO solicitudes (dictamen_id, numero, personas, fecha_compromiso) VALUES ($1,$2,$3,COALESCE($4, now()))',
      [req.params.dicId, numero, Number(req.body?.personas || 0), fechaCompromiso]
    );

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
    const fechaCompromiso = parseFechaManual(req.body?.fecha_compromiso);
    await db.query(
      `UPDATE solicitudes SET personas = $1, fecha_compromiso = COALESCE($2, fecha_compromiso)
       WHERE id = $3 AND dictamen_id = $4`,
      [personas, fechaCompromiso, req.params.solId, req.params.dicId]
    );
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
/* Solicitado a Hacienda / Autorización de Hacienda / Pagos                */
/* ---------------------------------------------------------------------- */

router.post('/:id/hacienda', upload.single('documento'), async (req, res) => {
  const { folio, monto } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto es obligatorio.' });
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    let documentoUrl = null;
    let documentoNombre = null;
    if (req.file) {
      try {
        const subido = await uploadDocumento(req.file.buffer, req.file.originalname, req.file.mimetype);
        documentoUrl = subido.url;
        documentoNombre = subido.nombre;
      } catch (uploadErr) {
        console.error('[programs/hacienda] Google Drive', uploadErr);
        return res.status(502).json({ error: uploadErr.message || 'No se pudo subir el documento a Google Drive.' });
      }
    }

    const fecha = parseFechaManual(req.body?.fecha);
    await db.query(
      `INSERT INTO solicitudes_hacienda (programa_id, folio, monto, fecha, created_by, documento_url, documento_nombre)
       VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7)`,
      [req.params.id, folio || 'S/F', monto, fecha, req.user.id, documentoUrl, documentoNombre]
    );
    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/hacienda]', err);
    res.status(500).json({ error: 'Error al registrar la solicitud a Hacienda.' });
  }
});

// Autorización de Hacienda: registra que una solicitud ya enviada fue
// autorizada (monto, fecha/hora y documento propios). Relación 1 a 1 con
// solicitudes_hacienda — una vez autorizada, la solicitud queda disponible
// para ligarle un pago.
router.post('/:id/hacienda/:hacId/autorizacion', upload.single('documento'), async (req, res) => {
  const { monto_autorizado } = req.body || {};
  if (!monto_autorizado || Number(monto_autorizado) <= 0) {
    return res.status(400).json({ error: 'El monto autorizado por Hacienda es obligatorio.' });
  }
  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    const { rows: hacRows } = await db.query(
      'SELECT * FROM solicitudes_hacienda WHERE id = $1 AND programa_id = $2',
      [req.params.hacId, req.params.id]
    );
    if (!hacRows[0]) return res.status(404).json({ error: 'Solicitud a Hacienda no encontrada.' });

    let documentoUrl = null;
    let documentoNombre = null;
    if (req.file) {
      try {
        const subido = await uploadDocumento(req.file.buffer, req.file.originalname, req.file.mimetype);
        documentoUrl = subido.url;
        documentoNombre = subido.nombre;
      } catch (uploadErr) {
        console.error('[programs/hacienda/autorizacion] Google Drive', uploadErr);
        return res.status(502).json({ error: uploadErr.message || 'No se pudo subir el documento a Google Drive.' });
      }
    }

    const fechaAutorizacion = parseFechaManual(req.body?.fecha_autorizacion);
    try {
      await db.query(
        `INSERT INTO autorizaciones_hacienda (hacienda_id, monto_autorizado, fecha_autorizacion, created_by, documento_url, documento_nombre)
         VALUES ($1,$2,COALESCE($3, now()),$4,$5,$6)`,
        [req.params.hacId, monto_autorizado, fechaAutorizacion, req.user.id, documentoUrl, documentoNombre]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Esta solicitud a Hacienda ya tiene una autorización registrada.' });
      }
      throw err;
    }

    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/hacienda/autorizacion]', err);
    res.status(500).json({ error: 'Error al registrar la autorización de Hacienda.' });
  }
});

router.post('/:id/pagos', upload.single('documento'), async (req, res) => {
  const { folio, monto, hacienda_id } = req.body || {};
  if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto es obligatorio.' });
  if (!hacienda_id) return res.status(400).json({ error: 'Debes seleccionar la solicitud a Hacienda que se está pagando.' });

  try {
    const programa = await getPrograma(req.params.id);
    if (!programa) return res.status(404).json({ error: 'Programa no encontrado.' });

    // La solicitud debe pertenecer al programa, estar autorizada por Hacienda
    // y no tener ya un pago asociado (relación 1 a 1 solicitud → pago).
    const { rows: hacRows } = await db.query(
      `SELECT h.*, a.id AS autorizacion_id
       FROM solicitudes_hacienda h
       LEFT JOIN autorizaciones_hacienda a ON a.hacienda_id = h.id
       WHERE h.id = $1 AND h.programa_id = $2`,
      [hacienda_id, req.params.id]
    );
    if (!hacRows[0]) return res.status(404).json({ error: 'La solicitud a Hacienda seleccionada no existe en este programa.' });
    if (!hacRows[0].autorizacion_id) {
      return res.status(409).json({ error: 'Esta solicitud aún no cuenta con Autorización de Hacienda; regístrala antes de capturar el pago.' });
    }

    let documentoUrl = null;
    let documentoNombre = null;
    if (req.file) {
      try {
        const subido = await uploadDocumento(req.file.buffer, req.file.originalname, req.file.mimetype);
        documentoUrl = subido.url;
        documentoNombre = subido.nombre;
      } catch (uploadErr) {
        console.error('[programs/pagos] Google Drive', uploadErr);
        return res.status(502).json({ error: uploadErr.message || 'No se pudo subir el documento a Google Drive.' });
      }
    }

    const fecha = parseFechaManual(req.body?.fecha);
    try {
      await db.query(
        `INSERT INTO pagos (programa_id, hacienda_id, folio, monto, fecha, created_by, documento_url, documento_nombre)
         VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6,$7,$8)`,
        [req.params.id, hacienda_id, folio || 'S/F', monto, fecha, req.user.id, documentoUrl, documentoNombre]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Esta solicitud a Hacienda ya tiene un pago registrado.' });
      }
      throw err;
    }

    res.status(201).json(await getProgramaCompleto(req.params.id));
  } catch (err) {
    console.error('[programs/pagos]', err);
    res.status(500).json({ error: 'Error al registrar el pago.' });
  }
});

module.exports = router;