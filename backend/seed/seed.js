/**
 * Crea el usuario administrador inicial (si no existe) usando las variables
 * SEED_ADMIN_* del .env. Puedes correrlo varias veces sin duplicar el usuario.
 * Uso: npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

async function seed() {
  const nombre = process.env.SEED_ADMIN_NOMBRE || 'Administrador';
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en tu .env antes de correr el seed.');
    process.exit(1);
  }

  const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`El usuario administrador "${email}" ya existe. No se realizaron cambios.`);
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo)
     VALUES ($1, $2, $3, true)`,
    [nombre, email, hash]
  );

  console.log(`✓ Usuario administrador creado: ${email}`);
  console.log('  Ya puedes iniciar sesión con este correo y la contraseña definida en SEED_ADMIN_PASSWORD.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Error en seed:', err);
  process.exit(1);
});
