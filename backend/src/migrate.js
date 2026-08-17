/**
 * Ejecuta las migraciones SQL de la carpeta /migrations en orden alfabético.
 * Uso: npm run migrate
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('No hay archivos de migración en /migrations.');
    return;
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`→ Ejecutando ${file}...`);
    await pool.query(sql);
    console.log(`✓ ${file} aplicada`);
  }

  console.log('Migraciones completadas.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Error al migrar:', err);
  process.exit(1);
});
