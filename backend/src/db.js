const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[db] Falta la variable de entorno DATABASE_URL. Revisa tu archivo .env (usa .env.example como plantilla).');
}

// Neon requiere SSL. localhost (desarrollo) normalmente no lo requiere,
// así que solo forzamos SSL cuando la cadena de conexión no apunta a localhost.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de conexiones:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
