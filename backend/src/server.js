require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const unidadesRoutes = require('./routes/unidades.routes');
const programsRoutes = require('./routes/programs.routes');

const app = express();

// Netlify puede llamar directo (fetch) o mediante proxy _redirects; permitimos
// el origen configurado y, si no hay ninguno definido, cualquiera (útil en dev).
const allowedOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: allowedOrigin ? allowedOrigin.split(',').map(s => s.trim()) : true,
  credentials: true
}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'programas-bienestar-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/unidades', unidadesRoutes);
app.use('/api/programs', programsRoutes);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Manejador de errores genérico (por si algo lanza fuera de un try/catch)
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Error inesperado del servidor.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API de Programas Sociales escuchando en el puerto ${PORT}`);
});
